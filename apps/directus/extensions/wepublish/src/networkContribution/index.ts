import { defineEndpoint } from '@directus/extensions-sdk'
import {
  ContainsNullValuesError,
  ForbiddenError,
  InvalidPayloadError,
  createError
} from '@directus/errors'
import type { ClientPeriod, Period } from '../DirectusTypes'
import { readBillingEnv } from '../shared/billing'
import {
  getNetworkContributionCache,
  loadNetworkContributionResultWithMeta,
  networkContributionCacheKey
} from '../shared/cache/networkContributionCache'
import { computeNetworkContribution } from '../shared/networkContribution'

const MissingEnvError = createError('500', 'Missing env variables.')

/**
 * GET /networkContribution?clientPeriodId=<id>
 *
 * Returns the network-wide work delivered during the same date range as the
 * passed client period — used by the dashboard to show clients the value they
 * receive beyond their direct billing (we.share work split into Acquisition /
 * Engineering / Hosting buckets, plus total hours delivered for other media
 * organizations).
 *
 * The response is cached per `clientPeriodId` because the figures depend only
 * on the period's `from`/`to` dates and Clockodo data — no per-client slicing.
 * Authorization still piggybacks on `ItemsService.readOne` so users can only
 * fetch periods they're allowed to see.
 */
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
        fields: ['id', 'Periods_id.from', 'Periods_id.to']
      })

      const period = clientPeriod.Periods_id as Period | null
      if (!period?.from || !period?.to) {
        return next(
          new ContainsNullValuesError({
            collection: 'Clients_Periods',
            field: 'Periods_id'
          })
        )
      }

      const cache = getNetworkContributionCache()
      const key = networkContributionCacheKey(clientPeriodId)

      const response = await loadNetworkContributionResultWithMeta(
        cache,
        key,
        () =>
          computeNetworkContribution(
            { from: new Date(period.from), to: new Date(period.to) },
            env
          )
      )

      return res.send(response)
    } catch (e) {
      return next(e)
    }
  })

  /** Force-refresh the cached entry for a single period. */
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

      // Same authorization gate as GET — readOne throws ForbiddenError when
      // the user can't see the period, so they can't blow away its cache.
      await clientPeriodService.readOne(clientPeriodId, { fields: ['id'] })

      const invalidated = getNetworkContributionCache().invalidate(
        networkContributionCacheKey(clientPeriodId)
      )

      return res.send({ invalidated })
    } catch (e) {
      return next(e)
    }
  })
})
