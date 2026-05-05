import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  BILLING_CACHE_TTL_MS,
  billingCacheKey,
  getBillingCache,
  loadBillingResultWithMeta,
  __resetBillingCacheForTests
} from './billingCache'
import type { EntryGroupComputed } from '../billing/aggregateHours'
import { TtlCache } from './ttlCache'

describe('billingCacheKey', () => {
  it('combines clientId and clientPeriodId with a separator', () => {
    expect(billingCacheKey('client-a', 42)).toBe('client-a:42')
  })

  it('produces different keys for different clients with the same period id', () => {
    expect(billingCacheKey('client-a', 1)).not.toBe(
      billingCacheKey('client-b', 1)
    )
  })

  it('produces different keys for different periods within the same client', () => {
    expect(billingCacheKey('client-a', 1)).not.toBe(
      billingCacheKey('client-a', 2)
    )
  })

  it('handles string and number period ids equivalently', () => {
    expect(billingCacheKey('c', '7')).toBe(billingCacheKey('c', 7))
  })
})

describe('getBillingCache', () => {
  beforeEach(() => {
    __resetBillingCacheForTests()
  })

  it('returns a singleton across calls', () => {
    expect(getBillingCache()).toBe(getBillingCache())
  })

  it('uses the configured 1-hour TTL', () => {
    expect(BILLING_CACHE_TTL_MS).toBe(60 * 60 * 1000)
  })

  it('starts empty after reset', () => {
    expect(getBillingCache().size()).toBe(0)
  })

  it('isolates entries for different (clientId, clientPeriodId) pairs', () => {
    const cache = getBillingCache()
    cache.set(billingCacheKey('client-a', 1), { groups: [], sums: {} as any })
    cache.set(billingCacheKey('client-a', 2), { groups: [], sums: {} as any })
    cache.set(billingCacheKey('client-b', 1), { groups: [], sums: {} as any })

    expect(cache.size()).toBe(3)
    expect(cache.has(billingCacheKey('client-a', 1))).toBe(true)
    expect(cache.has(billingCacheKey('client-a', 2))).toBe(true)
    expect(cache.has(billingCacheKey('client-b', 1))).toBe(true)
  })

  it('invalidates a single (clientId, clientPeriodId) key without touching siblings', () => {
    const cache = getBillingCache()
    cache.set(billingCacheKey('client-a', 1), { groups: [], sums: {} as any })
    cache.set(billingCacheKey('client-a', 2), { groups: [], sums: {} as any })
    cache.set(billingCacheKey('client-b', 1), { groups: [], sums: {} as any })

    expect(cache.invalidate(billingCacheKey('client-a', 1))).toBe(true)
    expect(cache.has(billingCacheKey('client-a', 1))).toBe(false)
    expect(cache.has(billingCacheKey('client-a', 2))).toBe(true)
    expect(cache.has(billingCacheKey('client-b', 1))).toBe(true)
  })
})

describe('loadBillingResultWithMeta', () => {
  const fakeData = (label: string): EntryGroupComputed => ({
    groups: [],
    sums: { billableHours: label.length } as any
  })

  function fixedClock(start = 1_000_000) {
    let time = start
    return {
      now: () => time,
      advance: (ms: number) => {
        time += ms
      }
    }
  }

  it('returns hit=false and runs the factory on a cold cache', async () => {
    const c = fixedClock()
    const cache = new TtlCache<EntryGroupComputed>({
      ttlMs: 60_000,
      now: c.now
    })
    const factory = vi.fn().mockResolvedValue(fakeData('fresh'))

    const result = await loadBillingResultWithMeta(cache, 'k', factory, 60_000)

    expect(factory).toHaveBeenCalledTimes(1)
    expect(result.data).toEqual(fakeData('fresh'))
    expect(result.cache).toEqual({
      hit: false,
      cachedAt: c.now(),
      expiresAt: c.now() + 60_000,
      ttlMs: 60_000
    })
  })

  it('returns hit=true and skips the factory on a warm cache', async () => {
    const c = fixedClock()
    const cache = new TtlCache<EntryGroupComputed>({
      ttlMs: 60_000,
      now: c.now
    })
    const factory = vi.fn().mockResolvedValue(fakeData('warm'))

    await loadBillingResultWithMeta(cache, 'k', factory, 60_000)
    c.advance(10_000)

    const result = await loadBillingResultWithMeta(cache, 'k', factory, 60_000)

    expect(factory).toHaveBeenCalledTimes(1)
    expect(result.cache.hit).toBe(true)
    // cachedAt is the original write time (10s before now)
    expect(result.cache.cachedAt).toBe(c.now() - 10_000)
    expect(result.cache.expiresAt).toBe(c.now() - 10_000 + 60_000)
  })

  it('reports a fresh result with full TTL after invalidation', async () => {
    const c = fixedClock()
    const cache = new TtlCache<EntryGroupComputed>({
      ttlMs: 60_000,
      now: c.now
    })
    const factory = vi
      .fn()
      .mockResolvedValueOnce(fakeData('first'))
      .mockResolvedValueOnce(fakeData('second'))

    await loadBillingResultWithMeta(cache, 'k', factory, 60_000)
    c.advance(20_000)
    cache.invalidate('k')

    const result = await loadBillingResultWithMeta(cache, 'k', factory, 60_000)

    expect(factory).toHaveBeenCalledTimes(2)
    expect(result.cache.hit).toBe(false)
    expect(result.cache.cachedAt).toBe(c.now())
    expect(result.cache.expiresAt - result.cache.cachedAt).toBe(60_000)
  })

  it('reports a fresh result after the previous entry expired naturally', async () => {
    const c = fixedClock()
    const cache = new TtlCache<EntryGroupComputed>({
      ttlMs: 1000,
      now: c.now
    })
    const factory = vi
      .fn()
      .mockResolvedValueOnce(fakeData('one'))
      .mockResolvedValueOnce(fakeData('two'))

    await loadBillingResultWithMeta(cache, 'k', factory, 1000)
    c.advance(2000)

    const result = await loadBillingResultWithMeta(cache, 'k', factory, 1000)

    expect(result.cache.hit).toBe(false)
    expect(result.data).toEqual(fakeData('two'))
  })
})
