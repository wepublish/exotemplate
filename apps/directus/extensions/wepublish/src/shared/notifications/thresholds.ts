import type { JiraWarning, NotificationThreshold } from '../../DirectusTypes'

export interface IssueUsage {
  jiraIssueKey: string
  estimatedHours: number
  /**
   * Total hours ever logged against the Jira issue on Clockodo — i.e. all
   * work inside the current billing period plus the rolling 12-month window
   * before it. The threshold logic compares this against `estimatedHours`.
   */
  totalHoursUsed: number
}

export interface ComputedWarning {
  jiraIssueKey: string
  estimatedHours: number
  totalHoursUsed: number
  usedPercent: number
  crossedThresholdHours: number
  /**
   * Stundenwert, ab dem die nächste Slack-Meldung ausgelöst würde, wenn das
   * Ticket nicht stummgeschaltet ist. Für ein arithmetisches Schema mit
   * Abstand `recurring` ist das einfach `crossedThresholdHours + recurring`.
   */
  nextThresholdHours: number
}

export interface ThresholdSchedule {
  initialHours: number
  recurringHours: number
}

/**
 * Coerces a Directus numeric column to a JavaScript number. Postgres returns
 * `decimal` / `numeric` columns as strings through the `pg` driver, so naive
 * arithmetic ends up doing string concatenation (e.g. `"9" + 2 * "4" === "98"`
 * instead of `17`). All callers that need to do math on threshold values
 * should normalise at the boundary through this helper.
 */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (value == null) return NaN
  const n = Number(value)
  return Number.isFinite(n) ? n : NaN
}

/**
 * Picks the threshold config whose `min_hours_inclusive` is the largest value
 * still `<=` the given estimation. Returns null when every config requires a
 * larger estimation than the issue has.
 *
 * Example: configs with min_hours_inclusive = 0.25, 1, 5 and estimate 3
 * selects the "1 h" config. Estimate 5 selects the "5 h" config. Estimate
 * 0.25 selects the "0.25 h" config (the bound is inclusive).
 */
export function selectThresholdForHours(
  estimatedHours: number,
  configs: NotificationThreshold[]
): ThresholdSchedule | null {
  const estimated = toNumber(estimatedHours)
  if (!Number.isFinite(estimated)) return null

  let match: NotificationThreshold | null = null
  let matchMinHours = -Infinity
  for (const config of configs) {
    const min = toNumber(config.min_hours_inclusive)
    if (!Number.isFinite(min)) continue
    if (estimated < min) continue
    if (!match || min > matchMinHours) {
      match = config
      matchMinHours = min
    }
  }
  if (!match) return null

  const initialHours = toNumber(match.initial_threshold_hours)
  const recurringHours = toNumber(match.recurring_threshold_hours)
  if (!Number.isFinite(initialHours)) return null
  if (!Number.isFinite(recurringHours) || recurringHours <= 0) return null

  return { initialHours, recurringHours }
}

/**
 * Returns the highest threshold (in hours) the current usage has crossed, or
 * null when the usage is still below the initial threshold. Thresholds form
 * an arithmetic progression: initial, initial + recurring,
 * initial + 2·recurring and so on — no upper bound.
 *
 * Example: initial 9h, recurring 4h → 9, 13, 17, 21, ...
 *   currentHours 8   → null (below initial)
 *   currentHours 9   → 9
 *   currentHours 20  → 17 (9 + 2·4)
 */
export function highestCrossedThreshold(
  currentHours: number,
  schedule: ThresholdSchedule
): number | null {
  const current = toNumber(currentHours)
  const initialHours = toNumber(schedule.initialHours)
  const recurringHours = toNumber(schedule.recurringHours)
  if (
    !Number.isFinite(current) ||
    !Number.isFinite(initialHours) ||
    !Number.isFinite(recurringHours)
  ) {
    return null
  }
  if (current < initialHours) return null
  if (!(recurringHours > 0)) return initialHours
  const steps = Math.floor((current - initialHours) / recurringHours)
  return initialHours + steps * recurringHours
}

/**
 * Whether a new Slack warning should fire for an issue, given the prior
 * warning state. Returns false when the issue is permanently silenced, or when
 * the currently crossed threshold is not above the last one we already
 * notified the channel about — each threshold crossing is announced once.
 */
export function shouldNotify(
  crossedHours: number | null,
  prior: JiraWarning | null | undefined
): boolean {
  if (crossedHours == null) return false
  if (prior?.silenced_permanently) return false
  const lastNotified = toNumber(prior?.last_notified_hours ?? 0)
  if (!Number.isFinite(lastNotified)) return true
  return crossedHours > lastNotified
}

/**
 * Compute the list of issues that need notifying for a single client, based on
 * current usage, threshold config and prior warning state. Issues without an
 * estimation are skipped.
 */
export function computePendingWarnings(args: {
  issues: IssueUsage[]
  thresholdConfigs: NotificationThreshold[]
  warningsByKey: Map<string, JiraWarning>
}): ComputedWarning[] {
  const pending: ComputedWarning[] = []

  for (const issue of args.issues) {
    const estimatedHours = toNumber(issue.estimatedHours)
    const totalHoursUsed = toNumber(issue.totalHoursUsed)
    if (!(estimatedHours > 0)) continue

    const schedule = selectThresholdForHours(
      estimatedHours,
      args.thresholdConfigs
    )
    if (!schedule) continue

    const crossed = highestCrossedThreshold(totalHoursUsed, schedule)
    if (!shouldNotify(crossed, args.warningsByKey.get(issue.jiraIssueKey))) {
      continue
    }

    const crossedHours = toNumber(crossed)
    const nextThresholdHours = crossedHours + schedule.recurringHours
    if (
      !Number.isFinite(crossedHours) ||
      !Number.isFinite(nextThresholdHours)
    ) {
      continue
    }

    pending.push({
      jiraIssueKey: issue.jiraIssueKey,
      estimatedHours,
      totalHoursUsed,
      usedPercent: percentUsed(totalHoursUsed, estimatedHours),
      crossedThresholdHours: crossedHours,
      nextThresholdHours
    })
  }

  return pending
}

export function percentUsed(current: number, estimated: number): number {
  const c = toNumber(current)
  const e = toNumber(estimated)
  if (!Number.isFinite(e) || e <= 0) return 0
  if (!Number.isFinite(c)) return 0
  return Math.round((c * 100) / e)
}

export function isClientPaused(paused: boolean | null | undefined): boolean {
  return paused === true
}
