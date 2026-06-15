import { createSlackFormatters, type SlackLocale } from '../i18n/locale'
import { NOTIFICATIONS_COPY } from '../i18n/notificationsCopy'
import type { ComputedWarning } from './thresholds'

export interface SlackMessageBlock {
  type: string
  [key: string]: unknown
}

export interface ComposedSlackMessage {
  text: string
  blocks: SlackMessageBlock[]
}

export interface ComposeMessageInput {
  clientName: string
  /**
   * Numeric `Clients_Periods.id` of the period the warning belongs to. Used
   * to deep-link the Slack notification straight to that period's
   * Arbeitsprotokoll page (`/[clientPeriodId]/work-log?issue=...`).
   */
  clientPeriodId: number
  warnings: ComputedWarning[]
  dashboardBaseUrl: string
}

export interface ComposeHaltMessageInput {
  clientName: string
  /** Same as `ComposeMessageInput.clientPeriodId`. */
  clientPeriodId: number
  jiraIssueKey: string
  actorName: string
  actorEmail: string | null
  occurredAtIso: string
  dashboardBaseUrl: string
}

export interface ComposeHaltDmInput extends ComposeHaltMessageInput {
  /** Display name of the Jira assignee, used to address them personally. */
  assigneeName: string | null
}

function formatActor(
  name: string,
  email: string | null,
  unknownLabel: string
): string {
  const trimmed = name.trim()
  if (trimmed && email) return `${trimmed} (${email})`
  if (trimmed) return trimmed
  if (email) return email
  return unknownLabel
}

/**
 * Build a deep link into the Arbeitsprotokoll page for one specific
 * (clientPeriod, Jira issue) pair. Matches the route shape consumed by
 * `app/pages/[clientPeriodId]/work-log.vue` — `?issue=<key>` triggers the
 * focus + scroll-into-view behaviour on arrival.
 */
export function buildWorkLogUrl(
  dashboardBaseUrl: string,
  clientPeriodId: number,
  jiraIssueKey: string
): string {
  const base = dashboardBaseUrl.replace(/\/+$/, '')
  const params = new URLSearchParams({ issue: jiraIssueKey })
  return `${base}/${clientPeriodId}/work-log?${params.toString()}`
}

/**
 * Compose a single, batched Slack message that covers all pending threshold
 * warnings for one client, in the project's language. Uses Slack Block Kit so
 * the dashboard links render as buttons and the fallback `text` keeps
 * notifications usable in e-mail digests or mobile previews.
 */
export function composeWarningMessage(
  input: ComposeMessageInput,
  locale: SlackLocale = 'de'
): ComposedSlackMessage {
  const copy = NOTIFICATIONS_COPY[locale].warning
  const fmt = createSlackFormatters(locale)
  const { clientName, clientPeriodId, warnings, dashboardBaseUrl } = input

  const header = copy.header(clientName, warnings.length)

  const blocks: SlackMessageBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: copy.blockHeader, emoji: false }
    },
    { type: 'section', text: { type: 'mrkdwn', text: header } },
    { type: 'divider' }
  ]

  for (const warning of warnings) {
    const url = buildWorkLogUrl(
      dashboardBaseUrl,
      clientPeriodId,
      warning.jiraIssueKey
    )
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: copy.line({
          url,
          key: warning.jiraIssueKey,
          estimate: fmt.formatHours(warning.estimatedHours),
          used: fmt.formatHours(warning.totalHoursUsed),
          usedPercent: warning.usedPercent,
          initialThreshold: fmt.formatHours(warning.initialThresholdHours),
          nextThreshold: fmt.formatHours(warning.nextThresholdHours)
        })
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: copy.stopButton },
        url
      }
    })
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: copy.footer }]
  })

  const fallbackText =
    `${header}\n` +
    warnings
      .map((w) =>
        copy.fallbackLine({
          url: '',
          key: w.jiraIssueKey,
          estimate: fmt.formatHours(w.estimatedHours),
          used: fmt.formatHours(w.totalHoursUsed),
          usedPercent: w.usedPercent,
          initialThreshold: fmt.formatHours(w.initialThresholdHours),
          nextThreshold: fmt.formatHours(w.nextThresholdHours)
        })
      )
      .join('\n')

  return { text: fallbackText, blocks }
}

/**
 * Compose the Slack message that goes out when a client requests a halt on a
 * Jira ticket, in the project's language. Intentionally blunt: stop working on
 * the ticket immediately and explain how the halt is lifted.
 */
export function composeHaltRequestedMessage(
  input: ComposeHaltMessageInput,
  locale: SlackLocale = 'de'
): ComposedSlackMessage {
  const copy = NOTIFICATIONS_COPY[locale].haltRequested
  const fmt = createSlackFormatters(locale)
  const {
    clientName,
    clientPeriodId,
    jiraIssueKey,
    actorName,
    actorEmail,
    occurredAtIso,
    dashboardBaseUrl
  } = input

  const url = buildWorkLogUrl(dashboardBaseUrl, clientPeriodId, jiraIssueKey)
  const actor = formatActor(
    actorName,
    actorEmail,
    NOTIFICATIONS_COPY[locale].unknownActor
  )
  const occurredAt = fmt.formatTimestamp(occurredAtIso)

  const headline = copy.headline({ url, key: jiraIssueKey, clientName })
  const detail = copy.detail({ actor, occurredAt })

  const blocks: SlackMessageBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: copy.header, emoji: false }
    },
    { type: 'section', text: { type: 'mrkdwn', text: headline } },
    { type: 'section', text: { type: 'mrkdwn', text: detail } },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          style: 'danger',
          text: { type: 'plain_text', text: copy.button },
          url
        }
      ]
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: copy.context({ clientName, url, key: jiraIssueKey })
        }
      ]
    }
  ]

  const fallbackText = copy.fallback({
    url,
    key: jiraIssueKey,
    clientName,
    actor,
    occurredAt
  })

  return { text: fallbackText, blocks }
}

/**
 * Compose the Slack message confirming that a previously halted ticket has
 * been released for work again, in the project's language. Mirrors
 * `composeHaltRequestedMessage` so the channel sees a clear "before/after"
 * pair.
 */
export function composeHaltResolvedMessage(
  input: ComposeHaltMessageInput,
  locale: SlackLocale = 'de'
): ComposedSlackMessage {
  const copy = NOTIFICATIONS_COPY[locale].haltResolved
  const fmt = createSlackFormatters(locale)
  const {
    clientName,
    clientPeriodId,
    jiraIssueKey,
    actorName,
    actorEmail,
    occurredAtIso,
    dashboardBaseUrl
  } = input

  const url = buildWorkLogUrl(dashboardBaseUrl, clientPeriodId, jiraIssueKey)
  const actor = formatActor(
    actorName,
    actorEmail,
    NOTIFICATIONS_COPY[locale].unknownActor
  )
  const occurredAt = fmt.formatTimestamp(occurredAtIso)

  const headline = copy.headline({ url, key: jiraIssueKey, clientName })
  const detail = copy.detail({ actor, occurredAt })

  const blocks: SlackMessageBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: copy.header, emoji: false }
    },
    { type: 'section', text: { type: 'mrkdwn', text: headline } },
    { type: 'section', text: { type: 'mrkdwn', text: detail } },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: copy.button },
          url
        }
      ]
    }
  ]

  const fallbackText = copy.fallback({
    url,
    key: jiraIssueKey,
    clientName,
    actor,
    occurredAt
  })

  return { text: fallbackText, blocks }
}

/**
 * Compose the personal Slack DM that goes to the Jira assignee when a halt is
 * requested. Mirrors the channel-wide message but addresses the assignee
 * directly. Stays German: the assignee is a We.Publish employee, so this DM is
 * an internal message and does not follow the project's language.
 */
export function composeGermanHaltRequestedDmMessage(
  input: ComposeHaltDmInput
): ComposedSlackMessage {
  const fmt = createSlackFormatters('de')
  const {
    clientName,
    clientPeriodId,
    jiraIssueKey,
    actorName,
    actorEmail,
    occurredAtIso,
    dashboardBaseUrl,
    assigneeName
  } = input

  const url = buildWorkLogUrl(dashboardBaseUrl, clientPeriodId, jiraIssueKey)
  const actor = formatActor(actorName, actorEmail, 'Unbekannt')
  const occurredAt = fmt.formatTimestamp(occurredAtIso)
  const greeting = assigneeName?.trim()
    ? `Hallo ${assigneeName.trim()},`
    : 'Hallo,'

  const headline = `:octagonal_sign: Arbeitsstopp für *<${url}|${jiraIssueKey}>* (${clientName})`
  const detail =
    `${greeting}\n` +
    `dir ist das Ticket *<${url}|${jiraIssueKey}>* zugewiesen. ` +
    `${actor} hat am ${occurredAt} für ${clientName} einen Arbeitsstopp angefordert.\n\n` +
    '*Bitte stelle die Arbeit an diesem Ticket sofort ein* und stimme das ' +
    'weitere Vorgehen mit der Projektverantwortlichen Person ab.'

  const blocks: SlackMessageBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Arbeitsstopp für dein Ticket',
        emoji: false
      }
    },
    { type: 'section', text: { type: 'mrkdwn', text: headline } },
    { type: 'section', text: { type: 'mrkdwn', text: detail } },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          style: 'danger',
          text: { type: 'plain_text', text: 'Im Dashboard ansehen' },
          url
        }
      ]
    }
  ]

  const fallbackText =
    `ARBEITSSTOPP: ${jiraIssueKey} (${clientName}). ${actor} hat am ${occurredAt} ` +
    'einen Arbeitsstopp für dein zugewiesenes Ticket angefordert. Bitte stelle die ' +
    'Arbeit sofort ein.'

  return { text: fallbackText, blocks }
}
