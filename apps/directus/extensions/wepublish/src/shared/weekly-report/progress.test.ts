import { describe, expect, it } from 'vitest'
import { computeWeeklyReportProgress, isOverBudget } from './progress'

const PERIOD_FROM = new Date('2026-01-01T00:00:00.000Z')
const PERIOD_TO = new Date('2026-07-01T00:00:00.000Z')

describe('computeWeeklyReportProgress', () => {
  it('flags over_budget when budget usage is above 100 %', () => {
    const result = computeWeeklyReportProgress({
      sums: { totalUsedHours: 110, totalTopUps: 100 },
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      now: new Date('2026-04-01T00:00:00.000Z')
    })
    expect(result.status).toBe('over_budget')
    expect(isOverBudget(result.status)).toBe(true)
  })

  it('flags close_to_limit between 90 % and 100 %', () => {
    const result = computeWeeklyReportProgress({
      sums: { totalUsedHours: 92, totalTopUps: 100 },
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      now: new Date('2026-04-01T00:00:00.000Z')
    })
    expect(result.status).toBe('close_to_limit')
  })

  it('flags behind_schedule when budget burns much faster than time', () => {
    const result = computeWeeklyReportProgress({
      sums: { totalUsedHours: 50, totalTopUps: 100 }, // 50 % budget
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      now: new Date('2026-02-01T00:00:00.000Z') // ~17 % time
    })
    expect(result.status).toBe('behind_schedule')
    expect(result.deltaPercent).toBeGreaterThan(10)
  })

  it('flags ahead_of_schedule when much budget remains', () => {
    const result = computeWeeklyReportProgress({
      sums: { totalUsedHours: 10, totalTopUps: 100 }, // 10 % budget
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      now: new Date('2026-05-01T00:00:00.000Z') // ~66 % time
    })
    expect(result.status).toBe('ahead_of_schedule')
    expect(result.deltaPercent).toBeLessThan(-10)
  })

  it('returns on_track when budget and time are within tolerance', () => {
    const result = computeWeeklyReportProgress({
      sums: { totalUsedHours: 45, totalTopUps: 100 }, // 45 % budget
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      now: new Date('2026-04-01T00:00:00.000Z') // ~50 % time
    })
    expect(result.status).toBe('on_track')
  })

  it('clamps elapsed time to the period', () => {
    const result = computeWeeklyReportProgress({
      sums: { totalUsedHours: 0, totalTopUps: 100 },
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      now: new Date('2026-12-01T00:00:00.000Z') // far past `to`
    })
    expect(result.timeElapsedPercent).toBe(100)
    expect(result.daysRemaining).toBe(0)
  })

  it('treats a zero-hour budget with zero usage as 0 % (on track)', () => {
    const result = computeWeeklyReportProgress({
      sums: { totalUsedHours: 0, totalTopUps: 0 },
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      now: new Date('2026-04-01T00:00:00.000Z')
    })
    expect(result.budgetUsedPercent).toBe(0)
    expect(Number.isFinite(result.budgetUsedPercent)).toBe(true)
    expect(result.status).not.toBe('no_budget')
  })

  it('flags no_budget when hours are used without any top-ups', () => {
    // Bug regression: previously this case computed budgetUsedPercent=0 and
    // fell through to `ahead_of_schedule` ("Reichlich Spielraum"), masking
    // the fact that the client has logged billable hours without budget.
    const result = computeWeeklyReportProgress({
      sums: { totalUsedHours: 2.5, totalTopUps: 0 },
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      now: new Date('2026-05-15T00:00:00.000Z')
    })
    expect(result.status).toBe('no_budget')
    expect(result.budgetUsedPercent).toBe(0)
    expect(isOverBudget(result.status)).toBe(false)
  })
})
