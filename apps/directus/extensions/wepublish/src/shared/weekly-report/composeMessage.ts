import type { BillingMode } from '../../DirectusTypes'
import { createSlackFormatters, type SlackLocale } from '../i18n/locale'
import { WEEKLY_REPORT_COPY } from '../i18n/weeklyReportCopy'
import type { ComposedSlackMessage, SlackMessageBlock } from '../notifications'
import type { WeeklyReportProgress } from './progress'

export interface ComposeWeeklyReportInput {
  clientName: string
  clientId: string
  periodName: string | null
  periodFromIso: string
  periodToIso: string
  totalTopUpHours: number
  totalUsedHours: number
  totalAvailableHours: number
  progress: WeeklyReportProgress
  dashboardBaseUrl: string
  billingMode: BillingMode
}

/**
 * Build a deep link into the dashboard for the affected billing period. The
 * frontend carries the selection in the URL **path** (`/:clientPeriodId/…`), so
 * we link straight to that period's dashboard. With no period we fall back to
 * the bare root, which redirects to the user's default selection.
 */
export function buildWeeklyReportDashboardUrl(
  dashboardBaseUrl: string,
  clientPeriodId: number | null
): string {
  const base = dashboardBaseUrl.replace(/\/+$/, '')
  return clientPeriodId != null
    ? `${base}/${clientPeriodId}/dashboard`
    : `${base}/`
}

/**
 * Build a textual ASCII bar so the comparison is glanceable in clients that
 * don't render Block Kit (mobile previews, e-mail digests). Uses 20 segments.
 */
function makeBar(percent: number): string {
  const total = 20
  const filled = Math.max(
    0,
    Math.min(total, Math.round((percent * total) / 100))
  )
  return '█'.repeat(filled) + '░'.repeat(total - filled)
}

function periodLabel(
  input: ComposeWeeklyReportInput,
  formatDate: (iso: string) => string
): string {
  const range = `${formatDate(input.periodFromIso)} – ${formatDate(input.periodToIso)}`
  return input.periodName ? `${input.periodName} (${range})` : range
}

/**
 * Compose the weekly Slack report in the project's language. Routes by
 * `billingMode`:
 *  - `monthly`: no progress bars — shows the hours that will be billed.
 *  - `prepaid`: budget-vs-time layout, with a dedicated layout for the
 *    `no_budget` status (top-ups missing but hours logged).
 */
export function composeWeeklyReportMessage(
  input: ComposeWeeklyReportInput,
  clientPeriodId: number | null = null,
  locale: SlackLocale = 'de'
): ComposedSlackMessage {
  if (input.billingMode === 'monthly') {
    return composeMonthlyWeeklyReportMessage(input, clientPeriodId, locale)
  }
  return composePrepaidWeeklyReportMessage(input, clientPeriodId, locale)
}

function composePrepaidWeeklyReportMessage(
  input: ComposeWeeklyReportInput,
  clientPeriodId: number | null,
  locale: SlackLocale
): ComposedSlackMessage {
  const copy = WEEKLY_REPORT_COPY[locale]
  const fmt = createSlackFormatters(locale)
  const {
    clientName,
    totalTopUpHours,
    totalUsedHours,
    totalAvailableHours,
    progress,
    dashboardBaseUrl
  } = input

  const url = buildWeeklyReportDashboardUrl(dashboardBaseUrl, clientPeriodId)

  const statusCopy = copy.status[progress.status]
  const headline = statusCopy.headline(clientName)
  const body = statusCopy.body({
    used: fmt.formatPercent(progress.budgetUsedPercent),
    time: fmt.formatPercent(progress.timeElapsedPercent),
    absDelta: fmt.formatPercent(Math.abs(progress.deltaPercent)),
    hours: fmt.formatHours(totalUsedHours)
  })

  const label = periodLabel(input, fmt.formatDate)

  const summary =
    `${statusCopy.emoji} *${headline}*\n` +
    `_${copy.periodWord}:_ ${label}\n` +
    `_${copy.daysRemainingLabel}:_ ${progress.daysRemaining} ${copy.daysConnector} ${progress.periodDurationDays}`

  // The no_budget case keeps the prepaid frame (it's still a prepaid client)
  // but the budget bar is meaningless — there's nothing to divide by. We
  // surface the raw hours instead and keep the time bar for context.
  const isNoBudget = progress.status === 'no_budget'

  const timeBar = makeBar(progress.timeElapsedPercent)
  const comparison = isNoBudget
    ? `*${copy.usedHoursLabel}:* ${fmt.formatHours(totalUsedHours)} *(${copy.separatelyBilledNote})*\n` +
      `*${copy.topUpBudgetLabel}:* ${fmt.formatHours(totalTopUpHours)}\n` +
      `*${copy.timeLabel}:*    \`${timeBar}\` ${fmt.formatPercent(progress.timeElapsedPercent)}`
    : (() => {
        const budgetBar = makeBar(progress.budgetUsedPercent)
        return (
          `*${copy.budgetLabel}:* \`${budgetBar}\` ${fmt.formatPercent(progress.budgetUsedPercent)} ` +
          `(${fmt.formatHours(totalUsedHours)} / ${fmt.formatHours(totalTopUpHours)})\n` +
          `*${copy.timeLabel}:*    \`${timeBar}\` ${fmt.formatPercent(progress.timeElapsedPercent)}\n` +
          `*${copy.availableLabel}:* ${fmt.formatHours(totalAvailableHours)}`
        )
      })()

  const blocks: SlackMessageBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: copy.header, emoji: false }
    },
    { type: 'section', text: { type: 'mrkdwn', text: summary } },
    { type: 'section', text: { type: 'mrkdwn', text: body } },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: comparison } },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: copy.dashboardButton },
          url
        }
      ]
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: copy.footerNote }]
    }
  ]

  const fallbackText = isNoBudget
    ? copy.fallbackNoBudget({
        headline,
        hours: fmt.formatHours(totalUsedHours),
        periodLabel: label
      })
    : copy.fallbackNormal({
        headline,
        budgetPercent: fmt.formatPercent(progress.budgetUsedPercent),
        timePercent: fmt.formatPercent(progress.timeElapsedPercent),
        available: fmt.formatHours(totalAvailableHours),
        periodLabel: label
      })

  return { text: fallbackText, blocks }
}

/**
 * Monthly billing variant: no progress bar, no budget comparison. Clients on
 * `billing_mode: 'monthly'` get invoiced after the fact at the higher hourly
 * rate, so the weekly report's job is to surface the hours that will land on
 * the next invoice — nothing else.
 */
function composeMonthlyWeeklyReportMessage(
  input: ComposeWeeklyReportInput,
  clientPeriodId: number | null,
  locale: SlackLocale
): ComposedSlackMessage {
  const copy = WEEKLY_REPORT_COPY[locale]
  const fmt = createSlackFormatters(locale)
  const { clientName, totalAvailableHours, dashboardBaseUrl } = input

  const url = buildWeeklyReportDashboardUrl(dashboardBaseUrl, clientPeriodId)

  const label = periodLabel(input, fmt.formatDate)

  // For monthly clients the dashboard's "Verfügbare Arbeitsstunden" (=
  // totalAvailableHours) goes negative as soon as work outstrips already-
  // invoiced top-ups. The next invoice covers exactly that gap, so the
  // amount to bill is the negation, floored at 0 (positive availability
  // means a credit balance: nothing to bill yet).
  const remainingToBillHours = Math.max(0, -totalAvailableHours)
  const remainingFmt = fmt.formatHours(remainingToBillHours)

  const headline = copy.monthly.headline(clientName)
  const body =
    remainingToBillHours > 0
      ? copy.monthly.bodyOpen(remainingFmt)
      : copy.monthly.bodyNone

  const summary =
    `${headline}\n` +
    `_${copy.periodWord}:_ ${label}\n` +
    `_${copy.monthly.toBillLabel}:_ *${remainingFmt}*`

  const blocks: SlackMessageBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: copy.header, emoji: false }
    },
    { type: 'section', text: { type: 'mrkdwn', text: summary } },
    { type: 'section', text: { type: 'mrkdwn', text: body } },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: copy.dashboardButton },
          url
        }
      ]
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: copy.footerNote }]
    }
  ]

  const fallbackText = copy.monthly.fallback({
    clientName,
    hours: remainingFmt,
    periodLabel: label
  })

  return { text: fallbackText, blocks }
}

export interface ComposeOverBudgetEscalationInput extends ComposeWeeklyReportInput {
  slackChannelHint: string | null
}

/**
 * Variant that targets the controlling channel ("in-finanzen"). Shorter,
 * blunter, and explicit about which client + project manager owns the issue.
 *
 * Stays German: this is an internal We.Publish controlling message, not a
 * client-facing one, so it does not follow the project's language.
 */
export function composeGermanOverBudgetEscalationMessage(
  input: ComposeOverBudgetEscalationInput,
  clientPeriodId: number | null = null
): ComposedSlackMessage {
  const fmt = createSlackFormatters('de')
  const {
    clientName,
    totalTopUpHours,
    totalUsedHours,
    progress,
    dashboardBaseUrl,
    slackChannelHint
  } = input

  const url = buildWeeklyReportDashboardUrl(dashboardBaseUrl, clientPeriodId)

  const label = periodLabel(input, fmt.formatDate)

  const headline = `:rotating_light: Budget überschritten: *${clientName}*`
  const detail =
    `*Periode:* ${label}\n` +
    `*Verbraucht:* ${fmt.formatHours(totalUsedHours)} / ${fmt.formatHours(totalTopUpHours)} ` +
    `(${fmt.formatPercent(progress.budgetUsedPercent)})\n` +
    `*Zeit vergangen:* ${fmt.formatPercent(progress.timeElapsedPercent)}\n` +
    (slackChannelHint ? `*Projekt-Channel:* <#${slackChannelHint}>\n` : '') +
    'Bitte mit dem Projektverantwortlichen das weitere Vorgehen klären (Aufstockung, Stop, Nachverhandlung).'

  const blocks: SlackMessageBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Controlling-Hinweis: Budget überschritten',
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
          text: { type: 'plain_text', text: 'Im Dashboard prüfen' },
          url
        }
      ]
    }
  ]

  const fallbackText =
    `Budget überschritten: ${clientName} (${label}). ` +
    `${fmt.formatHours(totalUsedHours)} / ${fmt.formatHours(totalTopUpHours)} ` +
    `(${fmt.formatPercent(progress.budgetUsedPercent)}).`

  return { text: fallbackText, blocks }
}
