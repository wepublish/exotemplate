import { defineEndpoint } from '@directus/extensions-sdk'
import {
  ForbiddenError,
  InvalidPayloadError,
  createError
} from '@directus/errors'
import type {
  Client,
  ClientPeriod,
  ManualWorkEntry,
  Period,
  TopUp
} from '../DirectusTypes'
import {
  computeClientPeriodBilling,
  persistBillingSnapshotFailure,
  persistBillingSnapshotSuccess,
  readBillingEnv,
  type BillingSnapshotRow,
  type SnapshotsServiceLike
} from '../shared/billing'
import { billingCacheKey, getBillingCache } from '../shared/cache'
import { currentContractNeedsSignature } from '../contracts/helpers'

const MissingEnvError = createError('500', 'Missing env variables.')

interface ItemsServiceLike<T> {
  readByQuery(query: unknown): Promise<T[]>
  readOne(id: string | number, opts?: unknown): Promise<T>
}

interface OverviewEntry {
  clientPeriodId: number
  client: {
    id: string
    name: string
    billing_mode: 'prepaid' | 'monthly'
  }
  period: {
    id: string
    from: string
    to: string
    name: string | null
  }
  sums: {
    totalUsedHours: number
    totalTopUps: number
    totalUsedPercentage: number
    totalAvailableHours: number
    totalManualWorkHours: number
    billableHours: number
  } | null
  computedAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  pending: boolean
  /** True when the client has a contract whose current version is not signed. */
  contractWarning: boolean
}

export default defineEndpoint((router, context) => {
  router.get('/', async (req: any, res, next) => {
    try {
      const accountability = req.accountability
      if (!accountability?.user) return next(new ForbiddenError())
      if (!accountability.admin) return next(new ForbiddenError())

      const { services } = context
      const schema = await context.getSchema()

      if (!schema?.collections?.BillingSnapshots) {
        // The snapshot collection isn't in the live schema yet (someone forgot
        // to run `schema:load`). Return an empty payload with a clear marker
        // so the frontend can show an admin-friendly hint instead of 500.
        return res.send({
          data: [],
          generatedAt: new Date().toISOString(),
          schemaMissing: true
        })
      }

      const clientPeriodsService: ItemsServiceLike<ClientPeriod> =
        new services.ItemsService('Clients_Periods', { schema })
      const snapshotsService: ItemsServiceLike<BillingSnapshotRow> =
        new services.ItemsService('BillingSnapshots', { schema })

      const now = new Date().toISOString()

      const currentPeriods = await clientPeriodsService.readByQuery({
        filter: {
          Periods_id: { from: { _lte: now }, to: { _gte: now } },
          Clients_id: { status: { _eq: 'published' } }
        },
        fields: [
          'id',
          'Clients_id.id',
          'Clients_id.name',
          'Clients_id.billing_mode',
          'Periods_id.id',
          'Periods_id.from',
          'Periods_id.to',
          'Periods_id.name'
        ],
        limit: -1
      })

      const clientPeriodIds = currentPeriods
        .map((cp) => cp.id)
        .filter((id): id is number => typeof id === 'number')

      const snapshots =
        clientPeriodIds.length > 0
          ? await snapshotsService.readByQuery({
              filter: { clientPeriodId: { _in: clientPeriodIds } },
              limit: -1
            })
          : []

      const snapshotsByPeriod = new Map<number, BillingSnapshotRow>()
      for (const snap of snapshots) {
        snapshotsByPeriod.set(snap.clientPeriodId, snap)
      }

      // For best-most-recent ordering when multiple periods overlap the same
      // client today (rare — only mid-cycle renewals), keep the one with the
      // latest `Periods_id.from`, matching the dashboard's auto-select rule.
      const bestByClient = new Map<string, ClientPeriod>()
      for (const cp of currentPeriods) {
        const client = cp.Clients_id as Client | null
        if (!client?.id) continue
        const incumbent = bestByClient.get(client.id)
        if (!incumbent) {
          bestByClient.set(client.id, cp)
          continue
        }
        const incumbentFrom = (incumbent.Periods_id as Period).from
        const candidateFrom = (cp.Periods_id as Period).from
        if (candidateFrom > incumbentFrom) bestByClient.set(client.id, cp)
      }

      // Which clients have a contract whose current (latest) version is NOT
      // signed — drives the per-tile "Vertrag nicht unterzeichnet" warning.
      // Clients with no contract at all are never flagged. One batched query;
      // guarded so a not-yet-migrated Contracts collection can't 500 the page.
      const contractWarningClientIds = new Set<string>()
      if (schema?.collections?.Contracts) {
        const clientIds = [...bestByClient.keys()]
        if (clientIds.length > 0) {
          const contractsService = new services.ItemsService('Contracts', {
            schema
          })
          const rows = (await contractsService.readByQuery({
            filter: {
              client: { _in: clientIds },
              status: { _neq: 'archived' }
            },
            fields: ['client', 'version', 'signed', 'status'],
            limit: -1
          })) as {
            client: string | { id: string } | null
            version: number
            signed: boolean
            status: 'published' | 'draft' | 'archived'
          }[]
          const byClient = new Map<
            string,
            {
              version: number
              signed: boolean
              status: (typeof rows)[number]['status']
            }[]
          >()
          for (const row of rows) {
            const id =
              typeof row.client === 'string' ? row.client : row.client?.id
            if (!id) continue
            const list = byClient.get(id) ?? []
            list.push({
              version: row.version,
              signed: row.signed,
              status: row.status
            })
            byClient.set(id, list)
          }
          for (const [id, list] of byClient) {
            if (currentContractNeedsSignature(list)) {
              contractWarningClientIds.add(id)
            }
          }
        }
      }

      const entries: OverviewEntry[] = []
      const pendingClientPeriodIds: number[] = []

      for (const cp of bestByClient.values()) {
        const client = cp.Clients_id as Client
        const period = cp.Periods_id as Period
        const snap = snapshotsByPeriod.get(cp.id)

        const sums =
          snap && snap.computedAt
            ? {
                totalUsedHours: snap.totalUsedHours,
                totalTopUps: snap.totalTopUps,
                totalUsedPercentage: snap.totalUsedPercentage,
                totalAvailableHours: snap.totalAvailableHours,
                totalManualWorkHours: snap.totalManualWorkHours,
                billableHours: snap.billableHours
              }
            : null

        const pending = !snap || !snap.computedAt

        if (pending) pendingClientPeriodIds.push(cp.id)

        entries.push({
          clientPeriodId: cp.id,
          client: {
            id: client.id,
            name: client.name,
            billing_mode:
              (client.billing_mode as 'prepaid' | 'monthly') ?? 'prepaid'
          },
          period: {
            id: period.id,
            from: period.from,
            to: period.to,
            name: period.name
          },
          sums,
          computedAt: snap?.computedAt ?? null,
          lastError: snap?.lastError ?? null,
          lastErrorAt: snap?.lastErrorAt ?? null,
          pending,
          contractWarning: contractWarningClientIds.has(client.id)
        })
      }

      // Fire-and-forget background fill-in for tiles without a snapshot row
      // yet. We don't await — the page just shows "wird berechnet…" for that
      // tile and the next reload picks up the value.
      if (pendingClientPeriodIds.length > 0) {
        void backgroundRefreshMany(context, pendingClientPeriodIds).catch(
          (err) =>
            console.warn(
              '[clientsOverview] background refresh failed:',
              err instanceof Error ? err.message : err
            )
        )
      }

      return res.send({
        data: entries,
        generatedAt: new Date().toISOString()
      })
    } catch (e) {
      return next(e)
    }
  })

  /**
   * Force-recompute a single client period's snapshot. Invalidates the
   * in-memory `billingCache` key first so the upstream Clockodo + Jira calls
   * actually re-execute; then upserts into `BillingSnapshots`.
   */
  router.post('/refresh', async (req: any, res, next) => {
    try {
      const accountability = req.accountability
      if (!accountability?.user) return next(new ForbiddenError())
      if (!accountability.admin) return next(new ForbiddenError())

      const clientPeriodIdRaw = req.query?.clientPeriodId
      if (!clientPeriodIdRaw) {
        return next(
          new InvalidPayloadError({ reason: 'Missing param clientPeriodId' })
        )
      }
      const clientPeriodId = Number(clientPeriodIdRaw)
      if (!Number.isFinite(clientPeriodId)) {
        return next(
          new InvalidPayloadError({ reason: 'clientPeriodId must be numeric' })
        )
      }

      let env
      try {
        env = readBillingEnv(context.env)
      } catch {
        return next(new MissingEnvError())
      }

      const { services } = context
      const schema = await context.getSchema()
      const clientPeriodsService: ItemsServiceLike<ClientPeriod> =
        new services.ItemsService('Clients_Periods', { schema })
      const snapshotsService: SnapshotsServiceLike = new services.ItemsService(
        'BillingSnapshots',
        { schema }
      )

      const cp = await clientPeriodsService.readOne(clientPeriodId, {
        fields: [
          'id',
          'topUps.*',
          'manualWorkEntries.*',
          'Clients_id.*',
          'Periods_id.*'
        ]
      })

      const client = cp.Clients_id as Client | null
      const period = cp.Periods_id as Period | null
      if (!client || !period) {
        return next(
          new InvalidPayloadError({
            reason: 'Client period missing client or period'
          })
        )
      }
      if (!client.clockodo_customer_id || !client.jira_short_code) {
        return next(
          new InvalidPayloadError({
            reason: 'Client missing clockodo_customer_id or jira_short_code'
          })
        )
      }

      // Drop the in-memory cache so the recompute hits live Clockodo + Jira.
      getBillingCache().invalidate(billingCacheKey(client.id, clientPeriodId))

      try {
        const billing = await computeClientPeriodBilling(
          {
            clockodoCustomerId: client.clockodo_customer_id,
            jiraPrefix: client.jira_short_code,
            from: new Date(period.from),
            to: new Date(period.to),
            topUps: (cp.topUps ?? []) as TopUp[],
            manualWorkEntries: (cp.manualWorkEntries ?? []) as ManualWorkEntry[]
          },
          env
        )
        const computedAt = new Date()
        await persistBillingSnapshotSuccess({
          service: snapshotsService,
          clientPeriodId,
          sums: billing.sums,
          computedAt
        })
        return res.send({ ok: true, computedAt: computedAt.toISOString() })
      } catch (error) {
        await persistBillingSnapshotFailure({
          service: snapshotsService,
          clientPeriodId,
          error,
          failedAt: new Date()
        })
        throw error
      }
    } catch (e) {
      return next(e)
    }
  })
})

/**
 * Best-effort background fill for tiles without a snapshot. Runs inline in
 * the endpoint process (no Flow needed for the first hit after deploy).
 * Failures get persisted into the row's `lastError` so the next overview load
 * shows the error tile.
 */
async function backgroundRefreshMany(
  context: any,
  clientPeriodIds: number[]
): Promise<void> {
  const env = readBillingEnv(context.env)
  const schema = await context.getSchema()
  const clientPeriodsService: ItemsServiceLike<ClientPeriod> =
    new context.services.ItemsService('Clients_Periods', { schema })
  const snapshotsService: SnapshotsServiceLike =
    new context.services.ItemsService('BillingSnapshots', { schema })

  for (const cpId of clientPeriodIds) {
    try {
      const cp = await clientPeriodsService.readOne(cpId, {
        fields: [
          'id',
          'topUps.*',
          'manualWorkEntries.*',
          'Clients_id.*',
          'Periods_id.*'
        ]
      })
      const client = cp.Clients_id as Client | null
      const period = cp.Periods_id as Period | null
      if (!client?.clockodo_customer_id || !client?.jira_short_code || !period)
        continue

      const billing = await computeClientPeriodBilling(
        {
          clockodoCustomerId: client.clockodo_customer_id,
          jiraPrefix: client.jira_short_code,
          from: new Date(period.from),
          to: new Date(period.to),
          topUps: (cp.topUps ?? []) as TopUp[],
          manualWorkEntries: (cp.manualWorkEntries ?? []) as ManualWorkEntry[]
        },
        env
      )
      await persistBillingSnapshotSuccess({
        service: snapshotsService,
        clientPeriodId: cpId,
        sums: billing.sums,
        computedAt: new Date()
      })
    } catch (error) {
      await persistBillingSnapshotFailure({
        service: snapshotsService,
        clientPeriodId: cpId,
        error,
        failedAt: new Date()
      }).catch(() => {
        /* swallow — best effort */
      })
    }
  }
}
