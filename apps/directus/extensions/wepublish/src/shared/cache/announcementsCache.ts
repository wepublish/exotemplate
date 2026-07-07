import { TtlCache } from './ttlCache'

/**
 * The public `/messages` endpoint is unauthenticated and consumed by every
 * dashboard load and every editor instance, so a short TTL collapses that
 * traffic into a single DB read. Only the RAW published rows are cached (one
 * entry, key `all`); the per-request medium/locale filtering + resolution runs
 * cheaply on top, so one cached read serves all media and languages.
 */
export const ANNOUNCEMENTS_CACHE_TTL_MS = 60 * 1000

export const ANNOUNCEMENTS_CACHE_KEY = 'all'

let singleton: TtlCache<any> | null = null

export function getAnnouncementsCache(): TtlCache<any> {
  if (!singleton) {
    singleton = new TtlCache<any>({ ttlMs: ANNOUNCEMENTS_CACHE_TTL_MS })
  }
  return singleton
}

/** Test-only — reset the singleton between cases. */
export function __resetAnnouncementsCacheForTests(): void {
  singleton = null
}
