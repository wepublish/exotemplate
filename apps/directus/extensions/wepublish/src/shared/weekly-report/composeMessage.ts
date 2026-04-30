import type { ComposedSlackMessage, SlackMessageBlock } from '../notifications'
import type { BudgetStatus, WeeklyReportProgress } from './progress'

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
}

const HOURS_FORMATTER = new Intl.NumberFormat('de-CH', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
})

const PERCENT_FORMATTER = new Intl.NumberFormat('de-CH', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
})

const DATE_FORMATTER = new Intl.DateTimeFormat('de-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric'
})

function formatHours(hours: number): string {
  return `${HOURS_FORMATTER.format(hours)} h`
}

function formatPercent(percent: number): string {
  return `${PERCENT_FORMATTER.format(percent)} %`
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return DATE_FORMATTER.format(date)
}

/**
 * Build a deep link into the dashboard, scrolled to the affected client and
 * period. Re-uses the `/` route which is the dashboard entry point.
 */
export function buildWeeklyReportDashboardUrl(
  dashboardBaseUrl: string,
  clientId: string,
  clientPeriodId: number | null
): string {
  const base = dashboardBaseUrl.replace(/\/+$/, '')
  const params = new URLSearchParams({ clientId })
  if (clientPeriodId != null) {
    params.set('clientPeriodId', String(clientPeriodId))
  }
  return `${base}/?${params.toString()}`
}

interface StatusCopy {
  emoji: string
  headline: string
  body: string
}

function statusCopy(
  status: BudgetStatus,
  args: {
    clientName: string
    deltaPercent: number
    budgetUsedPercent: number
    timeElapsedPercent: number
  }
): StatusCopy {
  const { clientName, deltaPercent, budgetUsedPercent, timeElapsedPercent } =
    args

  const usedFmt = formatPercent(budgetUsedPercent)
  const timeFmt = formatPercent(timeElapsedPercent)
  const absDeltaFmt = formatPercent(Math.abs(deltaPercent))

  switch (status) {
    case 'over_budget':
      return {
        emoji: ':rotating_light:',
        headline: `Budget überschritten – ${clientName}`,
        body:
          `Das Budget ist mit ${usedFmt} bereits über 100 % aufgebraucht ` +
          `(Zeit: ${timeFmt}). Bitte umgehend Rücksprache mit dem Projekt­verantwortlichen nehmen ` +
          'und das weitere Vorgehen abstimmen.'
      }
    case 'close_to_limit':
      return {
        emoji: ':warning:',
        headline: `Budget fast aufgebraucht – ${clientName}`,
        body:
          `${usedFmt} des Budgets sind verbraucht, während ${timeFmt} der Zeit ` +
          'vergangen sind. Bitte plant die letzten Stunden bewusst und meldet euch frühzeitig, ' +
          'falls eine Aufstockung nötig ist.'
      }
    case 'behind_schedule':
      return {
        emoji: ':hourglass_flowing_sand:',
        headline: `Budget verbraucht sich schneller als erwartet – ${clientName}`,
        body:
          `${usedFmt} des Budgets sind weg, aber erst ${timeFmt} der Periode sind vorbei ` +
          `(${absDeltaFmt} schneller als geplant). Schaut, ob ihr im Tempo etwas runter könnt ` +
          'oder ob das Budget angepasst werden muss.'
      }
    case 'ahead_of_schedule':
      return {
        emoji: ':white_check_mark:',
        headline: `Alles im grünen Bereich – ${clientName}`,
        body:
          `Erst ${usedFmt} des Budgets sind genutzt, obwohl ${timeFmt} der Periode ` +
          `vorbei sind (${absDeltaFmt} unter Plan). Aktuell besteht reichlich Spielraum.`
      }
    case 'on_track':
    default:
      return {
        emoji: ':chart_with_upwards_trend:',
        headline: `Budget und Zeit im Gleichlauf – ${clientName}`,
        body:
          `${usedFmt} des Budgets sind verbraucht, ${timeFmt} der Zeit sind vergangen. ` +
          'Alles im erwarteten Rahmen.'
      }
  }
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

/**
 * Compose the weekly Slack report. The message leads with the status verdict
 * (chosen via `status`), shows a side-by-side bar of budget vs. time, and
 * links back to the dashboard for the full picture.
 */
export function composeGermanWeeklyReportMessage(
  input: ComposeWeeklyReportInput,
  clientPeriodId: number | null = null
): ComposedSlackMessage {
  const {
    clientName,
    clientId,
    periodName,
    periodFromIso,
    periodToIso,
    totalTopUpHours,
    totalUsedHours,
    totalAvailableHours,
    progress,
    dashboardBaseUrl
  } = input

  const url = buildWeeklyReportDashboardUrl(
    dashboardBaseUrl,
    clientId,
    clientPeriodId
  )

  const copy = statusCopy(progress.status, {
    clientName,
    deltaPercent: progress.deltaPercent,
    budgetUsedPercent: progress.budgetUsedPercent,
    timeElapsedPercent: progress.timeElapsedPercent
  })

  const periodLabel = periodName
    ? `${periodName} (${formatDate(periodFromIso)} – ${formatDate(periodToIso)})`
    : `${formatDate(periodFromIso)} – ${formatDate(periodToIso)}`

  const summary =
    `${copy.emoji} *${copy.headline}*\n` +
    `_Periode:_ ${periodLabel}\n` +
    `_Verbleibende Tage:_ ${progress.daysRemaining} von ${progress.periodDurationDays}`

  const budgetBar = makeBar(progress.budgetUsedPercent)
  const timeBar = makeBar(progress.timeElapsedPercent)

  const comparison =
    `*Budget:* \`${budgetBar}\` ${formatPercent(progress.budgetUsedPercent)} ` +
    `(${formatHours(totalUsedHours)} / ${formatHours(totalTopUpHours)})\n` +
    `*Zeit:*    \`${timeBar}\` ${formatPercent(progress.timeElapsedPercent)}\n` +
    `*Verfügbar:* ${formatHours(totalAvailableHours)}`

  const blocks: SlackMessageBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Wöchentlicher Projektbericht',
        emoji: false
      }
    },
    { type: 'section', text: { type: 'mrkdwn', text: summary } },
    { type: 'section', text: { type: 'mrkdwn', text: copy.body } },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: comparison } },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Dashboard öffnen' },
          url
        }
      ]
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text:
            'Dieser Bericht wird einmal pro Woche automatisch erstellt. ' +
            'Im Dashboard kann er pro Projekt stummgeschaltet werden.'
        }
      ]
    }
  ]

  const fallbackText =
    `${copy.headline}: ${formatPercent(progress.budgetUsedPercent)} Budget / ` +
    `${formatPercent(progress.timeElapsedPercent)} Zeit. ` +
    `Verfügbar: ${formatHours(totalAvailableHours)} (${periodLabel}).`

  return { text: fallbackText, blocks }
}

export interface ComposeOverBudgetEscalationInput extends ComposeWeeklyReportInput {
  slackChannelHint: string | null
}

/**
 * Variant that targets the controlling channel ("in-finanzen"). Shorter,
 * blunter, and explicit about which client + project manager owns the issue.
 */
export function composeGermanOverBudgetEscalationMessage(
  input: ComposeOverBudgetEscalationInput,
  clientPeriodId: number | null = null
): ComposedSlackMessage {
  const {
    clientName,
    clientId,
    periodName,
    periodFromIso,
    periodToIso,
    totalTopUpHours,
    totalUsedHours,
    progress,
    dashboardBaseUrl,
    slackChannelHint
  } = input

  const url = buildWeeklyReportDashboardUrl(
    dashboardBaseUrl,
    clientId,
    clientPeriodId
  )

  const periodLabel = periodName
    ? `${periodName} (${formatDate(periodFromIso)} – ${formatDate(periodToIso)})`
    : `${formatDate(periodFromIso)} – ${formatDate(periodToIso)}`

  const headline = `:rotating_light: Budget überschritten: *${clientName}*`
  const detail =
    `*Periode:* ${periodLabel}\n` +
    `*Verbraucht:* ${formatHours(totalUsedHours)} / ${formatHours(totalTopUpHours)} ` +
    `(${formatPercent(progress.budgetUsedPercent)})\n` +
    `*Zeit vergangen:* ${formatPercent(progress.timeElapsedPercent)}\n` +
    (slackChannelHint ? `*Projekt-Channel:* <#${slackChannelHint}>\n` : '') +
    'Bitte mit dem Projekt­verantwortlichen das weitere Vorgehen klären (Aufstockung, Stop, Nachverhandlung).'

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
    `Budget überschritten: ${clientName} (${periodLabel}). ` +
    `${formatHours(totalUsedHours)} / ${formatHours(totalTopUpHours)} ` +
    `(${formatPercent(progress.budgetUsedPercent)}).`

  return { text: fallbackText, blocks }
}
