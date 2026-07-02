/**
 * Pure resource-planning math. No Clockodo/Directus/HTTP here — just the
 * budget-distribution and utilization rules, so the tricky spec logic is fully
 * unit-tested. The endpoint layer feeds it normalized numbers.
 *
 * Documented assumptions (from the spec's "offene Punkte"):
 *  - The annual budget is a hard upper bound: intensive phases never push the
 *    yearly total above it. If phases sum above the budget, they're scaled down
 *    proportionally and the base load becomes 0.
 *  - Base (non-phase) load is spread evenly over the weeks NOT covered by any
 *    phase. If every week is covered, the leftover base is spread over all weeks.
 *  - Overlapping phases on the same week add up.
 *  - Distribution is kept as precise floats; rounding (to 0.25 h) is a display
 *    concern handled in the UI, so totals stay exact here.
 */

export interface IntensivePhaseInput {
  /** Zero-based indices into the planning weeks this phase covers. */
  weeks: number[]
  /** Total effort of the phase, in hours (spread evenly across its weeks). */
  hours: number
}

/** Base (evenly-spread) vs intensive (phase-concentrated) load per week. */
export interface BudgetSplit {
  base: number[]
  intensive: number[]
}

/**
 * Like {@link distributeAnnualBudget}, but keeps the two components separate so
 * the UI can stack them: `intensive` is the (capped) phase hours concentrated in
 * their weeks; `base` is the remaining budget spread over the non-phase weeks
 * (or all weeks when every week is covered). Elementwise `base + intensive`
 * equals the combined distribution.
 */
export function distributeAnnualBudgetSplit(
  annualHours: number,
  weekCount: number,
  phases: IntensivePhaseInput[],
  minWeekly = 0,
  closedWeeks: boolean[] = []
): BudgetSplit {
  const base = new Array<number>(weekCount).fill(0)
  const intensive = new Array<number>(weekCount).fill(0)
  if (weekCount <= 0) return { base, intensive }
  // A project with no annual budget can still carry a minimum weekly load
  // (lower border), so we only bail early when there's nothing to place at all.
  if (annualHours <= 0 && minWeekly <= 0) return { base, intensive }

  const isClosed = (i: number): boolean => closedWeeks[i] === true

  const phaseTotal = phases.reduce((s, p) => s + Math.max(0, p.hours), 0)

  // Cap phases at the annual budget (hard ceiling): scale down if they overflow.
  const scale = phaseTotal > annualHours ? annualHours / phaseTotal : 1
  const effectivePhaseTotal = phaseTotal * scale

  // Which weeks are covered by at least one phase.
  const covered = new Set<number>()
  for (const p of phases) {
    for (const wk of p.weeks) {
      if (wk >= 0 && wk < weekCount) covered.add(wk)
    }
  }

  // Phase contribution per week (evenly within each phase, overlaps add up).
  for (const p of phases) {
    const validWeeks = p.weeks.filter((wk) => wk >= 0 && wk < weekCount)
    if (validWeeks.length === 0) continue
    const perWeek = (Math.max(0, p.hours) * scale) / validWeeks.length
    for (const wk of validWeeks) intensive[wk] += perWeek
  }

  // Base load over the remaining OPEN (non-phase, non-closed) weeks. Company
  // closures (Betriebsferien) get no base — their share flows to open weeks.
  const baseBudget = Math.max(0, annualHours - effectivePhaseTotal)
  const baseWeeks: number[] = []
  for (let i = 0; i < weekCount; i++) {
    if (!covered.has(i) && !isClosed(i)) baseWeeks.push(i)
  }
  const fallback = range(weekCount).filter((i) => !isClosed(i))
  const spreadOver = baseWeeks.length > 0 ? baseWeeks : fallback
  if (spreadOver.length > 0 && baseBudget > 0) {
    const perWeek = baseBudget / spreadOver.length
    for (const i of spreadOver) base[i] += perWeek
  }

  // Minimum weekly load (lower border): guarantee every OPEN week reaches
  // `minWeekly` of TOTAL load. Closed weeks are skipped (the fixed load is 0).
  if (minWeekly > 0) {
    for (let i = 0; i < weekCount; i++) {
      if (isClosed(i)) continue
      const deficit = minWeekly - (base[i] + intensive[i])
      if (deficit > 0) base[i] += deficit
    }
  }

  return { base, intensive }
}

/**
 * Distributes a project's annual budget across `weekCount` weeks: intensive
 * phases get their (capped) hours spread across their weeks, the remaining base
 * budget is spread over the non-phase weeks. The returned array sums to at most
 * the annual budget.
 */
export function distributeAnnualBudget(
  annualHours: number,
  weekCount: number,
  phases: IntensivePhaseInput[]
): number[] {
  const { base, intensive } = distributeAnnualBudgetSplit(
    annualHours,
    weekCount,
    phases
  )
  return base.map((b, i) => b + intensive[i])
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

export interface Utilization {
  ratio: number
  overloaded: boolean
}

/** Utilization = planned / capacity; > 100 % (or any load with no capacity) is overload. */
export function weeklyUtilization(
  plannedHours: number,
  capacityHours: number
): Utilization {
  if (capacityHours <= 0) {
    return {
      ratio: plannedHours > 0 ? Infinity : 0,
      overloaded: plannedHours > 0
    }
  }
  const ratio = plannedHours / capacityHours
  return { ratio, overloaded: ratio > 1 }
}
