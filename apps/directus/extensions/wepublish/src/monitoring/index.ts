import { defineEndpoint } from '@directus/extensions-sdk'
import {
  ForbiddenError,
  InvalidPayloadError,
  createError
} from '@directus/errors'
import type { Client, ClientPeriod } from '../DirectusTypes'
import { InfraService } from '../client-onboarding/services/InfraService'
import {
  buildClientMonitoring,
  buildOverviewMonitoring
} from '../shared/monitoring/health'
import {
  MONITORING_CACHE_TTL_MS,
  MONITORING_OVERVIEW_KEY,
  getMonitoringCache,
  mediumHealthCacheKey
} from '../shared/cache/monitoringCache'

const MissingEnvError = createError('500', 'Missing env variables.')
const InfraUnavailableError = createError(
  '502',
  'Monitoring service unavailable.'
)

interface CacheMeta {
  hit: boolean
  cachedAt: number
  expiresAt: number
  ttlMs: number
}

function readInfraEnv(env: Record<string, any>): {
  url: string
  apiKey: string
} {
  const url = env.INFRA_CONFIGURATOR_URL
  const apiKey = env.INFRA_CONFIGURATOR_API_KEY
  if (
    !url ||
    typeof url !== 'string' ||
    !apiKey ||
    typeof apiKey !== 'string'
  ) {
    throw new Error(
      'Missing INFRA_CONFIGURATOR_URL / INFRA_CONFIGURATOR_API_KEY'
    )
  }
  return { url, apiKey }
}

// Caches the raw configurator payload (single-flight dedups concurrent loads)
// and exposes hit/miss + TTL metadata for the dashboard, mirroring the billing
// endpoints' envelope.
async function loadRawWithMeta(
  key: string,
  factory: () => Promise<any>
): Promise<{ raw: any; cache: CacheMeta }> {
  const cache = getMonitoringCache()
  const hit = cache.has(key)
  const raw = await cache.getOrCompute(key, factory)
  const entry = cache.getEntry(key)
  const expiresAt = entry?.expiresAt ?? Date.now() + MONITORING_CACHE_TTL_MS
  return {
    raw,
    cache: {
      hit,
      cachedAt: expiresAt - MONITORING_CACHE_TTL_MS,
      expiresAt,
      ttlMs: MONITORING_CACHE_TTL_MS
    }
  }
}

export default defineEndpoint((router, context) => {
  /**
   * Admin-only: live health of every medium the configurator knows about,
   * shaped for the /overview-style tile grid. Reads only the configurator (no
   * Directus correlation), so a medium without a matching client still shows.
   */
  router.get('/overview', async (req: any, res, next) => {
    try {
      const accountability = req.accountability
      if (!accountability?.user) return next(new ForbiddenError())
      if (!accountability.admin) return next(new ForbiddenError())

      let infraEnv
      try {
        infraEnv = readInfraEnv(context.env)
      } catch {
        return next(new MissingEnvError())
      }
      const infra = new InfraService(infraEnv.url, infraEnv.apiKey)

      let raw: any
      let cache: CacheMeta
      try {
        ;({ raw, cache } = await loadRawWithMeta(MONITORING_OVERVIEW_KEY, () =>
          infra.getMediaHealth()
        ))
      } catch {
        return next(new InfraUnavailableError())
      }

      return res.send({ data: buildOverviewMonitoring(raw), cache })
    } catch (e) {
      return next(e)
    }
  })

  /**
   * Per-customer: live health for the medium mapped to the caller's client.
   * Authorization rides on Directus row-level perms — ItemsService.readOne with
   * the caller's accountability throws ForbiddenError if they can't see the
   * period. The medium_name itself is admin-only, so it's read with a system
   * service *after* the access check (the caller never needs to read the field
   * directly). The identifier is resolved server-side and never taken from the
   * request, so a client can only ever see their own medium's status.
   */
  router.get('/client', async (req: any, res, next) => {
    try {
      const accountability = req.accountability
      if (!accountability?.user) return next(new ForbiddenError())

      const clientPeriodId = req.query?.clientPeriodId
      if (!clientPeriodId) {
        return next(
          new InvalidPayloadError({ reason: 'Missing param clientPeriodId' })
        )
      }

      const { services, getSchema } = context
      const schema = await getSchema()

      const clientPeriodService = new services.ItemsService<ClientPeriod>(
        'Clients_Periods',
        { schema, accountability }
      )
      const clientPeriod = await clientPeriodService.readOne(clientPeriodId, {
        fields: ['id', 'Clients_id.id']
      })
      const clientRef = clientPeriod.Clients_id as Client | null
      if (!clientRef?.id) return next(new ForbiddenError())

      const systemClients = new services.ItemsService<Client>('Clients', {
        schema
      })
      const client = await systemClients.readOne(clientRef.id, {
        fields: ['id', 'medium_name']
      })
      const mediumName = (client?.medium_name as string | null) ?? null

      if (!mediumName) {
        return res.send({
          data: buildClientMonitoring({ mediumName: null, raw: null }),
          cache: null
        })
      }

      let infraEnv
      try {
        infraEnv = readInfraEnv(context.env)
      } catch {
        return next(new MissingEnvError())
      }
      const infra = new InfraService(infraEnv.url, infraEnv.apiKey)

      let raw: any = null
      let cache: CacheMeta | null = null
      try {
        const loaded = await loadRawWithMeta(
          mediumHealthCacheKey(mediumName),
          () => infra.getMediumHealth(mediumName)
        )
        raw = loaded.raw
        cache = loaded.cache
      } catch (err: any) {
        // The configurator 404s for a medium it doesn't know → notMonitored.
        if (err?.response?.status === 404) {
          raw = null
        } else {
          return next(new InfraUnavailableError())
        }
      }

      return res.send({
        data: buildClientMonitoring({ mediumName, raw }),
        cache
      })
    } catch (e) {
      return next(e)
    }
  })

  /**
   * Per-customer: authoritative service URLs (editor / website / api / media
   * server) for the caller's medium, from the infra configurator instead of
   * derived from apiUrl. Identifier resolved server-side; nulls (not an error)
   * when no medium is mapped so the dashboard falls back to derived links.
   */
  router.get('/urls', async (req: any, res, next) => {
    try {
      const accountability = req.accountability
      if (!accountability?.user) return next(new ForbiddenError())

      const clientPeriodId = req.query?.clientPeriodId
      if (!clientPeriodId) {
        return next(
          new InvalidPayloadError({ reason: 'Missing param clientPeriodId' })
        )
      }

      const { services, getSchema } = context
      const schema = await getSchema()

      const clientPeriodService = new services.ItemsService<ClientPeriod>(
        'Clients_Periods',
        { schema, accountability }
      )
      const clientPeriod = await clientPeriodService.readOne(clientPeriodId, {
        fields: ['id', 'Clients_id.id']
      })
      const clientRef = clientPeriod.Clients_id as Client | null
      if (!clientRef?.id) return next(new ForbiddenError())

      const systemClients = new services.ItemsService<Client>('Clients', {
        schema
      })
      const client = await systemClients.readOne(clientRef.id, {
        fields: ['id', 'medium_name']
      })
      const mediumName = (client?.medium_name as string | null) ?? null

      if (!mediumName) {
        return res.send({
          data: { mediumName: null, production: null, staging: null }
        })
      }

      let infraEnv
      try {
        infraEnv = readInfraEnv(context.env)
      } catch {
        return next(new MissingEnvError())
      }
      const infra = new InfraService(infraEnv.url, infraEnv.apiKey)

      let raw: any
      try {
        raw = await getMonitoringCache().getOrCompute('infra-config-all', () =>
          infra.getConfiguration()
        )
      } catch {
        return next(new InfraUnavailableError())
      }

      const str = (v: any): string | null => (typeof v === 'string' ? v : null)
      const mapUrls = (env: any) =>
        env?.urls
          ? {
              editor: str(env.urls.editor),
              website: str(env.urls.website),
              api: str(env.urls.api),
              mediaServer: str(env.urls.media_server)
            }
          : null

      const mediumCfg = raw?.media?.[mediumName]
      return res.send({
        data: {
          mediumName,
          production: mapUrls(mediumCfg?.production),
          staging: mapUrls(mediumCfg?.staging)
        }
      })
    } catch (e) {
      return next(e)
    }
  })

  /**
   * Admin-only: all active review builds grouped by medium, from the
   * configurator. Degrades to empty on 404 (module not deployed everywhere).
   */
  router.get('/review-builds', async (req: any, res, next) => {
    try {
      const accountability = req.accountability
      if (!accountability?.user) return next(new ForbiddenError())
      if (!accountability.admin) return next(new ForbiddenError())

      let infraEnv
      try {
        infraEnv = readInfraEnv(context.env)
      } catch {
        return next(new MissingEnvError())
      }
      const infra = new InfraService(infraEnv.url, infraEnv.apiKey)

      let raw: any
      try {
        raw = await getMonitoringCache().getOrCompute('review-builds-all', () =>
          infra.getReviewInstances()
        )
      } catch (err: any) {
        if (err?.response?.status === 404) {
          return res.send({ data: { instances: {}, fetchedAt: null } })
        }
        return next(new InfraUnavailableError())
      }

      return res.send({
        data: {
          instances: raw?.instances ?? {},
          fetchedAt: raw?.fetched_at ?? null
        }
      })
    } catch (e) {
      return next(e)
    }
  })

  /**
   * Per-customer: the active review builds for the caller's medium. Same
   * authorization model as /client — identifier resolved server-side.
   */
  router.get('/review-builds/client', async (req: any, res, next) => {
    try {
      const accountability = req.accountability
      if (!accountability?.user) return next(new ForbiddenError())

      const clientPeriodId = req.query?.clientPeriodId
      if (!clientPeriodId) {
        return next(
          new InvalidPayloadError({ reason: 'Missing param clientPeriodId' })
        )
      }

      const { services, getSchema } = context
      const schema = await getSchema()

      const clientPeriodService = new services.ItemsService<ClientPeriod>(
        'Clients_Periods',
        { schema, accountability }
      )
      const clientPeriod = await clientPeriodService.readOne(clientPeriodId, {
        fields: ['id', 'Clients_id.id']
      })
      const clientRef = clientPeriod.Clients_id as Client | null
      if (!clientRef?.id) return next(new ForbiddenError())

      const systemClients = new services.ItemsService<Client>('Clients', {
        schema
      })
      const client = await systemClients.readOne(clientRef.id, {
        fields: ['id', 'medium_name']
      })
      const mediumName = (client?.medium_name as string | null) ?? null

      if (!mediumName) {
        return res.send({
          data: { medium: null, instances: [], fetchedAt: null }
        })
      }

      let infraEnv
      try {
        infraEnv = readInfraEnv(context.env)
      } catch {
        return next(new MissingEnvError())
      }
      const infra = new InfraService(infraEnv.url, infraEnv.apiKey)

      let raw: any
      try {
        raw = await getMonitoringCache().getOrCompute(
          `review-builds:${mediumName}`,
          () => infra.getReviewInstancesForMedium(mediumName)
        )
      } catch (err: any) {
        if (err?.response?.status === 404) {
          return res.send({
            data: { medium: mediumName, instances: [], fetchedAt: null }
          })
        }
        return next(new InfraUnavailableError())
      }

      return res.send({
        data: {
          medium: mediumName,
          instances: raw?.instances ?? [],
          fetchedAt: raw?.fetched_at ?? null
        }
      })
    } catch (e) {
      return next(e)
    }
  })
})
