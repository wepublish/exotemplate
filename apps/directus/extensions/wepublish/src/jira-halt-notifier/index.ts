import { defineHook } from '@directus/extensions-sdk'
import type {
  Client,
  ClientPeriod,
  JiraWarning,
  Period
} from '../DirectusTypes'
import { getJiraIssueAssignee } from '../shared/billing/jira'
import { resolveClientLocale } from '../shared/i18n/locale'
import {
  composeGermanHaltRequestedDmMessage,
  composeHaltRequestedMessage,
  composeHaltResolvedMessage,
  isClientPaused,
  lookupSlackUserIdByEmail,
  postSlackMessage,
  type ComposedSlackMessage
} from '../shared/notifications'

type HaltTransition = 'requested' | 'resolved'

interface HookUser {
  id: string | null
  first_name?: string | null
  last_name?: string | null
  email?: string | null
}

interface ItemsServiceLike<T> {
  readOne(id: string | number, opts?: unknown): Promise<T>
  readByQuery?(query: unknown): Promise<T[]>
}

/**
 * Remembers the halt transition the filter hook detected for each JiraWarnings
 * key so the paired action hook knows whether to post a "requested" or
 * "resolved" Slack message after the DB update has succeeded. Module-level
 * state is fine here because Directus runs filter + action for the same update
 * synchronously in the same Node process.
 */
const pendingHaltTransitions = new Map<string, HaltTransition>()

/**
 * Directus hook that:
 *  1. Fills in server-authoritative authorship fields
 *     (halt_requested_by/at or halt_resolved_by/at) whenever a client toggles
 *     the `halt_requested` flag via the SDK.
 *  2. Posts a Slack message to the client's channel on every real transition,
 *     so the billing team knows to stop or resume work on the ticket.
 *
 * The frontend only has to send `{ halt_requested: true | false }`. Everything
 * else — timestamps, who triggered it, the Slack side-effect — is handled here
 * so clients cannot impersonate each other and the workflow stays consistent.
 */
export default defineHook(({ filter, action }, { services, env }) => {
  const { ItemsService } = services as {
    ItemsService: new (
      collection: string,
      opts: { schema: unknown; knex?: unknown; accountability?: unknown }
    ) => ItemsServiceLike<unknown>
  }

  filter(
    'JiraWarnings.items.update',
    async (payload: any, meta: any, context: any) => {
      if (!payload || typeof payload.halt_requested !== 'boolean') {
        return payload
      }

      const keys: string[] = Array.isArray(meta?.keys) ? meta.keys : []
      const warningService = new ItemsService('JiraWarnings', {
        schema: context.schema,
        knex: context.database
      }) as ItemsServiceLike<JiraWarning>

      for (const key of keys) {
        try {
          const prior = await warningService.readOne(key)
          if (prior.halt_requested !== payload.halt_requested) {
            pendingHaltTransitions.set(
              key,
              payload.halt_requested ? 'requested' : 'resolved'
            )
          }
        } catch {
          // If we can't read the prior state we treat the request as a
          // transition so the channel still gets notified — better to
          // over-inform than to miss a halt.
          pendingHaltTransitions.set(
            key,
            payload.halt_requested ? 'requested' : 'resolved'
          )
        }
      }

      const userId: string | null = context.accountability?.user ?? null
      const nowIso = new Date().toISOString()

      if (payload.halt_requested) {
        payload.halt_requested_by = userId
        payload.halt_requested_at = nowIso
        payload.halt_resolved_by = null
        payload.halt_resolved_at = null
      } else {
        payload.halt_resolved_by = userId
        payload.halt_resolved_at = nowIso
      }

      return payload
    }
  )

  action('JiraWarnings.items.update', async (meta: any, context: any) => {
    const keys: string[] = Array.isArray(meta?.keys) ? meta.keys : []
    if (!keys.length) return

    const slackToken = (env.SLACK_BOT_TOKEN as string | undefined) ?? ''
    const dashboardBaseUrl =
      (env.FRONTEND_DASHBOARD_URL as string | undefined) ?? ''
    const jiraEmail = (env.JIRA_EMAIL as string | undefined) ?? ''
    const jiraApiKey = (env.JIRA_API_KEY as string | undefined) ?? ''

    const warningService = new ItemsService('JiraWarnings', {
      schema: context.schema,
      knex: context.database
    }) as ItemsServiceLike<JiraWarning>
    const clientService = new ItemsService('Clients', {
      schema: context.schema,
      knex: context.database
    }) as ItemsServiceLike<Client>
    const clientPeriodService = new ItemsService('Clients_Periods', {
      schema: context.schema,
      knex: context.database
    }) as ItemsServiceLike<ClientPeriod>
    const userService = new ItemsService('directus_users', {
      schema: context.schema,
      knex: context.database
    }) as ItemsServiceLike<HookUser>

    for (const key of keys) {
      const transition = pendingHaltTransitions.get(key)
      pendingHaltTransitions.delete(key)
      if (!transition) continue

      try {
        await notifyHaltTransition({
          warningId: key,
          transition,
          warningService,
          clientService,
          clientPeriodService,
          userService,
          slackToken,
          dashboardBaseUrl,
          jiraEmail,
          jiraApiKey
        })
      } catch (error) {
        console.error(
          `jira-halt-notifier: Slack notification for warning ${key} failed`,
          error
        )
      }
    }
  })
})

interface NotifyArgs {
  warningId: string
  transition: HaltTransition
  warningService: ItemsServiceLike<JiraWarning>
  clientService: ItemsServiceLike<Client>
  clientPeriodService: ItemsServiceLike<ClientPeriod>
  userService: ItemsServiceLike<HookUser>
  slackToken: string
  dashboardBaseUrl: string
  jiraEmail: string
  jiraApiKey: string
}

async function notifyHaltTransition(args: NotifyArgs): Promise<void> {
  if (!args.slackToken || !args.dashboardBaseUrl) return

  const warning = await args.warningService.readOne(args.warningId)
  const clientRef = warning.client
  const clientId =
    typeof clientRef === 'string' ? clientRef : (clientRef as Client | null)?.id
  if (!clientId) return

  const client = await args.clientService.readOne(clientId)
  if (!client.slack_channel_id) return
  if (isClientPaused(client.notifications_paused)) return

  // The deep link goes to the client's currently active billing period.
  // No fallback: without an active period there's no Arbeitsprotokoll page
  // to land on, and we'd rather skip the notification than send a broken URL.
  const clientPeriodId = await findCurrentClientPeriodId(
    args.clientPeriodService,
    clientId,
    new Date()
  )
  if (clientPeriodId == null) {
    console.warn(
      `jira-halt-notifier: no active period for client ${client.name} — skipping Slack notification for ${warning.jira_issue_key}`
    )
    return
  }

  const actorId =
    args.transition === 'requested'
      ? warning.halt_requested_by
      : warning.halt_resolved_by
  const actor = await loadActor(args.userService, actorId)

  const occurredAtIso =
    args.transition === 'requested'
      ? (warning.halt_requested_at ?? new Date().toISOString())
      : (warning.halt_resolved_at ?? new Date().toISOString())

  const payload = {
    clientName: client.name,
    clientPeriodId,
    jiraIssueKey: warning.jira_issue_key,
    actorName:
      [actor.first_name ?? '', actor.last_name ?? ''].join(' ').trim() || '',
    actorEmail: actor.email ?? null,
    occurredAtIso,
    dashboardBaseUrl: args.dashboardBaseUrl
  }

  const locale = resolveClientLocale(client.language)
  const message: ComposedSlackMessage =
    args.transition === 'requested'
      ? composeHaltRequestedMessage(payload, locale)
      : composeHaltResolvedMessage(payload, locale)

  const result = await postSlackMessage({
    token: args.slackToken,
    channel: client.slack_channel_id,
    message
  })

  if (!result.ok) {
    console.error(
      `jira-halt-notifier: Slack rejected message for ${client.name}: ${
        result.error ?? 'unknown'
      }`
    )
  }

  if (args.transition === 'requested') {
    await notifyAssigneeDm({
      payload,
      jiraIssueKey: warning.jira_issue_key,
      slackToken: args.slackToken,
      jiraEmail: args.jiraEmail,
      jiraApiKey: args.jiraApiKey
    })
  }
}

/**
 * Best-effort personal DM to the Jira assignee. Any missing piece — Jira
 * credentials, no assignee, assignee unknown to Slack, Slack rejects the
 * post — is logged but never thrown: the channel-wide halt message has
 * already gone out and is the authoritative signal.
 */
async function notifyAssigneeDm(args: {
  payload: Omit<
    Parameters<typeof composeGermanHaltRequestedDmMessage>[0],
    'assigneeName'
  >
  jiraIssueKey: string
  slackToken: string
  jiraEmail: string
  jiraApiKey: string
}): Promise<void> {
  if (!args.jiraEmail || !args.jiraApiKey) {
    console.warn(
      `jira-halt-notifier: skipping assignee DM for ${args.jiraIssueKey} — JIRA_EMAIL/JIRA_API_KEY not configured`
    )
    return
  }

  const assignee = await getJiraIssueAssignee(args.jiraIssueKey, {
    jiraEmail: args.jiraEmail,
    jiraApiKey: args.jiraApiKey
  })
  if (!assignee?.email) {
    console.info(
      `jira-halt-notifier: ${args.jiraIssueKey} has no assignee email — skipping DM`
    )
    return
  }

  const slackUserId = await lookupSlackUserIdByEmail(
    args.slackToken,
    assignee.email
  )
  if (!slackUserId) return

  const dmMessage = composeGermanHaltRequestedDmMessage({
    ...args.payload,
    assigneeName: assignee.displayName
  })

  const result = await postSlackMessage({
    token: args.slackToken,
    channel: slackUserId,
    message: dmMessage
  })

  if (!result.ok) {
    console.error(
      `jira-halt-notifier: Slack rejected DM to assignee ${assignee.email} for ${args.jiraIssueKey}: ${
        result.error ?? 'unknown'
      }`
    )
  }
}

async function loadActor(
  userService: ItemsServiceLike<HookUser>,
  actorRef: string | unknown | null | undefined
): Promise<HookUser> {
  if (!actorRef) return { id: null }
  if (typeof actorRef !== 'string') {
    return actorRef as HookUser
  }
  try {
    return await userService.readOne(actorRef)
  } catch {
    return { id: actorRef }
  }
}

/**
 * Returns the `Clients_Periods.id` considered "current" for `clientId` at
 * `now`. When more than one period overlaps, the one with the latest
 * `Periods.from` wins — mirrors `findCurrentClientPeriod` in the threshold
 * notifier. Returns null when the client has no overlapping period.
 */
async function findCurrentClientPeriodId(
  service: ItemsServiceLike<ClientPeriod>,
  clientId: string,
  now: Date
): Promise<number | null> {
  if (!service.readByQuery) return null
  const today = now.toISOString()
  const rows = await service.readByQuery({
    filter: {
      Clients_id: { _eq: clientId },
      Periods_id: { from: { _lte: today }, to: { _gte: today } }
    },
    fields: ['id', 'Periods_id.from'],
    limit: -1
  })

  if (!rows.length) return null

  const best = rows.reduce((winner, candidate) => {
    const winnerFrom = (winner.Periods_id as Period).from
    const candidateFrom = (candidate.Periods_id as Period).from
    return candidateFrom > winnerFrom ? candidate : winner
  })

  return best.id ?? null
}
