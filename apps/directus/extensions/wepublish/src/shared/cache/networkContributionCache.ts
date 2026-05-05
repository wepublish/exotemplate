import type { NetworkContributionData } from '../networkContribution/aggregate'
import type { BillingCacheMeta } from './billingCache'
import { TtlCache } from './ttlCache'

export interface NetworkContributionResponse {
  data: NetworkContributionData
  cache: BillingCacheMeta
}

/**
 * Same TTL rationale as the billing cache: short enough that the dashboard
 * never shows badly stale numbers, long enough that a thundering herd of
 * dashboard loads doesn't hammer Clockodo.
 */
export const NETWORK_CONTRIBUTION_CACHE_TTL_MS = 60 * 60 * 1000

/**
 * Network contribution depends only on the period's date range, so we key by
 * clientPeriodId alone (not clientId). Different clients viewing the same
 * period share a cache entry — the response doesn't carry per-client data.
 */
export function networkContributionCacheKey(
  clientPeriodId: string | number
): string {
  return `network:${clientPeriodId}`
}

let singleton: TtlCache<NetworkContributionData> | null = null

export function getNetworkContributionCache(): TtlCache<NetworkContributionData> {
  if (!singleton) {
    singleton = new TtlCache<NetworkContributionData>({
      ttlMs: NETWORK_CONTRIBUTION_CACHE_TTL_MS
    })
  }
  return singleton
}

/** Test-only — reset the singleton between cases. */
export function __resetNetworkContributionCacheForTests(): void {
  singleton = null
}

export async function loadNetworkContributionResultWithMeta(
  cache: TtlCache<NetworkContributionData>,
  key: string,
  compute: () => Promise<NetworkContributionData>,
  ttlMs: number = NETWORK_CONTRIBUTION_CACHE_TTL_MS
): Promise<NetworkContributionResponse> {
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
