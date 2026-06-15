export type BudgetStatus =
  | 'on_track'
  | 'ahead_of_schedule'
  | 'behind_schedule'
  | 'close_to_limit'
  | 'over_budget'
  | 'no_budget'

export interface WeeklyReportProgress {
  budgetUsedPercent: number
  timeElapsedPercent: number
  deltaPercent: number
  status: BudgetStatus
  daysRemaining: number
  periodDurationDays: number
  daysElapsed: number
  totalUsedHours: number
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
  const { $i18n } = useNuxtApp()
  const { formatHours, formatPercent } = useFormatters()

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
    const hasNoBudgetButUsedHours = totalTopUps <= 0 && totalUsedHours > 0

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
      status: deriveStatus({
        budgetUsedPercent,
        deltaPercent,
        hasNoBudgetButUsedHours
      }),
      periodDurationDays,
      daysRemaining,
      daysElapsed,
      totalUsedHours
    }
  }

  function statusColor(
    status: BudgetStatus
  ): 'primary' | 'success' | 'warning' | 'error' | 'info' {
    switch (status) {
      case 'over_budget':
        return 'error'
      case 'no_budget':
        return 'warning'
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
    return $i18n.t(`dashboard.weeklyStatus.${status}.headline`)
  }

  function statusBody(progress: WeeklyReportProgress): string {
    return $i18n.t(`dashboard.weeklyStatus.${progress.status}.body`, {
      used: formatPercent(progress.budgetUsedPercent),
      time: formatPercent(progress.timeElapsedPercent),
      delta: formatPercent(Math.abs(progress.deltaPercent)),
      hours: formatHours(progress.totalUsedHours)
    })
  }

  function statusIcon(status: BudgetStatus): string {
    switch (status) {
      case 'over_budget':
        return 'lucide:triangle-alert'
      case 'no_budget':
        return 'lucide:wallet'
      case 'close_to_limit':
        return 'lucide:circle-alert'
      case 'behind_schedule':
        return 'lucide:hourglass'
      case 'ahead_of_schedule':
        return 'lucide:circle-check'
      case 'on_track':
      default:
        return 'lucide:move-right'
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

function deriveStatus(args: {
  budgetUsedPercent: number
  deltaPercent: number
  hasNoBudgetButUsedHours: boolean
}): BudgetStatus {
  if (args.hasNoBudgetButUsedHours) return 'no_budget'
  if (args.budgetUsedPercent > OVER_BUDGET_THRESHOLD) return 'over_budget'
  if (args.budgetUsedPercent >= CLOSE_TO_LIMIT_THRESHOLD)
    return 'close_to_limit'
  if (args.deltaPercent > ON_TRACK_TOLERANCE) return 'behind_schedule'
  if (args.deltaPercent < -ON_TRACK_TOLERANCE) return 'ahead_of_schedule'
  return 'on_track'
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}
