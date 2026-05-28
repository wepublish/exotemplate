import { defineOperationApi } from '@directus/extensions-sdk'
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
  type SnapshotsServiceLike
} from '../shared/billing'
import { findCurrentClientPeriod } from '../shared/clientPeriods'
import { runWithConcurrency } from '../shared/concurrency'

interface ItemsServiceLike<T> {
  readByQuery(query: unknown): Promise<T[]>
}

const DEFAULT_CONCURRENCY = 3

export default defineOperationApi({
  id: 'billing-snapshot-refresh',
  handler: async (_options, context: any) => {
    const { services, getSchema, env } = context

    const billingEnv = readBillingEnv(env)
    const schema = await getSchema()

    const clientsService: ItemsServiceLike<Client> = new services.ItemsService(
      'Clients',
      { schema }
    )
    const clientPeriodService: ItemsServiceLike<ClientPeriod> =
      new services.ItemsService('Clients_Periods', { schema })
    const snapshotsService: SnapshotsServiceLike = new services.ItemsService(
      'BillingSnapshots',
      { schema }
    )

    const clients = await clientsService.readByQuery({
      filter: { status: { _eq: 'published' } },
      fields: [
        'id',
        'name',
        'jira_short_code',
        'clockodo_customer_id',
        'billing_mode'
      ],
      limit: -1
    })

    const now = new Date()

    const tasks = clients.map((client) => async () => {
      await refreshOneClient({
        client,
        now,
        billingEnv,
        clientPeriodService,
        snapshotsService
      })
    })

    const settled = await runWithConcurrency(tasks, DEFAULT_CONCURRENCY)
    const failed = settled.filter((r) => r.status === 'rejected')

    if (failed.length > 0) {
      console.warn(
        `billing-snapshot-refresh: ${failed.length}/${clients.length} clients failed (rest succeeded)`
      )
      for (const f of failed) {
        if (f.status === 'rejected') console.warn(f.reason)
      }
    }

    return {
      attempted: clients.length,
      failed: failed.length,
      succeeded: settled.length - failed.length
    }
  }
})

interface RefreshArgs {
  client: Client
  now: Date
  billingEnv: ReturnType<typeof readBillingEnv>
  clientPeriodService: ItemsServiceLike<ClientPeriod>
  snapshotsService: SnapshotsServiceLike
}

async function refreshOneClient(args: RefreshArgs): Promise<void> {
  const { client } = args
  if (!client.clockodo_customer_id || !client.jira_short_code) return

  const activePeriod = await findCurrentClientPeriod(
    args.clientPeriodService,
    client.id,
    args.now,
    { extraFields: ['topUps.*', 'manualWorkEntries.*'] }
  )
  if (!activePeriod) return

  const period = activePeriod.Periods_id as Period

  try {
    const billing = await computeClientPeriodBilling(
      {
        clockodoCustomerId: client.clockodo_customer_id,
        jiraPrefix: client.jira_short_code,
        from: new Date(period.from),
        to: new Date(period.to),
        topUps: (activePeriod.topUps ?? []) as TopUp[],
        manualWorkEntries: (activePeriod.manualWorkEntries ??
          []) as ManualWorkEntry[]
      },
      args.billingEnv
    )

    await persistBillingSnapshotSuccess({
      service: args.snapshotsService,
      clientPeriodId: activePeriod.id,
      sums: billing.sums,
      computedAt: args.now
    })
  } catch (error) {
    await persistBillingSnapshotFailure({
      service: args.snapshotsService,
      clientPeriodId: activePeriod.id,
      error,
      failedAt: args.now
    })
    // Rethrow so the operation-level `Promise.allSettled` records the failure,
    // but the snapshot row is already annotated before we exit.
    throw new Error(
      `billing-snapshot-refresh: client "${client.name}" failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}
