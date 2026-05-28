import type { ClockodoTargetHourRow } from '../clockodo/targetHours'
import { TtlCache } from './ttlCache'

/**
 * Cache singleton for the Clockodo target-hours list. Contracts change
 * rarely; an hour of staleness is fine. Keyed by literal `'all'` since we
 * always fetch the whole list (the endpoint supports a `users_id` filter but
 * we'd lose the workspace-wide cache hit benefit).
 */
const CLOCKODO_TARGET_HOURS_CACHE_TTL_MS = 60 * 60 * 1000

let singleton: TtlCache<ClockodoTargetHourRow[]> | null = null

export function getClockodoTargetHoursCache(): TtlCache<
  ClockodoTargetHourRow[]
> {
  if (!singleton) {
    singleton = new TtlCache<ClockodoTargetHourRow[]>({
      ttlMs: CLOCKODO_TARGET_HOURS_CACHE_TTL_MS
    })
  }
  return singleton
}

export const CLOCKODO_TARGET_HOURS_CACHE_KEY = 'all'

/** Test-only — reset the singleton between cases. */
export function __resetClockodoTargetHoursCacheForTests(): void {
  singleton = null
}
