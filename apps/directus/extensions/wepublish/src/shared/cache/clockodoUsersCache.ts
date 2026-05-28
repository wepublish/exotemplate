import type { ClockodoUser } from '../clockodo/users'
import { TtlCache } from './ttlCache'

/**
 * Cache singleton for the Clockodo users list. The workspace's roster changes
 * rarely; an hour of staleness is fine. Keyed by the literal string `'all'`
 * since we always fetch the whole list.
 */
const CLOCKODO_USERS_CACHE_TTL_MS = 60 * 60 * 1000

let singleton: TtlCache<ClockodoUser[]> | null = null

export function getClockodoUsersCache(): TtlCache<ClockodoUser[]> {
  if (!singleton) {
    singleton = new TtlCache<ClockodoUser[]>({
      ttlMs: CLOCKODO_USERS_CACHE_TTL_MS
    })
  }
  return singleton
}

export const CLOCKODO_USERS_CACHE_KEY = 'all'

/** Test-only — reset the singleton between cases. */
export function __resetClockodoUsersCacheForTests(): void {
  singleton = null
}
