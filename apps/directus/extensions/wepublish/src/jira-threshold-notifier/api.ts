import { defineOperationApi } from '@directus/extensions-sdk'
import type {
  Client,
  ClientPeriod,
  JiraWarning,
  ManualWorkEntry,
  NotificationThreshold,
  Period,
  TopUp
} from '../DirectusTypes'
import {
  SECONDS_PER_HOUR,
  computeClientPeriodBilling,
  readBillingEnv,
  type EntryGroup,
  type EntryGroupComputed
} from '../shared/billing'
import { findCurrentClientPeriod } from '../shared/clientPeriods'
import { resolveClientLocale } from '../shared/i18n/locale'
import {
  composeWarningMessage,
  computePendingWarnings,
  isClientPaused,
  postSlackMessage,
  type ComputedWarning,
  type IssueUsage
} from '../shared/notifications'

interface ItemsServiceLike<T> {
  readByQuery(query: unknown): Promise<T[]>
  readOne(id: string | number, opts?: unknown): Promise<T>
  createOne(data: Partial<T>): Promise<string | number>
  updateOne(id: string | number, data: Partial<T>): Promise<string | number>
}

export default defineOperationApi({
  id: 'jira-threshold-notifier',
  handler: async (_options, context: any) => {
    const { services, getSchema, env } = context

    const billingEnv = readBillingEnv(env)
    const slackToken = env.SLACK_BOT_TOKEN as string | undefined
    const dashboardBaseUrl = env.FRONTEND_DASHBOARD_URL as string | undefined

    if (!slackToken) throw new Error('Missing env SLACK_BOT_TOKEN')
    if (!dashboardBaseUrl) throw new Error('Missing env FRONTEND_DASHBOARD_URL')

    const schema = await getSchema()
    const clientsService: ItemsServiceLike<Client> = new services.ItemsService(
      'Clients',
      { schema }
    )
    const clientPeriodService: ItemsServiceLike<ClientPeriod> =
      new services.ItemsService('Clients_Periods', { schema })
    const thresholdService: ItemsServiceLike<NotificationThreshold> =
      new services.ItemsService('NotificationThresholds', { schema })
    const warningService: ItemsServiceLike<JiraWarning> =
      new services.ItemsService('JiraWarnings', { schema })

    const now = new Date()

    const [clients, thresholdConfigs] = await Promise.all([
      clientsService.readByQuery({
        filter: { status: { _eq: 'published' } },
        fields: [
          'id',
          'name',
          'jira_short_code',
          'clockodo_customer_id',
          'slack_channel_id',
          'notifications_paused',
          'language'
        ],
        limit: -1
      }),
      thresholdService.readByQuery({
        filter: { status: { _eq: 'published' } },
        sort: ['min_hours_inclusive'],
        limit: -1
      })
    ])

    for (const client of clients) {
      try {
        await processClient({
          client,
          now,
          thresholdConfigs,
          billingEnv,
          slackToken,
          dashboardBaseUrl,
          clientPeriodService,
          warningService
        })
      } catch (error) {
        console.error(
          `jira-threshold-notifier: client "${client.name}" failed`,
          error
        )
      }
    }
  }
})

interface ProcessClientArgs {
  client: Client
  now: Date
  thresholdConfigs: NotificationThreshold[]
  billingEnv: ReturnType<typeof readBillingEnv>
  slackToken: string
  dashboardBaseUrl: string
  clientPeriodService: ItemsServiceLike<ClientPeriod>
  warningService: ItemsServiceLike<JiraWarning>
}

async function readJiraWarnings(
  service: ItemsServiceLike<JiraWarning>,
  clientId: string,
  keys: string[]
): Promise<JiraWarning[]> {
  return service.readByQuery({
    filter: {
      client: { _eq: clientId },
      jira_issue_key: { _in: keys }
    },
    limit: -1
  })
}

async function processClient(args: ProcessClientArgs): Promise<void> {
  const { client } = args

  if (!client.slack_channel_id) return
  if (!client.clockodo_customer_id || !client.jira_short_code) return
  if (isClientPaused(client.notifications_paused)) return

  const activePeriod = await findCurrentClientPeriod(
    args.clientPeriodService,
    client.id,
    args.now,
    { extraFields: ['topUps.*', 'manualWorkEntries.*'] }
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

  const issueUsages = extractIssueUsages(billing)

  if (issueUsages.length === 0) return

  const warnings = await readJiraWarnings(
    args.warningService,
    client.id,
    issueUsages.map((i) => i.jiraIssueKey)
  )
  const warningsByKey = new Map<string, JiraWarning>(
    warnings.map((w) => [w.jira_issue_key, w])
  )

  const pending = computePendingWarnings({
    issues: issueUsages,
    thresholdConfigs: args.thresholdConfigs,
    warningsByKey
  })

  if (pending.length === 0) return

  const message = composeWarningMessage(
    {
      clientName: client.name,
      clientPeriodId: activePeriod.id,
      warnings: pending,
      dashboardBaseUrl: args.dashboardBaseUrl
    },
    resolveClientLocale(client.language)
  )

  const slackResult = await postSlackMessage({
    token: args.slackToken,
    channel: client.slack_channel_id,
    message
  })

  if (!slackResult.ok) {
    throw new Error(
      `Slack rejected the message for ${client.name}: ${slackResult.error ?? 'unknown'}`
    )
  }

  await persistWarnings(args.warningService, client.id, pending, warningsByKey)
}

/**
 * Walk the decorated Jira group and collect one IssueUsage per estimated
 * issue. `totalHoursUsed` combines the hours logged inside the billing period
 * (`durationCurrent`) with the rolling 12-month history before the period
 * (`durationPast`), so the threshold logic compares Clockodo's full effort
 * on the ticket against the Jira estimate. Hours are converted from
 * Clockodo's seconds representation.
 */
function extractIssueUsages(billing: EntryGroupComputed): IssueUsage[] {
  const jiraGroup = billing.groups.find((g: EntryGroup) => !!g.billability)
  if (!jiraGroup) return []

  return jiraGroup.sub_groups
    .filter((issue) => !!issue.billability && !!issue.jiraIssue)
    .map((issue) => {
      const billability = issue.billability!
      const totalSeconds =
        (billability.durationPast || 0) + (billability.durationCurrent || 0)
      return {
        jiraIssueKey: issue.name,
        estimatedHours: (billability.durationJira || 0) / SECONDS_PER_HOUR,
        totalHoursUsed: totalSeconds / SECONDS_PER_HOUR
      }
    })
    .filter((usage) => usage.estimatedHours > 0)
}

async function persistWarnings(
  warningService: ItemsServiceLike<JiraWarning>,
  clientId: string,
  pending: ComputedWarning[],
  existing: Map<string, JiraWarning>
): Promise<void> {
  const nowIso = new Date().toISOString()

  for (const warning of pending) {
    const prior = existing.get(warning.jiraIssueKey)
    if (prior) {
      await warningService.updateOne(prior.id, {
        last_notified_hours: warning.crossedThresholdHours,
        next_threshold_hours: warning.nextThresholdHours,
        date_updated: nowIso
      })
    } else {
      await warningService.createOne({
        status: 'published',
        client: clientId,
        jira_issue_key: warning.jiraIssueKey,
        last_notified_hours: warning.crossedThresholdHours,
        next_threshold_hours: warning.nextThresholdHours,
        halt_requested: false,
        halt_requested_by: null,
        halt_requested_at: null,
        halt_resolved_by: null,
        halt_resolved_at: null,
        silenced_permanently: false,
        silenced_by: null,
        silenced_at: null
      })
    }
  }
}
