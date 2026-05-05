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

const HOURS_FORMATTER = new Intl.NumberFormat('de-CH', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
})

const DATE_FORMATTER = new Intl.DateTimeFormat('de-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})

function formatHours(hours: number): string {
  return `${HOURS_FORMATTER.format(hours)} h`
}

function formatOffset(hours: number): string {
  if (Math.abs(hours) < 0.005) return '±0 h'
  const sign = hours > 0 ? '+' : '−'
  return `${sign}${HOURS_FORMATTER.format(Math.abs(hours))} h`
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return DATE_FORMATTER.format(date)
}

function formatActor(name: string, email: string | null): string {
  const trimmed = name.trim()
  if (trimmed && email) return `${trimmed} (${email})`
  if (trimmed) return trimmed
  if (email) return email
  return 'Unbekannt'
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
 * Compose a single, batched German Slack message that covers all pending
 * threshold warnings for one client. Uses Slack Block Kit so the dashboard
 * links render as buttons and the fallback `text` keeps notifications usable
 * in e-mail digests or mobile previews.
 */
export function composeGermanWarningMessage(
  input: ComposeMessageInput
): ComposedSlackMessage {
  const { clientName, clientPeriodId, warnings, dashboardBaseUrl } = input

  const header = `Freundlicher Hinweis für ${clientName}: ${warnings.length} Jira-Ticket${
    warnings.length === 1 ? '' : 's'
  } ${warnings.length === 1 ? 'hat' : 'haben'} einen Schwellenwert überschritten.`

  const blocks: SlackMessageBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Budget-Warnung', emoji: false }
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
    const line =
      `*<${url}|${warning.jiraIssueKey}>* — Schätzung: ${formatHours(
        warning.estimatedHours
      )}, ` +
      `verbraucht: ${formatHours(warning.totalHoursUsed)} ` +
      `(${warning.usedPercent}%).\n` +
      `_Erste Meldung ab ${formatHours(warning.initialThresholdHours)} ` +
      `Nächste Meldung ab ${formatHours(warning.nextThresholdHours)}._`

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: line },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Arbeit stoppen oder prüfen' },
        url
      }
    })
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text:
          'Im Dashboard kannst Du die Arbeit an einem Ticket stoppen, bis ' +
          'Rücksprache erfolgt ist, oder die Warnung dauerhaft stummschalten. ' +
          'Andernfalls meldet sich der Bot automatisch bei der nächsten ' +
          'Schwelle wieder.'
      }
    ]
  })

  const fallbackText =
    `${header}\n` +
    warnings
      .map(
        (w) =>
          `• ${w.jiraIssueKey}: ${formatHours(w.totalHoursUsed)} / ${formatHours(
            w.estimatedHours
          )} (${w.usedPercent}%) — erste Schwelle ${formatHours(
            w.initialThresholdHours
          )}, nächste Meldung ab ${formatHours(w.nextThresholdHours)}`
      )
      .join('\n')

  return { text: fallbackText, blocks }
}

/**
 * Compose the Slack message that goes out when a client requests a halt on a
 * Jira ticket. The message is intentionally blunt: it tells the channel to
 * stop working on the ticket immediately and explains how the halt is lifted.
 */
export function composeGermanHaltRequestedMessage(
  input: ComposeHaltMessageInput
): ComposedSlackMessage {
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
  const actor = formatActor(actorName, actorEmail)
  const occurredAt = formatTimestamp(occurredAtIso)

  const headline = `:octagonal_sign: Arbeitsstopp für *<${url}|${jiraIssueKey}>* (${clientName})`
  const detail =
    `${actor} hat am ${occurredAt} einen Arbeitsstopp angefordert.\n` +
    '*@We.Publish bitte stellt die Arbeit an diesem Ticket sofort ein.* ' +
    `@${actor} bitte nimm mit dem Projektverantwortlichen Kontakt auf, um das weitere Vorgehen gemeinsam zu besprechen.`

  const blocks: SlackMessageBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Arbeitsstopp angefordert',
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
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Erst wenn ${clientName} den Stop aufhebt, darf an <${url}|${jiraIssueKey}> weitergeareitet werden.`
        }
      ]
    }
  ]

  const fallbackText =
    `ARBEITSSTOPP: ${jiraIssueKey} (${clientName}). ${actor} hat am ${occurredAt} ` +
    'einen Arbeitsstopp angefordert. Bitte stellt die Arbeit sofort ein, bis der ' +
    'Stopp im Dashboard aufgehoben wird.'

  return { text: fallbackText, blocks }
}

/**
 * Compose the Slack message confirming that a previously halted ticket has
 * been released for work again. Mirrors `composeGermanHaltRequestedMessage`
 * so the channel sees a clear "before/after" pair.
 */
export function composeGermanHaltResolvedMessage(
  input: ComposeHaltMessageInput
): ComposedSlackMessage {
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
  const actor = formatActor(actorName, actorEmail)
  const occurredAt = formatTimestamp(occurredAtIso)

  const headline = `:white_check_mark: Arbeitsstopp aufgehoben für *<${url}|${jiraIssueKey}>* (${clientName})`
  const detail =
    `${actor} hat den Arbeitsstopp am ${occurredAt} aufgehoben.\n` +
    'Die Arbeit an diesem Ticket darf wieder aufgenommen werden.'

  const blocks: SlackMessageBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Arbeitsstopp aufgehoben',
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
          text: { type: 'plain_text', text: 'Im Dashboard ansehen' },
          url
        }
      ]
    }
  ]

  const fallbackText =
    `Arbeitsstopp für ${jiraIssueKey} (${clientName}) wurde von ${actor} ` +
    `am ${occurredAt} aufgehoben. Die Arbeit an diesem Ticket kann wieder aufgenommen werden.`

  return { text: fallbackText, blocks }
}

/**
 * Compose the personal Slack DM that goes to the Jira assignee when a halt
 * is requested. Mirrors the channel-wide message but addresses the assignee
 * directly so the person actually working on the ticket sees it without
 * having to scan #-channel chatter.
 */
export function composeGermanHaltRequestedDmMessage(
  input: ComposeHaltDmInput
): ComposedSlackMessage {
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
  const actor = formatActor(actorName, actorEmail)
  const occurredAt = formatTimestamp(occurredAtIso)
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
