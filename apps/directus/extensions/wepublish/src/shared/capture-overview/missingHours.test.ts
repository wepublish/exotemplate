import { describe, expect, it } from 'vitest'
import {
  CLOCKODO_ABSENCE_STATUS_APPROVED,
  type ClockodoAbsence
} from '../clockodo/absences'
import type { ClockodoUser } from '../clockodo/users'
import type { UserDailyHours } from '../clockodo/userDailyHours'
import type { ClockodoTargetHourRow } from '../clockodo/targetHours'
import type { ClockodoNonBusinessDay } from '../clockodo/nonBusinessDays'
import {
  computeUserMissingHours,
  dayStatus,
  enumerateDates,
  expectedHoursForDay,
  findActiveTargetHour,
  isWorkday,
  yearsCoveringRange
} from './missingHours'

function user(
  overrides: Partial<ClockodoUser> & Pick<ClockodoUser, 'id' | 'name' | 'email'>
): ClockodoUser {
  return {
    weekly_target_hours: null,
    active: true,
    nonbusinessgroups_id: 1,
    ...overrides
  }
}

function holiday(
  overrides: Partial<ClockodoNonBusinessDay> &
    Pick<ClockodoNonBusinessDay, 'date' | 'nonbusinessgroups_id'>
): ClockodoNonBusinessDay {
  return {
    id: 9000,
    name: 'Pfingstmontag',
    half_day: 0,
    ...overrides
  }
}

function approvedAbsence(
  overrides: Partial<ClockodoAbsence> & Pick<ClockodoAbsence, 'users_id'>
): ClockodoAbsence {
  return {
    id: 1,
    date_since: '2026-05-25',
    date_until: '2026-05-29',
    type: 1,
    status: CLOCKODO_ABSENCE_STATUS_APPROVED,
    ...overrides
  }
}

function fullTimeWeekly(
  usersId: number,
  overrides: Partial<ClockodoTargetHourRow> = {}
): ClockodoTargetHourRow {
  return {
    id: 1000 + usersId,
    users_id: usersId,
    type: 'weekly',
    date_since: '2020-01-01',
    date_until: null,
    monday: 8,
    tuesday: 8,
    wednesday: 8,
    thursday: 8,
    friday: 8,
    saturday: 0,
    sunday: 0,
    ...overrides
  }
}

function partTimeWeekly(
  usersId: number,
  overrides: Partial<ClockodoTargetHourRow> = {}
): ClockodoTargetHourRow {
  // 24h/week: M=8, T=8, W=0, Th=8, F=0 — Wednesday and Friday off
  return {
    id: 2000 + usersId,
    users_id: usersId,
    type: 'weekly',
    date_since: '2020-01-01',
    date_until: null,
    monday: 8,
    tuesday: 8,
    wednesday: 0,
    thursday: 8,
    friday: 0,
    saturday: 0,
    sunday: 0,
    ...overrides
  }
}

describe('isWorkday', () => {
  it('returns false for Sat/Sun', () => {
    expect(isWorkday('2026-05-23')).toBe(false)
    expect(isWorkday('2026-05-24')).toBe(false)
  })

  it('returns true Mon-Fri', () => {
    expect(isWorkday('2026-05-25')).toBe(true)
    expect(isWorkday('2026-05-29')).toBe(true)
  })
})

describe('enumerateDates', () => {
  it('yields inclusive day strings', () => {
    expect(enumerateDates('2026-05-25', '2026-05-27')).toEqual([
      '2026-05-25',
      '2026-05-26',
      '2026-05-27'
    ])
  })

  it('handles single-day ranges', () => {
    expect(enumerateDates('2026-05-25', '2026-05-25')).toEqual(['2026-05-25'])
  })
})

describe('yearsCoveringRange', () => {
  it('returns single year', () => {
    expect(yearsCoveringRange('2026-05-01', '2026-05-31')).toEqual([2026])
  })

  it('spans year boundary', () => {
    expect(yearsCoveringRange('2025-12-29', '2026-01-04')).toEqual([2025, 2026])
  })
})

describe('findActiveTargetHour', () => {
  it('returns the row whose window covers the date', () => {
    const rows: ClockodoTargetHourRow[] = [
      fullTimeWeekly(1, {
        id: 1,
        date_since: '2020-01-01',
        date_until: '2025-12-31'
      }),
      fullTimeWeekly(1, {
        id: 2,
        date_since: '2026-01-01',
        date_until: null,
        monday: 6
      })
    ]
    const row = findActiveTargetHour(rows, '2026-05-25')
    expect(row?.id).toBe(2)
    expect(row?.monday).toBe(6)
  })

  it('returns null when no row covers the date', () => {
    const rows: ClockodoTargetHourRow[] = [
      fullTimeWeekly(1, { date_since: '2030-01-01', date_until: null })
    ]
    expect(findActiveTargetHour(rows, '2026-05-25')).toBeNull()
  })
})

describe('expectedHoursForDay', () => {
  it('reads the matching weekday column for weekly contracts', () => {
    const row = partTimeWeekly(1) // M=8 T=8 W=0 Th=8 F=0
    expect(expectedHoursForDay(row, '2026-05-25')).toBe(8) // Mon
    expect(expectedHoursForDay(row, '2026-05-27')).toBe(0) // Wed
    expect(expectedHoursForDay(row, '2026-05-29')).toBe(0) // Fri
  })

  it('returns 0 when row is null', () => {
    expect(expectedHoursForDay(null, '2026-05-25')).toBe(0)
  })

  it('handles monthly contracts via flags + 4.33 weeks/month spread', () => {
    const row: ClockodoTargetHourRow = {
      id: 99,
      users_id: 1,
      type: 'monthly',
      date_since: '2020-01-01',
      date_until: null,
      monthly_target: 173.2, // 40h/wk * 4.33
      monday_is_workday: true,
      tuesday_is_workday: true,
      wednesday_is_workday: true,
      thursday_is_workday: true,
      friday_is_workday: true,
      saturday_is_workday: false,
      sunday_is_workday: false
    }
    expect(expectedHoursForDay(row, '2026-05-25')).toBeCloseTo(8, 1) // Mon
    expect(expectedHoursForDay(row, '2026-05-30')).toBe(0) // Sat — not a workday
  })
})

describe('dayStatus', () => {
  it('returns weekend on Saturday regardless of expected', () => {
    const result = dayStatus({
      date: '2026-05-23',
      expectedHours: 8,
      capturedHours: 0,
      absence: null,
      holiday: null,
      threshold: 0.5
    })
    expect(result.status).toBe('weekend')
  })

  it('returns absent when a covering approved absence exists', () => {
    const result = dayStatus({
      date: '2026-05-25',
      expectedHours: 8,
      capturedHours: 0,
      absence: approvedAbsence({ users_id: 1 }),
      holiday: null,
      threshold: 0.5
    })
    expect(result.status).toBe('absent')
    expect(result.absenceType).toBe(1)
  })

  it('returns off when workday has zero expected (e.g. day off in contract)', () => {
    const result = dayStatus({
      date: '2026-05-27', // Wed
      expectedHours: 0,
      capturedHours: 0,
      absence: null,
      holiday: null,
      threshold: 0.5
    })
    expect(result.status).toBe('off')
  })

  it('returns missing on a workday with zero hours but positive expected', () => {
    const result = dayStatus({
      date: '2026-05-25',
      expectedHours: 8,
      capturedHours: 0,
      absence: null,
      holiday: null,
      threshold: 0.5
    })
    expect(result.status).toBe('missing')
  })

  it('returns partial below threshold', () => {
    const result = dayStatus({
      date: '2026-05-25',
      expectedHours: 8,
      capturedHours: 1,
      absence: null,
      holiday: null,
      threshold: 0.5
    })
    expect(result.status).toBe('partial')
  })

  it('returns captured at or above threshold', () => {
    const result = dayStatus({
      date: '2026-05-25',
      expectedHours: 8,
      capturedHours: 4,
      absence: null,
      holiday: null,
      threshold: 0.5
    })
    expect(result.status).toBe('captured')
  })
})

describe('computeUserMissingHours', () => {
  const ann = user({ id: 10, name: 'Ann Example', email: 'ann@x' })
  const part = user({ id: 11, name: 'Pat Part-Time', email: 'pat@x' })
  const freelancer = user({ id: 12, name: 'Frank Freelance', email: 'frank@x' })
  const inactive = user({
    id: 13,
    name: 'Ina Inactive',
    email: 'ina@x',
    active: false
  })

  const baseInput = {
    users: [ann, part, freelancer, inactive],
    targetHours: [
      fullTimeWeekly(10),
      partTimeWeekly(11)
      // freelancer (id 12) has no contract → excluded
      // inactive (id 13) has no contract, would be excluded by active=false anyway
    ],
    absences: [
      approvedAbsence({
        users_id: 10,
        date_since: '2026-05-27',
        date_until: '2026-05-27'
      })
    ],
    nonBusinessDays: [] as ClockodoNonBusinessDay[],
    dailyHours: [
      // Ann (full-time): captured Mon/Tue/Fri, missing Thu, absent Wed
      { usersId: 10, day: '2026-05-25', hours: 8 },
      { usersId: 10, day: '2026-05-26', hours: 8 },
      { usersId: 10, day: '2026-05-29', hours: 8 },
      // Pat (M=8 T=8 W=0 Th=8 F=0): 8h Mon, 1h Tue, nothing Thu
      { usersId: 11, day: '2026-05-25', hours: 8 },
      { usersId: 11, day: '2026-05-26', hours: 1 }
    ] as UserDailyHours[],
    from: '2026-05-25',
    to: '2026-05-31'
  }

  it('excludes users with no contract intersecting the range', () => {
    const rows = computeUserMissingHours(baseInput)
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(10)
    expect(ids).toContain(11)
    expect(ids).not.toContain(12) // freelancer — no contract
    expect(ids).not.toContain(13) // inactive
  })

  it('marks Wed as absent for Ann; remaining workdays counted', () => {
    const rows = computeUserMissingHours(baseInput)
    const annRow = rows.find((r) => r.id === 10)!
    const wed = annRow.days.find((d) => d.date === '2026-05-27')!
    const thu = annRow.days.find((d) => d.date === '2026-05-28')!
    expect(wed.status).toBe('absent')
    expect(thu.status).toBe('missing')
    // Expected workdays for Ann: Mon, Tue, Thu, Fri (Wed absent; Sat/Sun weekend)
    expect(annRow.expectedDays).toBe(4)
    // Captured: Mon, Tue, Fri → 3
    expect(annRow.capturedDays).toBe(3)
  })

  it('treats Wed/Fri as "off" for Pat (contract sets 0 hours those days)', () => {
    const rows = computeUserMissingHours(baseInput)
    const patRow = rows.find((r) => r.id === 11)!
    const wed = patRow.days.find((d) => d.date === '2026-05-27')!
    const fri = patRow.days.find((d) => d.date === '2026-05-29')!
    expect(wed.status).toBe('off')
    expect(fri.status).toBe('off')
    // Expected workdays for Pat: Mon, Tue, Thu (Wed/Fri off, Sat/Sun weekend)
    expect(patRow.expectedDays).toBe(3)
  })

  it('Pat captures Mon (>=4h threshold of 8) but is partial Tue (1h < 4h)', () => {
    const rows = computeUserMissingHours(baseInput)
    const patRow = rows.find((r) => r.id === 11)!
    const mon = patRow.days.find((d) => d.date === '2026-05-25')!
    const tue = patRow.days.find((d) => d.date === '2026-05-26')!
    expect(mon.status).toBe('captured')
    expect(tue.status).toBe('partial')
  })

  it('reports the weekly total in weeklyTargetHours', () => {
    const rows = computeUserMissingHours(baseInput)
    const annRow = rows.find((r) => r.id === 10)!
    const patRow = rows.find((r) => r.id === 11)!
    expect(annRow.weeklyTargetHours).toBe(40)
    expect(patRow.weeklyTargetHours).toBe(24)
  })

  it('rolls weekend days up as weekend regardless of contract', () => {
    const rows = computeUserMissingHours(baseInput)
    const annRow = rows.find((r) => r.id === 10)!
    const sat = annRow.days.find((d) => d.date === '2026-05-30')!
    const sun = annRow.days.find((d) => d.date === '2026-05-31')!
    expect(sat.status).toBe('weekend')
    expect(sun.status).toBe('weekend')
  })

  it('sorts rows by name', () => {
    const rows = computeUserMissingHours(baseInput)
    const names = rows.map((r) => r.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'de')))
  })

  it('treats unapproved absences as not covering', () => {
    const input = {
      ...baseInput,
      absences: [
        approvedAbsence({
          users_id: 10,
          date_since: '2026-05-27',
          date_until: '2026-05-27',
          status: 0
        })
      ]
    }
    const rows = computeUserMissingHours(input)
    const annRow = rows.find((r) => r.id === 10)!
    const wed = annRow.days.find((d) => d.date === '2026-05-27')!
    expect(wed.status).toBe('missing')
  })

  it('respects contract start dates — date before contract is excluded from intersection check', () => {
    const newHireInput = {
      ...baseInput,
      users: [user({ id: 20, name: 'New Hire', email: 'new@x' })],
      targetHours: [
        fullTimeWeekly(20, { date_since: '2030-01-01', date_until: null })
      ],
      dailyHours: [] as UserDailyHours[]
    }
    const rows = computeUserMissingHours(newHireInput)
    expect(rows).toEqual([])
  })

  it('marks full-day public holidays as "holiday" and excludes them from expected count', () => {
    const inputWithHoliday = {
      ...baseInput,
      nonBusinessDays: [
        holiday({
          date: '2026-05-25',
          nonbusinessgroups_id: 1,
          name: 'Pfingstmontag'
        })
      ]
    }
    const rows = computeUserMissingHours(inputWithHoliday)
    const annRow = rows.find((r) => r.id === 10)!
    const mon = annRow.days.find((d) => d.date === '2026-05-25')!
    expect(mon.status).toBe('holiday')
    expect(mon.holidayName).toBe('Pfingstmontag')
    // Mon now holiday → Tue/Thu/Fri are the only expected workdays (Wed absent)
    expect(annRow.expectedDays).toBe(3)
  })

  it('ignores holidays from a different nonbusinessgroup than the user belongs to', () => {
    const inputWithOtherGroupHoliday = {
      ...baseInput,
      nonBusinessDays: [
        holiday({
          date: '2026-05-25',
          nonbusinessgroups_id: 999, // Ann is in group 1, not 999
          name: 'Karneval in Köln'
        })
      ]
    }
    const rows = computeUserMissingHours(inputWithOtherGroupHoliday)
    const annRow = rows.find((r) => r.id === 10)!
    const mon = annRow.days.find((d) => d.date === '2026-05-25')!
    // Mon was captured 8h; group mismatch → holiday ignored → captured
    expect(mon.status).toBe('captured')
  })

  it('half-day holiday halves the expected hours, not the whole day', () => {
    // Same input as base but Mon is now a half-day holiday. Ann captured 8h
    // Mon → still captured (8 >= 4 * 0.5 = 2). For a more interesting case,
    // override Ann's Monday hours to 1h and assert "partial" against the
    // halved expected.
    const inputWithHalfHoliday = {
      ...baseInput,
      dailyHours: [
        { usersId: 10, day: '2026-05-25', hours: 1 }, // 1h on a half-holiday day
        { usersId: 10, day: '2026-05-26', hours: 8 },
        { usersId: 10, day: '2026-05-29', hours: 8 }
      ] as UserDailyHours[],
      nonBusinessDays: [
        holiday({
          date: '2026-05-25',
          nonbusinessgroups_id: 1,
          name: 'Halbtag',
          half_day: 1
        })
      ]
    }
    const rows = computeUserMissingHours(inputWithHalfHoliday)
    const annRow = rows.find((r) => r.id === 10)!
    const mon = annRow.days.find((d) => d.date === '2026-05-25')!
    // Expected was 8, halved → 4. 1h captured, threshold 0.5 * 4 = 2.
    // 1 > 0 but 1 < 2 → partial.
    expect(mon.status).toBe('partial')
    expect(mon.expectedHours).toBe(4)
    expect(mon.holidayName).toBe('Halbtag')
  })
})
