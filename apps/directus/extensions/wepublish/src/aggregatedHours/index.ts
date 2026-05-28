import { defineEndpoint } from '@directus/extensions-sdk'
import {
  ContainsNullValuesError,
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
  persistBillingSnapshotSuccess,
  readBillingEnv,
  type SnapshotsServiceLike,
  type Sums
} from '../shared/billing'
import {
  billingCacheKey,
  getBillingCache,
  loadBillingResultWithMeta
} from '../shared/cache'

const MissingEnvError = createError('500', 'Missing env variables.')

export default defineEndpoint((router, context) => {
  router.get('/', async (req: any, res, next) => {
    try {
      const accountability = req.accountability
      if (!accountability?.user) {
        return next(new ForbiddenError())
      }

      let env
      try {
        env = readBillingEnv(context.env)
      } catch {
        return next(new MissingEnvError())
      }

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
        fields: [
          '*',
          'topUps.*',
          'manualWorkEntries.*',
          'Clients_id.*',
          'Periods_id.*'
        ]
      })

      const client = clientPeriod.Clients_id as Client | null
      const period = clientPeriod.Periods_id as Period | null

      if (!client || !period) {
        return next(
          new ContainsNullValuesError({
            collection: 'Clients_Periods',
            field: 'id'
          })
        )
      }
      if (!client.clockodo_customer_id) {
        return next(
          new ContainsNullValuesError({
            collection: 'Client',
            field: 'clockodo_customer_id'
          })
        )
      }
      if (!client.jira_short_code) {
        return next(
          new ContainsNullValuesError({
            collection: 'Client',
            field: 'jira_short_code'
          })
        )
      }

      const cache = getBillingCache()
      const key = billingCacheKey(client.id, clientPeriodId)

      // Cache the third-party-heavy compute. ItemsService access checks ran
      // above, so we know this user is allowed to read the entry; the cached
      // value is identical regardless of which authorized user requested it.
      // The wrapper exposes hit/miss + cachedAt + expiresAt so the dashboard
      // can show users where the data came from.
      const response = await loadBillingResultWithMeta(cache, key, () =>
        computeClientPeriodBilling(
          {
            clockodoCustomerId: client.clockodo_customer_id!,
            jiraPrefix: client.jira_short_code!,
            from: new Date(period.from),
            to: new Date(period.to),
            topUps: (clientPeriod.topUps ?? []) as TopUp[],
            manualWorkEntries: (clientPeriod.manualWorkEntries ??
              []) as ManualWorkEntry[]
          },
          env
        )
      )

      // Side-effect: when this request actually recomputed (cache miss), also
      // upsert the persistent BillingSnapshots row so the /overview tile stays
      // fresh. Fire-and-forget — the user doesn't wait for it, and a write
      // failure must not bleed into the live response.
      if (!response.cache.hit && context.getSchema && services?.ItemsService) {
        void persistSnapshotInBackground(
          context,
          accountability,
          Number(clientPeriodId),
          response.data.sums
        )
      }

      return res.send(response)
    } catch (e) {
      return next(e)
    }
  })

  /**
   * Invalidates the cached aggregatedHours result for one specific
   * (client, clientPeriod) pair. The dashboard's "refresh" action calls this
   * before re-fetching so users can force-pull fresh Jira/Clockodo data.
   *
   * Authorization piggybacks on Directus' row-level perms: ItemsService.readOne
   * with the request's accountability throws ForbiddenError if the user can't
   * see the period, so only users who could fetch it can invalidate it.
   */
  router.delete('/cache', async (req: any, res, next) => {
    try {
      const accountability = req.accountability
      if (!accountability?.user) {
        return next(new ForbiddenError())
      }

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

      const client = clientPeriod.Clients_id as Client | null
      if (!client) {
        return next(
          new ContainsNullValuesError({
            collection: 'Clients_Periods',
            field: 'Clients_id'
          })
        )
      }

      const invalidated = getBillingCache().invalidate(
        billingCacheKey(client.id, clientPeriodId)
      )

      return res.send({ invalidated })
    } catch (e) {
      return next(e)
    }
  })

  /**
   * Best-effort persistence to the `BillingSnapshots` table so the /overview
   * tiles stay current as users browse single-period detail pages. Skips
   * silently if the snapshot collection isn't in the schema yet (pre
   * `schema:load`) or if the write fails — the /aggregatedHours response has
   * already been sent and a snapshot mismatch isn't worth a 500.
   */
  async function persistSnapshotInBackground(
    ctx: any,
    accountability: any,
    clientPeriodId: number,
    sums: Sums
  ): Promise<void> {
    try {
      const schema = await ctx.getSchema()
      if (!schema?.collections?.BillingSnapshots) return
      const snapshotsService: SnapshotsServiceLike =
        new ctx.services.ItemsService('BillingSnapshots', {
          schema,
          accountability
        })
      await persistBillingSnapshotSuccess({
        service: snapshotsService,
        clientPeriodId,
        sums,
        computedAt: new Date()
      })
    } catch (error) {
      console.warn(
        '[aggregatedHours] snapshot upsert failed (non-fatal):',
        error instanceof Error ? error.message : error
      )
    }
  }
})
