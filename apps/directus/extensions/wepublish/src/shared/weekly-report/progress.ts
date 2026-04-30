import type { Sums } from '../billing'

export type BudgetStatus =
  | 'on_track'
  | 'ahead_of_schedule'
  | 'behind_schedule'
  | 'close_to_limit'
  | 'over_budget'

export interface WeeklyReportProgress {
  /** Percentage of budgeted hours already consumed (0-∞). */
  budgetUsedPercent: number
  /** Percentage of the period that has elapsed (0-100). */
  timeElapsedPercent: number
  /** budgetUsedPercent - timeElapsedPercent. Positive = budget burns faster than time. */
  deltaPercent: number
  /** Categorical assessment used to pick wording / colour. */
  status: BudgetStatus
  /** Days remaining in the period (0 if past `to`). */
  daysRemaining: number
  /** Total length of the period in days. */
  periodDurationDays: number
}

/**
 * Tolerance in percentage points within which the project is considered
 * "on track". Anything outside this band is either ahead or behind schedule.
 */
const ON_TRACK_TOLERANCE = 10

/**
 * Number of percentage points of budget usage at which the wording switches
 * from "regular" to "close to the limit".
 */
const CLOSE_TO_LIMIT_THRESHOLD = 90

const OVER_BUDGET_THRESHOLD = 100

const MS_PER_DAY = 1000 * 60 * 60 * 24

/**
 * Compute the time-vs-budget comparison that drives both the dashboard UI
 * and the weekly Slack report. The status is the primary signal: it picks the
 * wording and colour, and decides whether the controlling channel needs to
 * be looped in.
 */
export function computeWeeklyReportProgress(args: {
  sums: Pick<Sums, 'totalUsedHours' | 'totalTopUps'>
  periodFrom: Date
  periodTo: Date
  now: Date
}): WeeklyReportProgress {
  const { sums, periodFrom, periodTo, now } = args

  const totalTopUps = Number(sums.totalTopUps) || 0
  const totalUsedHours = Number(sums.totalUsedHours) || 0

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

  return {
    budgetUsedPercent,
    timeElapsedPercent,
    deltaPercent,
    status: deriveStatus(budgetUsedPercent, deltaPercent),
    daysRemaining,
    periodDurationDays
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

export function isOverBudget(status: BudgetStatus): boolean {
  return status === 'over_budget'
}

export {
  ON_TRACK_TOLERANCE,
  CLOSE_TO_LIMIT_THRESHOLD,
  OVER_BUDGET_THRESHOLD,
  MS_PER_DAY
}
