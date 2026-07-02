import { describe, it, expect } from 'vitest'
import {
  distributeAnnualBudget,
  distributeAnnualBudgetSplit,
  weeklyUtilization,
  type IntensivePhaseInput
} from './planning'

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)

describe('distributeAnnualBudget', () => {
  it('spreads the annual budget evenly with no phases', () => {
    const w = distributeAnnualBudget(52, 52, [])
    expect(w).toHaveLength(52)
    expect(w.every((h) => Math.abs(h - 1) < 1e-9)).toBe(true)
    expect(sum(w)).toBeCloseTo(52)
  })

  it('redistributes base load over non-phase weeks, keeping the annual total', () => {
    // 20h phase across weeks 0..1; base = (52-20)=32 over the other 50 weeks
    const phases: IntensivePhaseInput[] = [{ weeks: [0, 1], hours: 20 }]
    const w = distributeAnnualBudget(52, 52, phases)
    expect(w[0]).toBeCloseTo(10) // 20 / 2 weeks
    expect(w[1]).toBeCloseTo(10)
    expect(w[2]).toBeCloseTo(32 / 50)
    expect(sum(w)).toBeCloseTo(52) // annual total preserved
  })

  it('never exceeds the annual budget — caps phases that overflow it', () => {
    // phase asks 20h but annual is only 10 → scaled to fit, base 0
    const w = distributeAnnualBudget(10, 52, [{ weeks: [0, 1], hours: 20 }])
    expect(sum(w)).toBeCloseTo(10)
    expect(w[0]).toBeCloseTo(5)
    expect(w[1]).toBeCloseTo(5)
    expect(w[2]).toBeCloseTo(0)
  })

  it('adds overlapping phases on the same week', () => {
    const w = distributeAnnualBudget(100, 52, [
      { weeks: [0], hours: 10 },
      { weeks: [0], hours: 6 }
    ])
    // week 0 = 10 + 6 = 16; remaining 84 over 51 base weeks
    expect(w[0]).toBeCloseTo(16)
    expect(w[1]).toBeCloseTo(84 / 51)
    expect(sum(w)).toBeCloseTo(100)
  })

  it('spreads leftover base over all weeks when every week is in a phase', () => {
    // phases cover both weeks with 4h total, annual 10 → 6h base spread over all
    const w = distributeAnnualBudget(10, 2, [{ weeks: [0, 1], hours: 4 }])
    expect(sum(w)).toBeCloseTo(10)
  })
})

describe('distributeAnnualBudgetSplit', () => {
  it('puts everything in base when there are no phases', () => {
    const { base, intensive } = distributeAnnualBudgetSplit(52, 52, [])
    expect(sum(base)).toBeCloseTo(52)
    expect(sum(intensive)).toBeCloseTo(0)
    expect(base.every((h) => Math.abs(h - 1) < 1e-9)).toBe(true)
  })

  it('separates phase hours (intensive) from the evenly-spread base', () => {
    const phases: IntensivePhaseInput[] = [{ weeks: [0, 1], hours: 20 }]
    const { base, intensive } = distributeAnnualBudgetSplit(52, 52, phases)
    expect(intensive[0]).toBeCloseTo(10)
    expect(intensive[1]).toBeCloseTo(10)
    expect(intensive[2]).toBeCloseTo(0)
    expect(base[0]).toBeCloseTo(0) // phase week has no base
    expect(base[1]).toBeCloseTo(0)
    expect(base[2]).toBeCloseTo(32 / 50)
    expect(sum(intensive)).toBeCloseTo(20)
    expect(sum(base)).toBeCloseTo(32)
  })

  it('base+intensive equals the combined distribution elementwise', () => {
    const phases: IntensivePhaseInput[] = [
      { weeks: [0], hours: 10 },
      { weeks: [0, 3], hours: 6 }
    ]
    const combined = distributeAnnualBudget(100, 12, phases)
    const { base, intensive } = distributeAnnualBudgetSplit(100, 12, phases)
    for (let i = 0; i < 12; i++) {
      expect(base[i] + intensive[i]).toBeCloseTo(combined[i])
    }
  })

  it('when phases overflow the budget, base is zero and intensive is capped', () => {
    const { base, intensive } = distributeAnnualBudgetSplit(10, 52, [
      { weeks: [0, 1], hours: 20 }
    ])
    expect(sum(base)).toBeCloseTo(0)
    expect(sum(intensive)).toBeCloseTo(10)
  })

  it('enforces a per-week minimum weekly load (lower border), even above budget', () => {
    // 52h over 52 weeks = 1/week, floored up to a 2h/week minimum
    const { base } = distributeAnnualBudgetSplit(52, 52, [], 2)
    expect(base.every((h) => Math.abs(h - 2) < 1e-9)).toBe(true)
    expect(sum(base)).toBeCloseTo(104)
  })

  it('skips closed weeks (Betriebsferien) — spreads base only over open weeks', () => {
    // 40h over 4 weeks; week 1 & 2 closed → base spreads over weeks 0 and 3.
    const { base } = distributeAnnualBudgetSplit(40, 4, [], 0, [
      false,
      true,
      true,
      false
    ])
    expect(base[1]).toBeCloseTo(0)
    expect(base[2]).toBeCloseTo(0)
    expect(base[0]).toBeCloseTo(20)
    expect(base[3]).toBeCloseTo(20)
    expect(sum(base)).toBeCloseTo(40)
  })

  it('keeps a phase out of the base but still no base in closed weeks', () => {
    // week 0 phase 10h; week 3 closed → base (annual 30 minus... ) over weeks 1,2
    const { base, intensive } = distributeAnnualBudgetSplit(
      40,
      4,
      [{ weeks: [0], hours: 10 }],
      0,
      [false, false, false, true]
    )
    expect(intensive[0]).toBeCloseTo(10)
    expect(base[3]).toBeCloseTo(0) // closed
    // base 30 over open non-phase weeks (1, 2) = 15 each
    expect(base[1]).toBeCloseTo(15)
    expect(base[2]).toBeCloseTo(15)
  })

  it('the minimum floors the TOTAL weekly load, not base on top of a phase', () => {
    // annual 13 over 4 weeks, a 10h phase in week 0. Base budget = 3 over the
    // 3 non-phase weeks = 1/week. With a 2h/week minimum: week 0 already has 10h
    // (no floor), the others get floored from 1 → 2.
    const { base, intensive } = distributeAnnualBudgetSplit(
      13,
      4,
      [{ weeks: [0], hours: 10 }],
      2
    )
    expect(intensive[0]).toBeCloseTo(10)
    expect(base[0]).toBeCloseTo(0)
    expect(base[1]).toBeCloseTo(2)
    expect(base[2]).toBeCloseTo(2)
    expect(base[3]).toBeCloseTo(2)
  })
})

describe('weeklyUtilization', () => {
  it('is planned/capacity, flagged as overload above 1', () => {
    expect(weeklyUtilization(30, 40).ratio).toBeCloseTo(0.75)
    expect(weeklyUtilization(30, 40).overloaded).toBe(false)
    expect(weeklyUtilization(50, 40).overloaded).toBe(true)
  })

  it('treats any planned load with zero capacity as overload', () => {
    expect(weeklyUtilization(5, 0).overloaded).toBe(true)
    expect(weeklyUtilization(0, 0).overloaded).toBe(false)
    expect(weeklyUtilization(0, 0).ratio).toBe(0)
  })
})
