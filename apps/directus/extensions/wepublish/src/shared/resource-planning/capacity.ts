import { weekMondayOf } from './weeks'

/**
 * Pure weekly aggregation for capacity + phase mapping. Fed normalized daily
 * available-hours (from `computeUserMissingHours`'s per-day `expectedHours`,
 * which is already 0 on weekends/absences/holidays).
 */

export interface DayHours {
  date: string
  expectedHours: number
}

/** Sum available hours into weeks, keyed by the week's Monday. */
export function sumHoursByWeek(days: DayHours[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of days) {
    const wk = weekMondayOf(d.date)
    out[wk] = (out[wk] ?? 0) + (d.expectedHours || 0)
  }
  return out
}

/**
 * Per-week project capacity for one employee, aligned to `weeks`: available
 * hours minus the weekly "other work" budget (floored at 0), then scaled by the
 * project-hours percentage — the share of the remaining hours the employee
 * spends on client-project work. `projectPct` defaults to 100 (full capacity)
 * and is clamped to 0..100.
 */
export function employeeWeeklyCapacity(
  days: DayHours[],
  otherWorkPerWeek: number,
  weeks: string[],
  projectPct = 100
): number[] {
  const byWeek = sumHoursByWeek(days)
  const other = Math.max(0, otherWorkPerWeek || 0)
  const factor = Math.min(100, Math.max(0, projectPct)) / 100
  return weeks.map((wk) => Math.max(0, (byWeek[wk] ?? 0) - other) * factor)
}

/** Indices into `weeks` whose Monday falls within the phase's [from,to] weeks. */
export function phaseWeekIndices(
  fromISO: string,
  toISO: string,
  weeks: string[]
): number[] {
  const start = weekMondayOf(fromISO)
  const end = weekMondayOf(toISO)
  const out: number[] = []
  weeks.forEach((wk, i) => {
    if (wk >= start && wk <= end) out.push(i)
  })
  return out
}
