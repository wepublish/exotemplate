import { describe, it, expect } from 'vitest'
import { weekMondayOf, enumerateWeeks } from './weeks'

describe('weekMondayOf', () => {
  it('returns the UTC Monday of the week for any day', () => {
    // 2026-07-02 is a Thursday → Monday is 2026-06-29
    expect(weekMondayOf('2026-07-02')).toBe('2026-06-29')
    // a Monday maps to itself
    expect(weekMondayOf('2026-06-29')).toBe('2026-06-29')
    // a Sunday maps back to that week's Monday
    expect(weekMondayOf('2026-07-05')).toBe('2026-06-29')
  })
})

describe('enumerateWeeks', () => {
  it('lists each week Monday from the from-week through the to-week', () => {
    const weeks = enumerateWeeks('2026-01-01', '2026-01-20')
    // 2026-01-01 is a Thursday → first Monday 2025-12-29; last covers 2026-01-20 (Tue → 2026-01-19)
    expect(weeks[0]).toBe('2025-12-29')
    expect(weeks[weeks.length - 1]).toBe('2026-01-19')
    // consecutive Mondays, 7 days apart, no gaps/dupes
    for (let i = 1; i < weeks.length; i++) {
      const diff =
        (Date.parse(weeks[i]!) - Date.parse(weeks[i - 1]!)) / 86_400_000
      expect(diff).toBe(7)
    }
  })

  it('returns a single week when from/to are in the same week', () => {
    expect(enumerateWeeks('2026-06-30', '2026-07-03')).toEqual(['2026-06-29'])
  })
})
