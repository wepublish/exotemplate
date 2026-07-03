import { defineEndpoint } from '@directus/extensions-sdk'
import {
  ForbiddenError,
  InvalidPayloadError,
  createError
} from '@directus/errors'
import { SentryService } from '../shared/sentry/client'
import {
  SENTRY_CHARTS,
  SENTRY_TABLES,
  chartParams,
  normalizeChartSeries,
  normalizeEventsTable,
  resolveChartDef,
  resolveTableDef,
  tableParams,
  type SentryChartDef,
  type SentryTableDef
} from '../shared/sentry/charts'
import {
  SENTRY_CACHE_TTL_MS,
  getSentryCache,
  sentryChartCacheKey,
  sentryTableCacheKey
} from '../shared/cache/sentryCache'

const MissingEnvError = createError('500', 'Missing Sentry env variables.')

interface CacheMeta {
  hit: boolean
  cachedAt: number
  expiresAt: number
  ttlMs: number
}

function readSentryConfig(env: Record<string, any>): {
  apiUrl: string
  org: string
  token: string
} {
  const apiUrl =
    typeof env.SENTRY_API_URL === 'string' && env.SENTRY_API_URL
      ? env.SENTRY_API_URL
      : 'https://de.sentry.io'
  const org =
    typeof env.SENTRY_ORG === 'string' && env.SENTRY_ORG
      ? env.SENTRY_ORG
      : 'wepublish-foundation'
  const token = env.SENTRY_AUTH_TOKEN
  if (!token || typeof token !== 'string') {
    throw new Error('Missing SENTRY_AUTH_TOKEN')
  }
  return { apiUrl, org, token }
}

// Caches the raw Sentry payload (single-flight dedups concurrent loads) and
// exposes hit/miss + TTL metadata, mirroring the monitoring / billing endpoints.
async function loadRawWithMeta(
  key: string,
  factory: () => Promise<any>
): Promise<{ raw: any; cache: CacheMeta }> {
  const cache = getSentryCache()
  const hit = cache.has(key)
  const raw = await cache.getOrCompute(key, factory)
  const entry = cache.getEntry(key)
  const expiresAt = entry?.expiresAt ?? Date.now() + SENTRY_CACHE_TTL_MS
  return {
    raw,
    cache: {
      hit,
      cachedAt: expiresAt - SENTRY_CACHE_TTL_MS,
      expiresAt,
      ttlMs: SENTRY_CACHE_TTL_MS
    }
  }
}

export default defineEndpoint((router, context) => {
  /**
   * Admin-only: every chart + ranked table in the registry, each proxied from
   * Sentry (so the auth token never reaches the browser) and cached server-side
   * per entry. A single entry failing upstream degrades to an empty
   * `error: 'unavailable'` result rather than failing the whole page.
   * Response: `{ data: { charts: [...], tables: [...] } }`.
   */
  router.get('/charts', async (req: any, res, next) => {
    try {
      const accountability = req.accountability
      if (!accountability?.user) return next(new ForbiddenError())
      if (!accountability.admin) return next(new ForbiddenError())

      const clientId = req.query?.clientId
      if (!clientId || typeof clientId !== 'string') {
        return next(
          new InvalidPayloadError({
            reason: 'Missing or invalid clientId query parameter.'
          })
        )
      }

      // Resolve the client's Terraform medium id under the caller's own
      // accountability, then template it into every Sentry query/URL so the
      // panels reflect that medium instead of a hardcoded one.
      const { ItemsService } = context.services
      const clients = new ItemsService('Clients', {
        schema: await context.getSchema(),
        accountability
      })
      const client = await clients.readOne(clientId, {
        fields: ['medium_name']
      })
      const medium = client?.medium_name
      if (!medium || typeof medium !== 'string') {
        return next(
          new InvalidPayloadError({
            reason:
              'The selected client has no medium_name; cannot scope Sentry queries.'
          })
        )
      }

      let config
      try {
        config = readSentryConfig(context.env)
      } catch {
        return next(new MissingEnvError())
      }
      const sentry = new SentryService(config)

      const loadChart = async (rawDef: SentryChartDef) => {
        const def = resolveChartDef(rawDef, medium)
        const base = {
          key: def.key,
          yAxes: def.yAxes,
          unit: def.unit,
          query: def.query,
          statsPeriod: def.statsPeriod,
          sentryUrl: def.sentryUrl
        }
        try {
          const { raw, cache } = await loadRawWithMeta(
            sentryChartCacheKey(def.key, medium),
            () => sentry.getEventsStats(chartParams(def))
          )
          return {
            ...base,
            series: normalizeChartSeries(raw, def.yAxes),
            cache,
            error: null as string | null
          }
        } catch {
          return {
            ...base,
            series: [],
            cache: null as CacheMeta | null,
            error: 'unavailable' as string | null
          }
        }
      }

      const loadTable = async (rawDef: SentryTableDef) => {
        const def = resolveTableDef(rawDef, medium)
        const base = {
          key: def.key,
          columns: def.aggregates,
          unit: def.unit,
          countPerDay: def.countPerDay !== false,
          perDayAggregates: def.perDayAggregates,
          query: def.query,
          statsPeriod: def.statsPeriod,
          sentryUrl: def.sentryUrl
        }
        try {
          const { raw, cache } = await loadRawWithMeta(
            sentryTableCacheKey(def.key, medium),
            () => sentry.getEvents(tableParams(def))
          )
          return {
            ...base,
            rows: normalizeEventsTable(raw, def),
            cache,
            error: null as string | null
          }
        } catch {
          return {
            ...base,
            rows: [],
            cache: null as CacheMeta | null,
            error: 'unavailable' as string | null
          }
        }
      }

      const [charts, tables] = await Promise.all([
        Promise.all(SENTRY_CHARTS.map(loadChart)),
        Promise.all(SENTRY_TABLES.map(loadTable))
      ])
      return res.send({ data: { charts, tables } })
    } catch (e) {
      return next(e)
    }
  })
})
