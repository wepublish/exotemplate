import { describe, it, expect, vi } from 'vitest'
import { TtlCache } from './ttlCache'

function clock(start = 0) {
  let time = start
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms
    }
  }
}

describe('TtlCache.get/set', () => {
  it('returns undefined for missing keys', () => {
    const cache = new TtlCache<string>({ ttlMs: 1000 })
    expect(cache.get('nope')).toBeUndefined()
  })

  it('returns a value within the TTL', () => {
    const c = clock()
    const cache = new TtlCache<string>({ ttlMs: 1000, now: c.now })
    cache.set('a', 'hello')
    c.advance(500)
    expect(cache.get('a')).toBe('hello')
  })

  it('expires a value past the TTL', () => {
    const c = clock()
    const cache = new TtlCache<string>({ ttlMs: 1000, now: c.now })
    cache.set('a', 'hello')
    c.advance(1500)
    expect(cache.get('a')).toBeUndefined()
  })

  it('treats expiration boundary as expired (>= ttl)', () => {
    const c = clock()
    const cache = new TtlCache<string>({ ttlMs: 1000, now: c.now })
    cache.set('a', 'hello')
    c.advance(1000)
    expect(cache.get('a')).toBeUndefined()
  })

  it('purges the entry on expiry so size shrinks', () => {
    const c = clock()
    const cache = new TtlCache<string>({ ttlMs: 1000, now: c.now })
    cache.set('a', 'hello')
    expect(cache.size()).toBe(1)
    c.advance(2000)
    cache.get('a')
    expect(cache.size()).toBe(0)
  })

  it('overwrites existing values and resets TTL', () => {
    const c = clock()
    const cache = new TtlCache<string>({ ttlMs: 1000, now: c.now })
    cache.set('a', 'first')
    c.advance(800)
    cache.set('a', 'second')
    c.advance(500)
    expect(cache.get('a')).toBe('second')
  })
})

describe('TtlCache.getEntry', () => {
  it('returns the entry with its expiresAt', () => {
    const c = clock(1000)
    const cache = new TtlCache<string>({ ttlMs: 5000, now: c.now })
    cache.set('a', 'hi')
    expect(cache.getEntry('a')).toEqual({ value: 'hi', expiresAt: 6000 })
  })

  it('returns undefined when missing', () => {
    const cache = new TtlCache<string>({ ttlMs: 1000 })
    expect(cache.getEntry('nope')).toBeUndefined()
  })

  it('returns undefined when expired and purges the entry', () => {
    const c = clock()
    const cache = new TtlCache<string>({ ttlMs: 1000, now: c.now })
    cache.set('a', 'hi')
    c.advance(2000)
    expect(cache.getEntry('a')).toBeUndefined()
    expect(cache.size()).toBe(0)
  })

  it('lets callers compute remaining TTL', () => {
    const c = clock(0)
    const cache = new TtlCache<string>({ ttlMs: 1000, now: c.now })
    cache.set('a', 'hi')
    c.advance(300)
    const entry = cache.getEntry('a')!
    expect(entry.expiresAt - c.now()).toBe(700)
  })
})

describe('TtlCache.invalidate', () => {
  it('returns true when an entry was removed', () => {
    const cache = new TtlCache<string>({ ttlMs: 1000 })
    cache.set('a', 'x')
    expect(cache.invalidate('a')).toBe(true)
    expect(cache.get('a')).toBeUndefined()
  })

  it('returns false when there was nothing to remove', () => {
    const cache = new TtlCache<string>({ ttlMs: 1000 })
    expect(cache.invalidate('a')).toBe(false)
  })

  it('only removes the requested key', () => {
    const cache = new TtlCache<string>({ ttlMs: 1000 })
    cache.set('a', '1')
    cache.set('b', '2')
    cache.invalidate('a')
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe('2')
  })

  it('clear() removes everything', () => {
    const cache = new TtlCache<string>({ ttlMs: 1000 })
    cache.set('a', '1')
    cache.set('b', '2')
    cache.clear()
    expect(cache.size()).toBe(0)
  })
})

describe('TtlCache.getOrCompute', () => {
  it('runs the factory on a miss and caches the result', async () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 })
    const factory = vi.fn().mockResolvedValue(42)

    expect(await cache.getOrCompute('k', factory)).toBe(42)
    expect(await cache.getOrCompute('k', factory)).toBe(42)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('refreshes after the TTL has elapsed (refresh-on-request only)', async () => {
    const c = clock()
    const cache = new TtlCache<number>({ ttlMs: 1000, now: c.now })
    const factory = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)

    expect(await cache.getOrCompute('k', factory)).toBe(1)
    c.advance(500)
    // still fresh — no recompute
    expect(await cache.getOrCompute('k', factory)).toBe(1)
    expect(factory).toHaveBeenCalledTimes(1)

    c.advance(1000)
    // expired — next call recomputes
    expect(await cache.getOrCompute('k', factory)).toBe(2)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('after invalidate, the next call recomputes', async () => {
    const cache = new TtlCache<number>({ ttlMs: 60_000 })
    const factory = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)

    await cache.getOrCompute('k', factory)
    cache.invalidate('k')
    expect(await cache.getOrCompute('k', factory)).toBe(2)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('deduplicates concurrent calls for the same key (single-flight)', async () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 })
    let resolveFactory!: (value: number) => void
    const factory = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveFactory = resolve
        })
    )

    const a = cache.getOrCompute('k', factory)
    const b = cache.getOrCompute('k', factory)
    const c = cache.getOrCompute('k', factory)

    resolveFactory(7)
    expect(await Promise.all([a, b, c])).toEqual([7, 7, 7])
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('does not cache rejected factories and frees the inflight slot', async () => {
    const cache = new TtlCache<number>({ ttlMs: 1000 })
    const error = new Error('429 too many requests')
    const factory = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(99)

    await expect(cache.getOrCompute('k', factory)).rejects.toBe(error)
    // a follow-up call should retry, not return the failed promise
    expect(await cache.getOrCompute('k', factory)).toBe(99)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('keeps separate keys in their own slots', async () => {
    const cache = new TtlCache<string>({ ttlMs: 1000 })
    expect(await cache.getOrCompute('a', async () => 'A')).toBe('A')
    expect(await cache.getOrCompute('b', async () => 'B')).toBe('B')
    expect(cache.get('a')).toBe('A')
    expect(cache.get('b')).toBe('B')
  })
})
