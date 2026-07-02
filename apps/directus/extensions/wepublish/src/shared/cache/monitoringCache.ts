import { TtlCache } from './ttlCache'

/**
 * The configurator performs live liveness probes (up to 5s each), so a short
 * TTL keeps the dashboard feeling current while collapsing a burst of loads
 * into a single upstream sweep. Raw configurator payloads are cached; the
 * shaping helpers run per-request on top.
 */
export const MONITORING_CACHE_TTL_MS = 60 * 1000

export const MONITORING_OVERVIEW_KEY = 'overview'

export function mediumHealthCacheKey(mediumName: string): string {
  return `medium:${mediumName}`
}

let singleton: TtlCache<any> | null = null

export function getMonitoringCache(): TtlCache<any> {
  if (!singleton) {
    singleton = new TtlCache<any>({ ttlMs: MONITORING_CACHE_TTL_MS })
  }
  return singleton
}

/** Test-only — reset the singleton between cases. */
export function __resetMonitoringCacheForTests(): void {
  singleton = null
}
