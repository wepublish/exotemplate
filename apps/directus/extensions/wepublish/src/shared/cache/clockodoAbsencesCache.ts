import type { ClockodoAbsence } from '../clockodo/absences'
import { TtlCache } from './ttlCache'

/**
 * Cache singleton for Clockodo absences. Keyed per year (`'2026'`, `'2025'`)
 * since Clockodo's v2 endpoint is year-scoped. One hour of staleness is fine
 * — vacations are planned days in advance, not minutes.
 */
const CLOCKODO_ABSENCES_CACHE_TTL_MS = 60 * 60 * 1000

let singleton: TtlCache<ClockodoAbsence[]> | null = null

export function getClockodoAbsencesCache(): TtlCache<ClockodoAbsence[]> {
  if (!singleton) {
    singleton = new TtlCache<ClockodoAbsence[]>({
      ttlMs: CLOCKODO_ABSENCES_CACHE_TTL_MS
    })
  }
  return singleton
}

export function clockodoAbsencesCacheKey(year: number): string {
  return String(year)
}

/** Test-only — reset the singleton between cases. */
export function __resetClockodoAbsencesCacheForTests(): void {
  singleton = null
}
