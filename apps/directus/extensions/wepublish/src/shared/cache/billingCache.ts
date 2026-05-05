import type { EntryGroupComputed } from '../billing/aggregateHours'
import { TtlCache } from './ttlCache'

/**
 * Cache metadata returned alongside the aggregatedHours response so the
 * frontend can show users whether the data is fresh or served from cache, how
 * old it is, and when it will be refreshed automatically.
 */
export interface BillingCacheMeta {
  hit: boolean
  cachedAt: number
  expiresAt: number
  ttlMs: number
}

export interface AggregatedHoursResponse {
  data: EntryGroupComputed
  cache: BillingCacheMeta
}

/**
 * Cache duration for the aggregatedHours endpoint result. Keep this short
 * enough that stale data isn't a concern for billing decisions, long enough
 * that a dashboard refresh-spam doesn't trigger Jira/Clockodo 429s. Tune in
 * code — no env var needed; users force-refresh per-period via the dashboard.
 */
export const BILLING_CACHE_TTL_MS = 60 * 60 * 1000

/**
 * One key per (clientId, clientPeriodId) pair. Including the client id makes
 * cross-period invalidation easy if we ever want it, and avoids any chance of
 * a clientPeriodId collision masking the wrong client.
 */
export function billingCacheKey(
  clientId: string,
  clientPeriodId: string | number
): string {
  return `${clientId}:${clientPeriodId}`
}

let singleton: TtlCache<EntryGroupComputed> | null = null

export function getBillingCache(): TtlCache<EntryGroupComputed> {
  if (!singleton) {
    singleton = new TtlCache<EntryGroupComputed>({
      ttlMs: BILLING_CACHE_TTL_MS
    })
  }
  return singleton
}

/** Test-only — reset the singleton between cases. */
export function __resetBillingCacheForTests(): void {
  singleton = null
}

/**
 * Computes the cached vs live result + metadata for a single
 * (clientId, clientPeriodId) lookup. Probes the cache before delegating to
 * `getOrCompute` so we can tell hit from miss, then re-reads the (now-fresh)
 * entry for the cachedAt/expiresAt values. Pure logic — no Directus types —
 * so it stays unit-testable.
 */
export async function loadBillingResultWithMeta(
  cache: TtlCache<EntryGroupComputed>,
  key: string,
  compute: () => Promise<EntryGroupComputed>,
  ttlMs: number = BILLING_CACHE_TTL_MS
): Promise<AggregatedHoursResponse> {
  const hit = cache.has(key)
  const data = await cache.getOrCompute(key, compute)
  const entry = cache.getEntry(key)
  const expiresAt = entry?.expiresAt ?? Date.now() + ttlMs
  return {
    data,
    cache: {
      hit,
      cachedAt: expiresAt - ttlMs,
      expiresAt,
      ttlMs
    }
  }
}
