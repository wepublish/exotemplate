/**
 * Configuration for the /networkContribution endpoint.
 *
 * IDs are pinned to the production Clockodo workspace — the same workspace is
 * shared across all environments, so hardcoding mirrors how
 * `JIRA_ISSUE_GROUP_ID` is handled in `../billing/aggregateHours.ts`.
 *
 * If we ever stand up a separate Clockodo workspace per environment, lift these
 * into env vars analogous to `BillingEnv`.
 */

// "We.Share" customer in Clockodo. All non-client-billable network work
// (we.shared stories, maintenance, fundraising, hosting, …) is logged here.
export const WESHARE_CLOCKODO_CUSTOMER_ID = '3428384'

// "We.Publish Foundation" customer — internal hours (finance, HR, fundraising,
// administration) logged by the cooperative itself rather than against any
// paying medium. Surfaced as its own dashboard tile.
export const WEPUBLISH_INTERNAL_CUSTOMER_ID = '3294915'

// Customers that don't represent paying media organizations and therefore
// don't count toward the "other clients" network total. We.share and
// we.publish are surfaced separately; One Test is a sandbox.
export const NETWORK_EXCLUDED_CUSTOMER_IDS: readonly string[] = [
  WESHARE_CLOCKODO_CUSTOMER_ID,
  WEPUBLISH_INTERNAL_CUSTOMER_ID,
  '4938992' // One Test
]

/**
 * Service-id buckets used to break down we.share hours on the dashboard.
 *
 * Discovered via `GET https://my.clockodo.com/api/v2/services` — only services
 * whose semantics match the user-facing buckets are included. Inactive legacy
 * hosting variants are kept so historical entries don't disappear from the
 * Hosting tile.
 *
 * Anything not in any bucket falls into the "other" tile so the buckets always
 * sum to the total we.share hours.
 */
export const WESHARE_SERVICE_BUCKETS = {
  acquisition: ['1100317'], // Acquisition
  engineering: [
    '1100315', // Engineering, Estimate and Refining Jira Issue
    '1100301', // Working on Jira Issue
    '1131824', // Deployment & Customer Review
    '1123538' // Working on Bugfix
  ],
  hosting: [
    '1100344' // Hosting
  ]
} as const

export type WeShareBucketKey = keyof typeof WESHARE_SERVICE_BUCKETS
