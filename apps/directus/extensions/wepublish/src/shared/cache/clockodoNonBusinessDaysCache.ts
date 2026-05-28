import type { ClockodoNonBusinessDay } from '../clockodo/nonBusinessDays'
import { TtlCache } from './ttlCache'

/**
 * Cache singleton for Clockodo non-business days. Public-holiday calendars
 * are stable across a year, so an hour of staleness is more than fine; per-
 * year key matches the endpoint's `year` parameter.
 */
const CLOCKODO_NON_BUSINESS_DAYS_CACHE_TTL_MS = 60 * 60 * 1000

let singleton: TtlCache<ClockodoNonBusinessDay[]> | null = null

export function getClockodoNonBusinessDaysCache(): TtlCache<
  ClockodoNonBusinessDay[]
> {
  if (!singleton) {
    singleton = new TtlCache<ClockodoNonBusinessDay[]>({
      ttlMs: CLOCKODO_NON_BUSINESS_DAYS_CACHE_TTL_MS
    })
  }
  return singleton
}

export function clockodoNonBusinessDaysCacheKey(year: number): string {
  return String(year)
}

/** Test-only — reset the singleton between cases. */
export function __resetClockodoNonBusinessDaysCacheForTests(): void {
  singleton = null
}
