import { describe, expect, it } from 'vitest'
import { computeReferenceDate } from './api'

function utc(year: number, monthZeroIndexed: number, day: number): Date {
  return new Date(Date.UTC(year, monthZeroIndexed, day, 8, 45))
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

describe('computeReferenceDate', () => {
  it('picks yesterday on a normal weekday (Tue→Mon)', () => {
    const result = computeReferenceDate(utc(2026, 4, 26)) // Tue 2026-05-26
    expect(iso(result)).toBe('2026-05-25') // Mon
  })

  it('shifts back to Friday on Monday', () => {
    const result = computeReferenceDate(utc(2026, 4, 25)) // Mon 2026-05-25
    expect(iso(result)).toBe('2026-05-22') // Fri
  })

  it('shifts back to Friday when run on Saturday', () => {
    const result = computeReferenceDate(utc(2026, 4, 30)) // Sat 2026-05-30
    expect(iso(result)).toBe('2026-05-29') // Fri
  })

  it('shifts back to Friday when run on Sunday', () => {
    const result = computeReferenceDate(utc(2026, 4, 31)) // Sun 2026-05-31
    expect(iso(result)).toBe('2026-05-29') // Fri
  })
})
