import { TtlCache } from './ttlCache'

/**
 * Sentry aggregates over a 30-day window move slowly, and the events-stats API
 * is rate-limited, so a few minutes of staleness is fine and collapses a burst
 * of dashboard loads into one upstream call (single-flight in TtlCache).
 */
export const SENTRY_CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Per-chart cache key — one entry per (chart, medium) pair. The medium scopes
 * the key so two clients' charts never share a cached Sentry payload.
 */
export function sentryChartCacheKey(chartKey: string, medium: string): string {
  return `chart:${medium}:${chartKey}`
}

/** Per-table cache key — one entry per (table, medium) pair. */
export function sentryTableCacheKey(tableKey: string, medium: string): string {
  return `table:${medium}:${tableKey}`
}

let singleton: TtlCache<any> | null = null

export function getSentryCache(): TtlCache<any> {
  if (!singleton) {
    singleton = new TtlCache<any>({ ttlMs: SENTRY_CACHE_TTL_MS })
  }
  return singleton
}
