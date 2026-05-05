import type { EntryGroup } from '../billing/aggregateHours'
import { SECONDS_PER_HOUR, roundToQuarter } from '../billing/aggregateHours'
import { WESHARE_SERVICE_BUCKETS, type WeShareBucketKey } from './constants'

export interface WeShareBreakdown {
  acquisition: number
  engineering: number
  hosting: number
  /** Hours logged on we.share against services not in any named bucket. */
  other: number
  total: number
}

export interface OtherClientsBreakdown {
  hours: number
  /** Number of distinct non-excluded customers with hours > 0 in the period. */
  clientCount: number
}

export interface WepublishInternalBreakdown {
  hours: number
}

export interface NetworkContributionData {
  weShare: WeShareBreakdown
  wepublishInternal: WepublishInternalBreakdown
  otherClients: OtherClientsBreakdown
}

/**
 * Buckets we.share entry groups (grouped by services_id) into the three
 * dashboard categories plus an "other" catch-all so the four numbers always
 * sum to the total we.share duration.
 */
export function bucketWeShareServices(
  serviceGroups: EntryGroup[]
): WeShareBreakdown {
  const totals: Record<WeShareBucketKey | 'other', number> = {
    acquisition: 0,
    engineering: 0,
    hosting: 0,
    other: 0
  }
  let totalSeconds = 0

  for (const group of serviceGroups) {
    const seconds = group.duration || 0
    totalSeconds += seconds

    const bucket = findBucketForServiceId(group.group)
    if (bucket) {
      totals[bucket] += seconds
    } else {
      totals.other += seconds
    }
  }

  return {
    acquisition: roundToQuarter(totals.acquisition / SECONDS_PER_HOUR),
    engineering: roundToQuarter(totals.engineering / SECONDS_PER_HOUR),
    hosting: roundToQuarter(totals.hosting / SECONDS_PER_HOUR),
    other: roundToQuarter(totals.other / SECONDS_PER_HOUR),
    total: roundToQuarter(totalSeconds / SECONDS_PER_HOUR)
  }
}

function findBucketForServiceId(
  serviceId: string
): WeShareBucketKey | undefined {
  for (const [bucket, ids] of Object.entries(WESHARE_SERVICE_BUCKETS) as [
    WeShareBucketKey,
    readonly string[]
  ][]) {
    if (ids.includes(serviceId)) return bucket
  }
  return undefined
}

/**
 * Sums all entry-group durations into a single hours figure (rounded to
 * quarter hours). Used for the we.publish-internal tile, where the input is
 * either pre-filtered to a single customer or grouped by customer.
 */
export function sumGroupHours(groups: EntryGroup[]): number {
  let totalSeconds = 0
  for (const group of groups) {
    totalSeconds += group.duration || 0
  }
  return roundToQuarter(totalSeconds / SECONDS_PER_HOUR)
}

/**
 * Sums hours for all customers except the configured exclusions.
 * `customerGroups` is the result of grouping Clockodo entries by customers_id.
 */
export function aggregateOtherClients(
  customerGroups: EntryGroup[],
  excludedCustomerIds: readonly string[]
): OtherClientsBreakdown {
  const excluded = new Set(excludedCustomerIds)
  let totalSeconds = 0
  let clientCount = 0

  for (const group of customerGroups) {
    if (excluded.has(group.group)) continue
    const seconds = group.duration || 0
    if (seconds <= 0) continue
    totalSeconds += seconds
    clientCount += 1
  }

  return {
    hours: roundToQuarter(totalSeconds / SECONDS_PER_HOUR),
    clientCount
  }
}
