export type BudgetStatus =
  | 'on_track'
  | 'ahead_of_schedule'
  | 'behind_schedule'
  | 'close_to_limit'
  | 'over_budget'

export interface WeeklyReportProgress {
  budgetUsedPercent: number
  timeElapsedPercent: number
  deltaPercent: number
  status: BudgetStatus
  daysRemaining: number
  periodDurationDays: number
  daysElapsed: number
}

const ON_TRACK_TOLERANCE = 10
const CLOSE_TO_LIMIT_THRESHOLD = 90
const OVER_BUDGET_THRESHOLD = 100
const MS_PER_DAY = 1000 * 60 * 60 * 24

/**
 * Frontend mirror of the backend `computeWeeklyReportProgress` helper. Kept
 * in sync intentionally; both sides need the same status / wording rules so
 * that the dashboard and the weekly Slack report agree on whether a project
 * is on track, ahead, behind, close to or over budget.
 */
export function useWeeklyReportProgress() {
  function compute(args: {
    totalUsedHours: number | undefined
    totalTopUps: number | undefined
    periodFrom: string | Date | null | undefined
    periodTo: string | Date | null | undefined
    now?: Date
  }): WeeklyReportProgress | null {
    const periodFrom = args.periodFrom ? new Date(args.periodFrom) : null
    const periodTo = args.periodTo ? new Date(args.periodTo) : null
    if (!periodFrom || !periodTo) return null
    if (Number.isNaN(periodFrom.getTime()) || Number.isNaN(periodTo.getTime()))
      return null

    const now = args.now ?? new Date()
    const totalTopUps = Number(args.totalTopUps) || 0
    const totalUsedHours = Number(args.totalUsedHours) || 0

    const budgetUsedPercent =
      totalTopUps > 0 ? (totalUsedHours * 100) / totalTopUps : 0

    const periodDurationMs = Math.max(
      1,
      periodTo.getTime() - periodFrom.getTime()
    )
    const elapsedMs = clamp(
      now.getTime() - periodFrom.getTime(),
      0,
      periodDurationMs
    )
    const timeElapsedPercent = (elapsedMs * 100) / periodDurationMs

    const deltaPercent = budgetUsedPercent - timeElapsedPercent

    const periodDurationDays = Math.max(
      1,
      Math.round(periodDurationMs / MS_PER_DAY)
    )
    const daysRemaining = Math.max(
      0,
      Math.round((periodTo.getTime() - now.getTime()) / MS_PER_DAY)
    )
    const daysElapsed = periodDurationDays - daysRemaining

    return {
      budgetUsedPercent,
      timeElapsedPercent,
      deltaPercent,
      status: deriveStatus(budgetUsedPercent, deltaPercent),
      periodDurationDays,
      daysRemaining,
      daysElapsed
    }
  }

  function statusColor(
    status: BudgetStatus
  ): 'primary' | 'success' | 'warning' | 'error' | 'info' {
    switch (status) {
      case 'over_budget':
        return 'error'
      case 'close_to_limit':
        return 'warning'
      case 'behind_schedule':
        return 'warning'
      case 'ahead_of_schedule':
        return 'success'
      case 'on_track':
      default:
        return 'primary'
    }
  }

  function statusHeadline(status: BudgetStatus): string {
    switch (status) {
      case 'over_budget':
        return 'Budget überschritten'
      case 'close_to_limit':
        return 'Budget fast aufgebraucht'
      case 'behind_schedule':
        return 'Budget verbraucht sich schneller als die Zeit'
      case 'ahead_of_schedule':
        return 'Mehr Budget übrig als erwartet'
      case 'on_track':
      default:
        return 'Budget und Zeit im Gleichlauf'
    }
  }

  function statusBody(progress: WeeklyReportProgress): string {
    const usedFmt = formatPercent(progress.budgetUsedPercent)
    const timeFmt = formatPercent(progress.timeElapsedPercent)
    const absDeltaFmt = formatPercent(Math.abs(progress.deltaPercent))

    switch (progress.status) {
      case 'over_budget':
        return `${usedFmt} des Budgets verbraucht. Bitte mit dem Projektverantwortlichen Rücksprache nehmen.`
      case 'close_to_limit':
        return `${usedFmt} des Budgets verbraucht, ${timeFmt} der Zeit vergangen. Letzte Stunden bewusst planen.`
      case 'behind_schedule':
        return `${usedFmt} des Budgets verbraucht, aber erst ${timeFmt} der Zeit vergangen (${absDeltaFmt} schneller als geplant).`
      case 'ahead_of_schedule':
        return `Erst ${usedFmt} des Budgets verbraucht, ${timeFmt} der Zeit vergangen (${absDeltaFmt} unter Plan). Reichlich Spielraum.`
      case 'on_track':
      default:
        return `${usedFmt} Budget, ${timeFmt} Zeit. Alles im erwarteten Rahmen.`
    }
  }

  function statusIcon(status: BudgetStatus): string {
    switch (status) {
      case 'over_budget':
        return 'material-symbols:warning-rounded'
      case 'close_to_limit':
        return 'material-symbols:error-outline-rounded'
      case 'behind_schedule':
        return 'material-symbols:hourglass-bottom-rounded'
      case 'ahead_of_schedule':
        return 'material-symbols:check-circle-rounded'
      case 'on_track':
      default:
        return 'material-symbols:trending-flat-rounded'
    }
  }

  return {
    compute,
    statusColor,
    statusHeadline,
    statusBody,
    statusIcon
  }
}

function deriveStatus(
  budgetUsedPercent: number,
  deltaPercent: number
): BudgetStatus {
  if (budgetUsedPercent > OVER_BUDGET_THRESHOLD) return 'over_budget'
  if (budgetUsedPercent >= CLOSE_TO_LIMIT_THRESHOLD) return 'close_to_limit'
  if (deltaPercent > ON_TRACK_TOLERANCE) return 'behind_schedule'
  if (deltaPercent < -ON_TRACK_TOLERANCE) return 'ahead_of_schedule'
  return 'on_track'
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function formatPercent(value: number): string {
  return `${Math.round(value)} %`
}
