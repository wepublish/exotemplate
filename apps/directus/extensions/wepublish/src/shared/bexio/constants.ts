/**
 * Bexio organisation-level constants shared across invoice / order creation.
 *
 * These mirror the magic numbers that have lived in `invoice-with-topup` since
 * the first Bexio integration. They're hardcoded because Bexio is shared across
 * environments (same precedent as `JIRA_ISSUE_GROUP_ID` / the network-contribution
 * pinned IDs). Lift to env vars only if we ever fan out per-environment Bexio orgs.
 */

// https://office.bexio.com/user_manager/editRights/id/1
export const BEXIO_USER_ID = 1
// Tax code for 8.1% Swiss VAT.
export const BEXIO_MWST_ID = 47
export const BEXIO_UNIT_ID = 2
// Ertrag Dienstleistungen (account_no 3400)
export const BEXIO_ACCOUNT_ID = 150

export const BEXIO_API_BASE_URL = 'https://api.bexio.com'
