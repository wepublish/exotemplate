import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BillingEnv } from '../billing/env'
import type { ClockodoParams } from '../billing/clockodo'
import { computeNetworkContribution } from './pipeline'
import { SECONDS_PER_HOUR } from '../billing/aggregateHours'
import {
  WEPUBLISH_INTERNAL_CUSTOMER_ID,
  WESHARE_CLOCKODO_CUSTOMER_ID
} from './constants'

const getGroupEntriesFromClockodo = vi.hoisted(() => vi.fn())

vi.mock('../billing/clockodo', () => ({
  getGroupEntriesFromClockodo
}))

const env = {} as BillingEnv

afterEach(() => {
  getGroupEntriesFromClockodo.mockReset()
})

// The two parallel calls are distinguished by their grouping shape — the
// bucketing query groups by customers_id+services_id, the other-clients query
// only by customers_id.
function findBucketingCall() {
  return getGroupEntriesFromClockodo.mock.calls.find(([params]) =>
    (params as ClockodoParams).grouping?.includes('services_id')
  )
}

function findOtherClientsCall() {
  return getGroupEntriesFromClockodo.mock.calls.find(
    ([params]) => !(params as ClockodoParams).grouping?.includes('services_id')
  )
}

describe('computeNetworkContribution', () => {
  it('makes exactly two parallel Clockodo calls — bucketing + other-clients', async () => {
    getGroupEntriesFromClockodo.mockResolvedValue({ groups: [] })

    await computeNetworkContribution(
      { from: new Date('2026-01-01'), to: new Date('2026-06-30') },
      env
    )

    expect(getGroupEntriesFromClockodo.mock.calls).toHaveLength(2)
  })

  it('uses an unfiltered customers+services-grouped query for the bucketing data (Clockodo rejects multi-value customers_id, so we slice locally)', async () => {
    getGroupEntriesFromClockodo.mockResolvedValue({ groups: [] })

    await computeNetworkContribution(
      { from: new Date('2026-01-01'), to: new Date('2026-06-30') },
      env
    )

    const bucketingCall = findBucketingCall()
    expect(bucketingCall).toBeDefined()
    const params = bucketingCall![0] as ClockodoParams
    expect(params.grouping).toEqual(['customers_id', 'services_id'])
    expect(params.filter).toEqual({})
  })

  it('keeps billable: 1 on the other-clients query so only billed hours count toward the network total', async () => {
    getGroupEntriesFromClockodo.mockResolvedValue({ groups: [] })

    await computeNetworkContribution(
      { from: new Date('2026-01-01'), to: new Date('2026-06-30') },
      env
    )

    const otherClientsCall = findOtherClientsCall()
    expect(otherClientsCall).toBeDefined()
    expect((otherClientsCall![0] as ClockodoParams).filter).toEqual({
      billable: 1
    })
  })

  it('locally slices the unfiltered bucketing response into we.share buckets and we.publish-internal total, ignoring other customers in that response', async () => {
    // First call (bucketing) returns ALL customers' nested groups — we.share,
    // we.publish, plus an unrelated paying customer to verify it's skipped at
    // this layer. Second call (other clients) is empty.
    getGroupEntriesFromClockodo
      .mockResolvedValueOnce({
        groups: [
          {
            group: WESHARE_CLOCKODO_CUSTOMER_ID,
            duration: 10 * SECONDS_PER_HOUR,
            sub_groups: [
              {
                group: '1100317',
                duration: 4 * SECONDS_PER_HOUR,
                sub_groups: []
              },
              {
                group: '1100344',
                duration: 6 * SECONDS_PER_HOUR,
                sub_groups: []
              }
            ]
          },
          {
            group: WEPUBLISH_INTERNAL_CUSTOMER_ID,
            duration: 8 * SECONDS_PER_HOUR,
            sub_groups: [
              {
                group: '1131470',
                duration: 8 * SECONDS_PER_HOUR,
                sub_groups: []
              }
            ]
          },
          {
            group: '9999999',
            duration: 50 * SECONDS_PER_HOUR,
            sub_groups: [
              {
                group: '1100315',
                duration: 50 * SECONDS_PER_HOUR,
                sub_groups: []
              }
            ]
          }
        ]
      })
      .mockResolvedValueOnce({ groups: [] })

    const result = await computeNetworkContribution(
      { from: new Date('2026-01-01'), to: new Date('2026-06-30') },
      env
    )

    expect(result.weShare.acquisition).toBe(4)
    expect(result.weShare.hosting).toBe(6)
    expect(result.weShare.total).toBe(10)
    expect(result.wepublishInternal.hours).toBe(8)
    // The unrelated paying customer's hours don't leak into we.share or
    // we.publish — they only feed otherClients via the second call.
    expect(result.weShare.engineering).toBe(0)
  })
})
