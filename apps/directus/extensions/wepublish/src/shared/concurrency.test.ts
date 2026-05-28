import { describe, expect, it } from 'vitest'
import { runWithConcurrency } from './concurrency'

function defer<T>(): {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
} {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('runWithConcurrency', () => {
  it('returns empty for empty input', async () => {
    const result = await runWithConcurrency([], 3)
    expect(result).toEqual([])
  })

  it('caps concurrent in-flight tasks at the limit', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const deferreds = Array.from({ length: 6 }, () => defer<number>())

    const factories = deferreds.map((d, i) => async () => {
      inFlight += 1
      if (inFlight > maxInFlight) maxInFlight = inFlight
      const value = await d.promise
      inFlight -= 1
      return value
    })

    const runP = runWithConcurrency(factories, 2)

    // Settle them one at a time so we can observe the cap.
    for (let i = 0; i < deferreds.length; i++) {
      await Promise.resolve()
      await Promise.resolve()
      deferreds[i]!.resolve(i)
    }

    const results = await runP
    expect(maxInFlight).toBeLessThanOrEqual(2)
    expect(results.map((r) => r.status)).toEqual(Array(6).fill('fulfilled'))
  })

  it('continues when individual tasks reject — captures per-task outcomes', async () => {
    const factories = [
      async () => 'a',
      async () => {
        throw new Error('boom')
      },
      async () => 'c'
    ]

    const results = await runWithConcurrency(factories, 2)
    expect(results[0]).toEqual({ status: 'fulfilled', value: 'a' })
    expect(results[1]?.status).toBe('rejected')
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error)
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'c' })
  })

  it('preserves task → result index alignment', async () => {
    const factories = [
      async () => 10,
      async () => 20,
      async () => 30,
      async () => 40
    ]
    const results = await runWithConcurrency(factories, 2)
    expect(
      results.map((r) => (r as PromiseFulfilledResult<number>).value)
    ).toEqual([10, 20, 30, 40])
  })

  it('throws when limit is < 1', async () => {
    await expect(runWithConcurrency([async () => 1], 0)).rejects.toThrow()
  })
})
