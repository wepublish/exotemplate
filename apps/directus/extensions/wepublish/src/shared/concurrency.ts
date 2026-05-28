/**
 * Run an array of async task factories with a hard cap on how many run in
 * parallel. Returns the same shape as `Promise.allSettled` so callers can
 * inspect per-task outcomes — important for the billing-snapshot refresh,
 * which must keep going when one client's Clockodo/Jira call fails.
 *
 * Why factories rather than already-started promises: we want backpressure.
 * Passing pre-started promises would already have fired every Clockodo
 * request before this function gets a chance to throttle.
 */
export async function runWithConcurrency<T>(
  factories: ReadonlyArray<() => Promise<T>>,
  limit: number
): Promise<PromiseSettledResult<T>[]> {
  if (limit < 1) throw new Error('Concurrency limit must be >= 1')
  if (factories.length === 0) return []

  const results: PromiseSettledResult<T>[] = new Array(factories.length)
  let next = 0

  async function worker(): Promise<void> {
    while (true) {
      const index = next
      next += 1
      if (index >= factories.length) return
      const factory = factories[index]
      if (!factory) {
        results[index] = {
          status: 'rejected',
          reason: new Error(`No factory at index ${index}`)
        }
        continue
      }
      try {
        results[index] = { status: 'fulfilled', value: await factory() }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, factories.length) },
    () => worker()
  )
  await Promise.all(workers)
  return results
}
