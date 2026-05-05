import { describe, it, expect } from 'vitest'
import {
  aggregateOtherClients,
  bucketWeShareServices,
  sumGroupHours
} from './aggregate'
import type { EntryGroup } from '../billing/aggregateHours'
import { SECONDS_PER_HOUR } from '../billing/aggregateHours'
import { WESHARE_SERVICE_BUCKETS } from './constants'

function buildEntryGroup(overrides: Partial<EntryGroup> = {}): EntryGroup {
  return {
    group: '',
    grouped_by: [],
    name: '',
    revenue: 0,
    budget: 0,
    budget_is_hours: false,
    budget_is_strict: false,
    note: '',
    hourly_rate: 0,
    billable: 1,
    billable_amount: 0,
    duration: 0,
    restrictions: [],
    sub_groups: [],
    ...overrides
  }
}

describe('bucketWeShareServices', () => {
  it('returns zeros for empty input', () => {
    expect(bucketWeShareServices([])).toEqual({
      acquisition: 0,
      engineering: 0,
      hosting: 0,
      other: 0,
      total: 0
    })
  })

  it('routes service ids into the matching bucket', () => {
    const acquisitionId = WESHARE_SERVICE_BUCKETS.acquisition[0]!
    const engineeringId = WESHARE_SERVICE_BUCKETS.engineering[0]!
    const hostingId = WESHARE_SERVICE_BUCKETS.hosting[0]!

    const result = bucketWeShareServices([
      buildEntryGroup({ group: acquisitionId, duration: 2 * SECONDS_PER_HOUR }),
      buildEntryGroup({ group: engineeringId, duration: 5 * SECONDS_PER_HOUR }),
      buildEntryGroup({ group: hostingId, duration: 3 * SECONDS_PER_HOUR })
    ])

    expect(result).toEqual({
      acquisition: 2,
      engineering: 5,
      hosting: 3,
      other: 0,
      total: 10
    })
  })

  it('sums multiple service ids that map to the same bucket', () => {
    const [first, second] = WESHARE_SERVICE_BUCKETS.engineering
    const result = bucketWeShareServices([
      buildEntryGroup({ group: first!, duration: 4 * SECONDS_PER_HOUR }),
      buildEntryGroup({ group: second!, duration: 6 * SECONDS_PER_HOUR })
    ])
    expect(result.engineering).toBe(10)
    expect(result.total).toBe(10)
  })

  it('puts unknown service ids into the "other" bucket so totals still match', () => {
    const result = bucketWeShareServices([
      buildEntryGroup({ group: '9999999', duration: 7 * SECONDS_PER_HOUR })
    ])
    expect(result.other).toBe(7)
    expect(result.total).toBe(7)
    expect(result.acquisition).toBe(0)
    expect(result.engineering).toBe(0)
    expect(result.hosting).toBe(0)
  })

  it('rounds each bucket to quarter hours', () => {
    const acquisitionId = WESHARE_SERVICE_BUCKETS.acquisition[0]!
    const result = bucketWeShareServices([
      buildEntryGroup({
        group: acquisitionId,
        duration: 0.3 * SECONDS_PER_HOUR
      })
    ])
    expect(result.acquisition).toBe(0.25)
  })
})

describe('aggregateOtherClients', () => {
  it('returns zeros for empty input', () => {
    expect(aggregateOtherClients([], ['1', '2'])).toEqual({
      hours: 0,
      clientCount: 0
    })
  })

  it('sums hours across non-excluded customers and counts them', () => {
    const result = aggregateOtherClients(
      [
        buildEntryGroup({ group: '100', duration: 4 * SECONDS_PER_HOUR }),
        buildEntryGroup({ group: '200', duration: 6 * SECONDS_PER_HOUR }),
        buildEntryGroup({ group: '300', duration: 2 * SECONDS_PER_HOUR })
      ],
      []
    )
    expect(result).toEqual({ hours: 12, clientCount: 3 })
  })

  it('skips excluded customer ids', () => {
    const result = aggregateOtherClients(
      [
        buildEntryGroup({ group: '100', duration: 4 * SECONDS_PER_HOUR }),
        buildEntryGroup({ group: '200', duration: 6 * SECONDS_PER_HOUR }),
        buildEntryGroup({ group: '300', duration: 2 * SECONDS_PER_HOUR })
      ],
      ['200']
    )
    expect(result).toEqual({ hours: 6, clientCount: 2 })
  })

  it('does not count customers with zero hours toward clientCount', () => {
    const result = aggregateOtherClients(
      [
        buildEntryGroup({ group: '100', duration: 4 * SECONDS_PER_HOUR }),
        buildEntryGroup({ group: '200', duration: 0 })
      ],
      []
    )
    expect(result).toEqual({ hours: 4, clientCount: 1 })
  })

  it('rounds to quarter hours', () => {
    const result = aggregateOtherClients(
      [buildEntryGroup({ group: '100', duration: 0.3 * SECONDS_PER_HOUR })],
      []
    )
    expect(result.hours).toBe(0.25)
  })
})

describe('sumGroupHours', () => {
  it('returns 0 for empty input', () => {
    expect(sumGroupHours([])).toBe(0)
  })

  it('sums durations across groups', () => {
    expect(
      sumGroupHours([
        buildEntryGroup({ duration: 2 * SECONDS_PER_HOUR }),
        buildEntryGroup({ duration: 3 * SECONDS_PER_HOUR })
      ])
    ).toBe(5)
  })

  it('rounds to quarter hours', () => {
    expect(
      sumGroupHours([buildEntryGroup({ duration: 0.3 * SECONDS_PER_HOUR })])
    ).toBe(0.25)
  })

  it('treats missing duration as 0', () => {
    expect(
      sumGroupHours([
        buildEntryGroup({ duration: 4 * SECONDS_PER_HOUR }),
        buildEntryGroup({ duration: undefined as unknown as number })
      ])
    ).toBe(4)
  })
})
