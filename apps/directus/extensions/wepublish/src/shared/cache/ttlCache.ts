/**
 * In-memory TTL cache with single-flight deduplication.
 *
 * Stays in process memory — fine for the single Directus instance pattern this
 * project deploys. If/when we scale horizontally, swap the storage for Redis
 * and keep the same surface.
 */
export interface CacheEntry<T> {
  value: T
  expiresAt: number
}

export interface TtlCacheOptions {
  ttlMs: number
  /** Override for tests so we can advance the clock deterministically. */
  now?: () => number
}

export class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>()
  private readonly inflight = new Map<string, Promise<T>>()
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(options: TtlCacheOptions) {
    this.ttlMs = options.ttlMs
    this.now = options.now ?? (() => Date.now())
  }

  get(key: string): T | undefined {
    return this.getEntry(key)?.value
  }

  /**
   * Returns the live entry (value + expiresAt) or undefined when missing or
   * expired. Lets the caller surface cache metadata — e.g. expose hit/miss and
   * remaining TTL to the frontend without re-fetching.
   */
  getEntry(key: string): CacheEntry<T> | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key)
      return undefined
    }
    return entry
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs })
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  /**
   * Returns true if a live entry was removed. Stale entries also count, since
   * the caller's intent is "make sure the next read recomputes".
   */
  invalidate(key: string): boolean {
    return this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
    this.inflight.clear()
  }

  size(): number {
    return this.store.size
  }

  /**
   * Returns the cached value if fresh, otherwise runs `factory` and caches the
   * result. Concurrent calls for the same key share a single inflight promise
   * — important for the Jira/Clockodo path where a thundering herd of dashboard
   * loads would otherwise trigger 429s.
   *
   * If `factory` rejects, nothing is cached and the inflight slot is freed so
   * the next caller can retry.
   */
  async getOrCompute(key: string, factory: () => Promise<T>): Promise<T> {
    const cached = this.get(key)
    if (cached !== undefined) return cached

    const existing = this.inflight.get(key)
    if (existing) return existing

    const promise = (async () => {
      try {
        const value = await factory()
        this.set(key, value)
        return value
      } finally {
        this.inflight.delete(key)
      }
    })()

    this.inflight.set(key, promise)
    return promise
  }
}
