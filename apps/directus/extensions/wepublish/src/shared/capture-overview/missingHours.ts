import type { ClockodoUser } from '../clockodo/users'
import {
  type ClockodoAbsence,
  CLOCKODO_ABSENCE_STATUS_APPROVED
} from '../clockodo/absences'
import type { UserDailyHours } from '../clockodo/userDailyHours'
import type { ClockodoTargetHourRow } from '../clockodo/targetHours'
import type { ClockodoNonBusinessDay } from '../clockodo/nonBusinessDays'

export type DayStatus =
  | 'captured'
  | 'partial'
  | 'missing'
  | 'absent'
  | 'weekend'
  | 'off'
  | 'holiday'

export interface UserMissingHoursDay {
  date: string
  status: DayStatus
  expectedHours: number
  capturedHours: number
  absenceType?: number
  holidayName?: string
}

export interface UserMissingHoursRow {
  id: number
  name: string
  email: string
  weeklyTargetHours: number
  expectedDays: number
  capturedDays: number
  days: UserMissingHoursDay[]
}

export interface ComputeUserMissingHoursInput {
  users: ClockodoUser[]
  absences: ClockodoAbsence[]
  dailyHours: UserDailyHours[]
  targetHours: ClockodoTargetHourRow[]
  nonBusinessDays: ClockodoNonBusinessDay[]
  from: Date | string
  to: Date | string
  /**
   * Below this fraction of the expected daily hours a day is "partial"
   * instead of "captured". 0.5 by default — half-day captures still count
   * as a meaningful effort, anything less is a reminder candidate.
   */
  capturedThreshold?: number
}

const DEFAULT_THRESHOLD = 0.5
const MONTHLY_WORKDAYS_APPROX = 22

/**
 * Returns the rows the BI dashboard renders: one per active employee with at
 * least one Clockodo target-hours contract that intersects the requested
 * range, each carrying the day-by-day status across the range. Users without
 * a target-hours contract (freelancers, system accounts) are excluded — there
 * is no meaningful expectation to compare against.
 */
export function computeUserMissingHours(
  input: ComputeUserMissingHoursInput
): UserMissingHoursRow[] {
  const threshold = input.capturedThreshold ?? DEFAULT_THRESHOLD
  const dates = enumerateDates(input.from, input.to)
  const hoursByUser = indexHoursByUser(input.dailyHours)
  const absencesByUser = indexAbsencesByUser(input.absences)
  const targetHoursByUser = indexTargetHoursByUser(input.targetHours)
  const nonBusinessDaysByGroup = indexNonBusinessDaysByGroup(
    input.nonBusinessDays
  )

  const rows: UserMissingHoursRow[] = []

  for (const user of input.users) {
    if (!user.active) continue

    const userTargetHours = targetHoursByUser.get(user.id) ?? []
    if (!hasContractIntersecting(userTargetHours, dates)) continue

    const userHours = hoursByUser.get(user.id) ?? new Map<string, number>()
    const userAbsences = absencesByUser.get(user.id) ?? []
    const userHolidays =
      (user.nonbusinessgroups_id !== null &&
        nonBusinessDaysByGroup.get(user.nonbusinessgroups_id)) ||
      new Map<string, ClockodoNonBusinessDay>()

    const days: UserMissingHoursDay[] = dates.map((date) => {
      const capturedHours = userHours.get(date) ?? 0
      const absence = findCoveringAbsence(userAbsences, date)
      const targetRow = findActiveTargetHour(userTargetHours, date)
      const expectedHours = expectedHoursForDay(targetRow, date)
      const holiday = userHolidays.get(date) ?? null
      return dayStatus({
        date,
        expectedHours,
        capturedHours,
        absence,
        holiday,
        threshold
      })
    })

    const expectedDays = days.filter(
      (d) =>
        d.status === 'captured' ||
        d.status === 'partial' ||
        d.status === 'missing'
    ).length
    const capturedDays = days.filter((d) => d.status === 'captured').length
    const weeklyTargetHours = currentWeeklyTotal(userTargetHours, dates)

    rows.push({
      id: user.id,
      name: user.name,
      email: user.email,
      weeklyTargetHours,
      expectedDays,
      capturedDays,
      days
    })
  }

  rows.sort((a, b) => a.name.localeCompare(b.name, 'de'))
  return rows
}

/**
 * Pure status decision for a single (user, day) cell. Exported for tests and
 * so the operation can reuse the exact same rule for the daily Slack ping.
 *
 * Status precedence (from highest to lowest):
 *   1. weekend  — Sat/Sun, regardless of anything else
 *   2. holiday  — full-day public holiday for the user's nonbusinessgroup
 *      (half-day holidays don't short-circuit; they halve expected hours
 *      and continue through the captured/partial/missing branches below)
 *   3. absent   — covered by an approved Clockodo absence
 *   4. off      — workday but the contract sets 0 expected hours
 *      (e.g. a Wednesday-off part-timer). Not a "miss".
 *   5. missing  — workday with expected > 0 and nothing captured
 *   6. partial  — captured below threshold of expected
 *   7. captured — captured at or above threshold of expected
 */
export function dayStatus(args: {
  date: string
  expectedHours: number
  capturedHours: number
  absence: ClockodoAbsence | null
  holiday: ClockodoNonBusinessDay | null
  threshold: number
}): UserMissingHoursDay {
  const { date, expectedHours, capturedHours, absence, holiday, threshold } =
    args

  if (!isWorkday(date)) {
    return {
      date,
      status: 'weekend',
      expectedHours: 0,
      capturedHours
    }
  }

  if (holiday && holiday.half_day !== 1) {
    return {
      date,
      status: 'holiday',
      expectedHours: 0,
      capturedHours,
      holidayName: holiday.name
    }
  }

  if (absence) {
    return {
      date,
      status: 'absent',
      expectedHours: 0,
      capturedHours,
      absenceType: absence.type
    }
  }

  // Half-day holiday: still a workday but with half the expectation.
  const effectiveExpected =
    holiday && holiday.half_day === 1 ? expectedHours / 2 : expectedHours

  if (effectiveExpected <= 0) {
    return { date, status: 'off', expectedHours: 0, capturedHours }
  }

  if (capturedHours <= 0) {
    return {
      date,
      status: 'missing',
      expectedHours: effectiveExpected,
      capturedHours,
      ...(holiday ? { holidayName: holiday.name } : {})
    }
  }

  if (capturedHours >= effectiveExpected * threshold) {
    return {
      date,
      status: 'captured',
      expectedHours: effectiveExpected,
      capturedHours,
      ...(holiday ? { holidayName: holiday.name } : {})
    }
  }

  return {
    date,
    status: 'partial',
    expectedHours: effectiveExpected,
    capturedHours,
    ...(holiday ? { holidayName: holiday.name } : {})
  }
}

/**
 * Returns the active target-hours row for a given user and date — i.e. the
 * row whose `[date_since, date_until]` window covers that date. If multiple
 * rows match (shouldn't happen with sane data but Clockodo doesn't enforce
 * it), the one with the latest `date_since` wins so the newer contract takes
 * precedence over an older one that was never closed.
 */
export function findActiveTargetHour(
  rows: ClockodoTargetHourRow[],
  date: string
): ClockodoTargetHourRow | null {
  let winner: ClockodoTargetHourRow | null = null
  for (const row of rows) {
    if (!coversDate(row, date)) continue
    if (!winner || row.date_since > winner.date_since) winner = row
  }
  return winner
}

/**
 * Per-day expected hours given a target-hours row.
 *
 * Weekly contracts: read the column matching the weekday of `date` (e.g.
 * `row.monday`). Zero is a valid value — it means "you're off that day".
 *
 * Monthly contracts: a Clockodo monthly row carries `monthly_target` plus a
 * boolean per weekday for which days count as working days; we use those
 * flags to spread the monthly target evenly across the (1-7) working days a
 * week has. Where the flags are missing, fall back to dividing by ~22 working
 * days in a month so callers still get a sane number.
 */
export function expectedHoursForDay(
  row: ClockodoTargetHourRow | null,
  date: string
): number {
  if (!row) return 0
  if (row.type === 'weekly') return weekdayHoursOf(row, date) ?? 0

  // monthly
  const monthlyTarget = row.monthly_target ?? 0
  if (monthlyTarget <= 0) return 0
  if (!isMonthlyWorkday(row, date)) return 0
  const workdaysPerWeek = countMonthlyWorkdays(row)
  if (workdaysPerWeek > 0) {
    return monthlyTarget / (workdaysPerWeek * 4.33) // 4.33 weeks/month avg
  }
  return monthlyTarget / MONTHLY_WORKDAYS_APPROX
}

function weekdayHoursOf(
  row: ClockodoTargetHourRow,
  date: string
): number | null {
  const dow = parseIsoDate(date).getUTCDay()
  switch (dow) {
    case 0:
      return row.sunday ?? 0
    case 1:
      return row.monday ?? 0
    case 2:
      return row.tuesday ?? 0
    case 3:
      return row.wednesday ?? 0
    case 4:
      return row.thursday ?? 0
    case 5:
      return row.friday ?? 0
    case 6:
      return row.saturday ?? 0
  }
  return null
}

function isMonthlyWorkday(row: ClockodoTargetHourRow, date: string): boolean {
  const dow = parseIsoDate(date).getUTCDay()
  switch (dow) {
    case 0:
      return row.sunday_is_workday ?? false
    case 1:
      return row.monday_is_workday ?? true
    case 2:
      return row.tuesday_is_workday ?? true
    case 3:
      return row.wednesday_is_workday ?? true
    case 4:
      return row.thursday_is_workday ?? true
    case 5:
      return row.friday_is_workday ?? true
    case 6:
      return row.saturday_is_workday ?? false
  }
  return false
}

function countMonthlyWorkdays(row: ClockodoTargetHourRow): number {
  let count = 0
  if (row.monday_is_workday) count++
  if (row.tuesday_is_workday) count++
  if (row.wednesday_is_workday) count++
  if (row.thursday_is_workday) count++
  if (row.friday_is_workday) count++
  if (row.saturday_is_workday) count++
  if (row.sunday_is_workday) count++
  return count
}

function coversDate(row: ClockodoTargetHourRow, date: string): boolean {
  const since = row.date_since.slice(0, 10)
  const until = row.date_until?.slice(0, 10) ?? '9999-12-31'
  return since <= date && date <= until
}

/**
 * Computes the user's weekly target hours summary for display: the sum of
 * all 7 weekday columns of the contract that's active at the *end* of the
 * range. Falls back to the latest contract if none is active. Returns 0 when
 * the user has no contracts at all.
 */
function currentWeeklyTotal(
  rows: ClockodoTargetHourRow[],
  dates: string[]
): number {
  if (rows.length === 0 || dates.length === 0) return 0
  const reference = dates[dates.length - 1]!
  const row = findActiveTargetHour(rows, reference) ?? mostRecent(rows)
  if (!row) return 0
  if (row.type === 'weekly') {
    return (
      (row.monday ?? 0) +
      (row.tuesday ?? 0) +
      (row.wednesday ?? 0) +
      (row.thursday ?? 0) +
      (row.friday ?? 0) +
      (row.saturday ?? 0) +
      (row.sunday ?? 0)
    )
  }
  // monthly: convert to weekly via the same 4.33 weeks/month conversion
  return (row.monthly_target ?? 0) / 4.33
}

function mostRecent(
  rows: ClockodoTargetHourRow[]
): ClockodoTargetHourRow | null {
  if (rows.length === 0) return null
  return rows.reduce((best, current) =>
    current.date_since > best.date_since ? current : best
  )
}

function hasContractIntersecting(
  rows: ClockodoTargetHourRow[],
  dates: string[]
): boolean {
  if (rows.length === 0 || dates.length === 0) return false
  const first = dates[0]!
  const last = dates[dates.length - 1]!
  return rows.some((row) => {
    const since = row.date_since.slice(0, 10)
    const until = row.date_until?.slice(0, 10) ?? '9999-12-31'
    return since <= last && until >= first
  })
}

/**
 * Mon–Fri only. Public holidays aren't modelled in v1 — we'll layer them on
 * once a Holidays collection (or library) is in place. Accepts both ISO date
 * strings and `Date` instances.
 */
export function isWorkday(date: string | Date): boolean {
  const d = typeof date === 'string' ? parseIsoDate(date) : date
  const dow = d.getUTCDay()
  return dow >= 1 && dow <= 5
}

/**
 * Inclusive [from, to] enumeration in YYYY-MM-DD form, computed in UTC so
 * results don't drift with the host timezone. The endpoint passes UTC-midnight
 * dates and Clockodo returns YYYY-MM-DD strings, so UTC keeps both sides
 * aligned.
 */
export function enumerateDates(
  from: Date | string,
  to: Date | string
): string[] {
  const start = parseDateInput(from)
  const end = parseDateInput(to)
  const result: string[] = []
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  )
  const endUtc = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate()
  )
  while (cursor.getTime() <= endUtc) {
    result.push(toIsoDate(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return result
}

function parseDateInput(input: Date | string): Date {
  if (input instanceof Date) return input
  return parseIsoDate(input)
}

function parseIsoDate(value: string): Date {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) {
    return new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    )
  }
  return new Date(value)
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function indexHoursByUser(
  rows: UserDailyHours[]
): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>()
  for (const row of rows) {
    let userMap = out.get(row.usersId)
    if (!userMap) {
      userMap = new Map<string, number>()
      out.set(row.usersId, userMap)
    }
    const isoDay = row.day.slice(0, 10)
    userMap.set(isoDay, (userMap.get(isoDay) ?? 0) + row.hours)
  }
  return out
}

function indexAbsencesByUser(
  rows: ClockodoAbsence[]
): Map<number, ClockodoAbsence[]> {
  const out = new Map<number, ClockodoAbsence[]>()
  for (const row of rows) {
    if (row.status !== CLOCKODO_ABSENCE_STATUS_APPROVED) continue
    const arr = out.get(row.users_id) ?? []
    arr.push(row)
    out.set(row.users_id, arr)
  }
  return out
}

function indexTargetHoursByUser(
  rows: ClockodoTargetHourRow[]
): Map<number, ClockodoTargetHourRow[]> {
  const out = new Map<number, ClockodoTargetHourRow[]>()
  for (const row of rows) {
    const arr = out.get(row.users_id) ?? []
    arr.push(row)
    out.set(row.users_id, arr)
  }
  return out
}

/**
 * Indexes holidays as `nonbusinessgroups_id → (date → row)` so the per-user
 * loop only needs one `O(1)` lookup per (user, day) pair to find out whether
 * that date is a holiday for that user's calendar.
 */
function indexNonBusinessDaysByGroup(
  rows: ClockodoNonBusinessDay[]
): Map<number, Map<string, ClockodoNonBusinessDay>> {
  const out = new Map<number, Map<string, ClockodoNonBusinessDay>>()
  for (const row of rows) {
    let groupMap = out.get(row.nonbusinessgroups_id)
    if (!groupMap) {
      groupMap = new Map<string, ClockodoNonBusinessDay>()
      out.set(row.nonbusinessgroups_id, groupMap)
    }
    groupMap.set(row.date.slice(0, 10), row)
  }
  return out
}

function findCoveringAbsence(
  rows: ClockodoAbsence[],
  date: string
): ClockodoAbsence | null {
  for (const row of rows) {
    const since = row.date_since.slice(0, 10)
    const until = row.date_until.slice(0, 10)
    if (since <= date && date <= until) return row
  }
  return null
}

/**
 * Returns the set of years a `[from, to]` range spans so the caller knows
 * which Clockodo absence years to fetch. Always at least one year.
 */
export function yearsCoveringRange(
  from: Date | string,
  to: Date | string
): number[] {
  const start = parseDateInput(from)
  const end = parseDateInput(to)
  const startYear = start.getUTCFullYear()
  const endYear = end.getUTCFullYear()
  const years: number[] = []
  for (let y = startYear; y <= endYear; y += 1) years.push(y)
  return years
}
