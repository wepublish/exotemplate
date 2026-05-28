import type { UserDailyHours } from '../clockodo/userDailyHours'
import { TtlCache } from './ttlCache'

/**
 * Cache singleton for the per-user, per-day captured-hours query. TTL is
 * shorter than the other Clockodo caches (15 min) because this is the data
 * the dashboard *wants* to feel current — if someone logs their hours after
 * being flagged, they should see themselves go green within the quarter
 * hour. Keyed by ISO-date range so distinct ranges don't collide.
 */
const CLOCKODO_USER_DAILY_HOURS_CACHE_TTL_MS = 15 * 60 * 1000

let singleton: TtlCache<UserDailyHours[]> | null = null

export function getClockodoUserDailyHoursCache(): TtlCache<UserDailyHours[]> {
  if (!singleton) {
    singleton = new TtlCache<UserDailyHours[]>({
      ttlMs: CLOCKODO_USER_DAILY_HOURS_CACHE_TTL_MS
    })
  }
  return singleton
}

export function clockodoUserDailyHoursCacheKey(
  fromIso: string,
  toIso: string
): string {
  return `${fromIso}:${toIso}`
}

export const CLOCKODO_USER_DAILY_HOURS_TTL_MS =
  CLOCKODO_USER_DAILY_HOURS_CACHE_TTL_MS

/** Test-only — reset the singleton between cases. */
export function __resetClockodoUserDailyHoursCacheForTests(): void {
  singleton = null
}
