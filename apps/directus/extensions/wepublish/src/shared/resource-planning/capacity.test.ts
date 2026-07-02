import { describe, it, expect } from 'vitest'
import {
  sumHoursByWeek,
  employeeWeeklyCapacity,
  phaseWeekIndices
} from './capacity'

describe('sumHoursByWeek', () => {
  it('sums available hours into their week (keyed by Monday)', () => {
    const byWeek = sumHoursByWeek([
      { date: '2026-06-29', expectedHours: 8 }, // Mon
      { date: '2026-07-01', expectedHours: 8 }, // Wed (same week)
      { date: '2026-07-06', expectedHours: 4 } // next Mon
    ])
    expect(byWeek['2026-06-29']).toBe(16)
    expect(byWeek['2026-07-06']).toBe(4)
  })
})

describe('employeeWeeklyCapacity', () => {
  const days = [
    { date: '2026-06-29', expectedHours: 8 },
    { date: '2026-06-30', expectedHours: 8 },
    { date: '2026-07-01', expectedHours: 8 },
    { date: '2026-07-02', expectedHours: 8 },
    { date: '2026-07-03', expectedHours: 8 } // 40h that week
  ]

  it('subtracts the weekly other-work budget, floored at 0, aligned to weeks', () => {
    const weeks = ['2026-06-29', '2026-07-06']
    expect(employeeWeeklyCapacity(days, 5, weeks)).toEqual([35, 0])
  })

  it('never goes negative when other-work exceeds availability', () => {
    expect(employeeWeeklyCapacity(days, 100, ['2026-06-29'])).toEqual([0])
  })

  it('applies the project-hours percentage after subtracting other-work', () => {
    // 40h available, no other-work, 60% on projects → 24h
    expect(employeeWeeklyCapacity(days, 0, ['2026-06-29'], 60)).toEqual([24])
    // 40h − 10h other-work = 30h, then 50% → 15h
    expect(employeeWeeklyCapacity(days, 10, ['2026-06-29'], 50)).toEqual([15])
  })

  it('defaults to 100% (full capacity) when no percentage is given', () => {
    expect(employeeWeeklyCapacity(days, 0, ['2026-06-29'])).toEqual([40])
  })

  it('clamps the percentage to 0..100', () => {
    expect(employeeWeeklyCapacity(days, 0, ['2026-06-29'], 0)).toEqual([0])
    expect(employeeWeeklyCapacity(days, 0, ['2026-06-29'], 150)).toEqual([40])
    expect(employeeWeeklyCapacity(days, 0, ['2026-06-29'], -20)).toEqual([0])
  })
})

describe('phaseWeekIndices', () => {
  const weeks = ['2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20']
  it('maps a phase date range to the covered week indices', () => {
    // phase spanning 2026-07-07 .. 2026-07-15 → weeks starting 07-06 and 07-13
    expect(phaseWeekIndices('2026-07-07', '2026-07-15', weeks)).toEqual([1, 2])
  })
  it('is empty when the phase falls outside the planning weeks', () => {
    expect(phaseWeekIndices('2025-01-01', '2025-01-10', weeks)).toEqual([])
  })
})
