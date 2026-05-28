import { defineOperationApi } from '@directus/extensions-sdk'
import type {
  Client,
  ClientPeriod,
  ManualWorkEntry,
  Period,
  TopUp
} from '../DirectusTypes'
import { computeClientPeriodBilling, readBillingEnv } from '../shared/billing'
import { postSlackMessage } from '../shared/notifications'
import {
  composeGermanOverBudgetEscalationMessage,
  composeGermanWeeklyReportMessage,
  computeWeeklyReportProgress,
  isOverBudget
} from '../shared/weekly-report'

interface ItemsServiceLike<T> {
  readByQuery(query: unknown): Promise<T[]>
  readOne(id: string | number, opts?: unknown): Promise<T>
}

const FINANCE_CHANNEL_FALLBACK = 'C08JDCYPRGD'

export default defineOperationApi({
  id: 'weekly-report',
  handler: async (_options, context: any) => {
    const { services, getSchema, env } = context

    const billingEnv = readBillingEnv(env)
    const slackToken = env.SLACK_BOT_TOKEN as string | undefined
    const dashboardBaseUrl = env.FRONTEND_DASHBOARD_URL as string | undefined
    const financeChannelId =
      (env.SLACK_FINANCE_CHANNEL_ID as string | undefined) ||
      FINANCE_CHANNEL_FALLBACK

    if (!slackToken) throw new Error('Missing env SLACK_BOT_TOKEN')
    if (!dashboardBaseUrl) throw new Error('Missing env FRONTEND_DASHBOARD_URL')

    const schema = await getSchema()
    const clientsService: ItemsServiceLike<Client> = new services.ItemsService(
      'Clients',
      { schema }
    )
    const clientPeriodService: ItemsServiceLike<ClientPeriod> =
      new services.ItemsService('Clients_Periods', { schema })

    const now = new Date()

    const clients = await clientsService.readByQuery({
      filter: { status: { _eq: 'published' } },
      fields: [
        'id',
        'name',
        'jira_short_code',
        'clockodo_customer_id',
        'slack_channel_id',
        'weekly_report_paused',
        'billing_mode'
      ],
      limit: -1
    })

    for (const client of clients) {
      try {
        await processClient({
          client,
          now,
          billingEnv,
          slackToken,
          dashboardBaseUrl,
          financeChannelId,
          clientPeriodService
        })
      } catch (error) {
        console.error(`weekly-report: client "${client.name}" failed`, error)
      }
    }
  }
})

interface ProcessClientArgs {
  client: Client
  now: Date
  billingEnv: ReturnType<typeof readBillingEnv>
  slackToken: string
  dashboardBaseUrl: string
  financeChannelId: string
  clientPeriodService: ItemsServiceLike<ClientPeriod>
}

async function processClient(args: ProcessClientArgs): Promise<void> {
  const { client } = args

  if (!client.slack_channel_id) return
  if (!client.clockodo_customer_id || !client.jira_short_code) return
  if (client.weekly_report_paused === true) return

  const activePeriod = await findCurrentClientPeriod(
    args.clientPeriodService,
    client.id,
    args.now
  )
  if (!activePeriod) return

  const period = activePeriod.Periods_id as Period

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

  const progress = computeWeeklyReportProgress({
    sums: billing.sums,
    periodFrom: new Date(period.from),
    periodTo: new Date(period.to),
    now: args.now
  })

  const reportInput = {
    clientName: client.name,
    clientId: client.id,
    periodName: period.name,
    periodFromIso: period.from,
    periodToIso: period.to,
    totalTopUpHours: billing.sums.totalTopUps,
    totalUsedHours: billing.sums.totalUsedHours,
    totalAvailableHours: billing.sums.totalAvailableHours,
    progress,
    dashboardBaseUrl: args.dashboardBaseUrl,
    billingMode: client.billing_mode ?? 'prepaid'
  }

  const projectMessage = composeGermanWeeklyReportMessage(
    reportInput,
    activePeriod.id
  )

  const projectResult = await postSlackMessage({
    token: args.slackToken,
    channel: client.slack_channel_id,
    message: projectMessage
  })

  if (!projectResult.ok) {
    throw new Error(
      `Slack rejected weekly report for ${client.name}: ${projectResult.error ?? 'unknown'}`
    )
  }

  if (isOverBudget(progress.status)) {
    const escalation = composeGermanOverBudgetEscalationMessage(
      { ...reportInput, slackChannelHint: client.slack_channel_id },
      activePeriod.id
    )

    const financeResult = await postSlackMessage({
      token: args.slackToken,
      channel: args.financeChannelId,
      message: escalation
    })

    if (!financeResult.ok) {
      throw new Error(
        `Slack rejected over-budget escalation for ${client.name}: ${financeResult.error ?? 'unknown'}`
      )
    }
  }
}

/**
 * Mirrors the helper used by the jira-threshold-notifier: returns the period
 * that overlaps `now`, with the latest `from` date winning when several do.
 */
async function findCurrentClientPeriod(
  service: ItemsServiceLike<ClientPeriod>,
  clientId: string,
  now: Date
): Promise<ClientPeriod | null> {
  const today = now.toISOString()

  const rows = await service.readByQuery({
    filter: {
      Clients_id: { _eq: clientId },
      Periods_id: { from: { _lte: today }, to: { _gte: today } }
    },
    fields: [
      'id',
      'topUps.*',
      'manualWorkEntries.*',
      'Periods_id.id',
      'Periods_id.from',
      'Periods_id.to',
      'Periods_id.name'
    ],
    limit: -1
  })

  if (rows.length === 0) return null

  return rows.reduce((best, candidate) => {
    const bestFrom = (best.Periods_id as Period).from
    const candidateFrom = (candidate.Periods_id as Period).from
    return candidateFrom > bestFrom ? candidate : best
  })
}
