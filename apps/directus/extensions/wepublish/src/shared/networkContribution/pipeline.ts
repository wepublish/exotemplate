import { getGroupEntriesFromClockodo } from '../billing/clockodo'
import type { BillingEnv } from '../billing/env'
import {
  aggregateOtherClients,
  bucketWeShareServices,
  sumGroupHours,
  type NetworkContributionData
} from './aggregate'
import {
  NETWORK_EXCLUDED_CUSTOMER_IDS,
  WEPUBLISH_INTERNAL_CUSTOMER_ID,
  WESHARE_CLOCKODO_CUSTOMER_ID
} from './constants'

export interface NetworkContributionInput {
  from: Date
  to: Date
}

/**
 * Issues two parallel Clockodo queries:
 *  1. all entries grouped by `customers_id` → `services_id`, no filter. We
 *     locally slice out the we.share and we.publish-internal customer rows.
 *     Both need the same "no billable filter" treatment (we.share acquisition
 *     and we.publish finance/HR/fundraising are tracked as non-billable, so a
 *     `billable: 1` filter would silently drop them). Clockodo's
 *     `customers_id` filter only accepts a single ID — neither comma- nor
 *     array-form is allowed — so a single multi-customer query has to be
 *     unfiltered + locally sliced.
 *  2. all entries grouped by `customers_id` (`billable: 1`) → totals for the
 *     paying media that aren't surfaced separately. `billable: 1` reflects
 *     what actually shows up on those clients' bills, matching the
 *     aggregatedHours pipeline.
 */
export async function computeNetworkContribution(
  input: NetworkContributionInput,
  env: BillingEnv
): Promise<NetworkContributionData> {
  const [bucketingEntries, otherClientsEntries] = await Promise.all([
    getGroupEntriesFromClockodo(
      {
        from: input.from,
        to: input.to,
        grouping: ['customers_id', 'services_id'],
        filter: {}
      },
      env
    ),
    getGroupEntriesFromClockodo(
      {
        from: input.from,
        to: input.to,
        grouping: ['customers_id'],
        filter: { billable: 1 }
      },
      env
    )
  ])

  const weShareGroup = bucketingEntries.groups.find(
    (g) => g.group === WESHARE_CLOCKODO_CUSTOMER_ID
  )
  const wepublishInternalGroup = bucketingEntries.groups.find(
    (g) => g.group === WEPUBLISH_INTERNAL_CUSTOMER_ID
  )

  return {
    weShare: bucketWeShareServices(weShareGroup?.sub_groups ?? []),
    wepublishInternal: {
      hours: sumGroupHours(
        wepublishInternalGroup ? [wepublishInternalGroup] : []
      )
    },
    otherClients: aggregateOtherClients(
      otherClientsEntries.groups,
      NETWORK_EXCLUDED_CUSTOMER_IDS
    )
  }
}
