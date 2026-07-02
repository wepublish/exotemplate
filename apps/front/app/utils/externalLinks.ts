// Deep links into the external services used during client onboarding. Keep
// the composition in one place so future host changes only need to be made
// once.

export function composeJiraProjectUrl(
  projectKey: string | null | undefined
): string {
  if (!projectKey) return 'https://wepublish.atlassian.net'
  return `https://wepublish.atlassian.net/browse/${encodeURIComponent(
    projectKey
  )}`
}

export function composeJiraIssueUrl(
  issueKey: string | null | undefined
): string {
  if (!issueKey) return 'https://wepublish.atlassian.net'
  return `https://wepublish.atlassian.net/browse/${encodeURIComponent(
    issueKey
  )}`
}

export function composeBexioContactUrl(
  contactId: number | string | null | undefined
): string {
  if (!contactId) return 'https://office.bexio.com/index.php/kontakt/list'
  return `https://office.bexio.com/index.php/kontakt/show/id/${encodeURIComponent(
    String(contactId)
  )}`
}

export function composeClockodoCustomerUrl(
  customerId: number | string | null | undefined
): string {
  if (!customerId) return 'https://my.clockodo.com'
  return `https://my.clockodo.com/en/customers/${encodeURIComponent(
    String(customerId)
  )}`
}

/** Public We.Publish documentation — same for every client. */
export const WEPUBLISH_DOCS_URL = 'https://docs.wepublish.ch/'

/**
 * Parse a We.Publish API host into its `api` separator and the rest of the host.
 * The infrastructure stores the API host in two shapes — both seen in prod:
 *   - `api-<medium>.wepublish.cloud`  (hyphen, the canonical/current form)
 *   - `api.<medium>.wepublish.cloud`  (dot, legacy media predating the hyphen form)
 * Strips the scheme and any path (`/v1`) first. Returns `{ separator, rest }`
 * where `rest` is `<medium>.wepublish.cloud`, so the editor/website URLs can be
 * derived while **preserving the same separator** as the API host. Null when the
 * value is empty or doesn't match the expected `api[.-]…wepublish.cloud` shape.
 */
function parseApiHost(
  apiUrl: string | null | undefined
): { separator: string; rest: string } | null {
  if (!apiUrl) return null
  const host = apiUrl
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
  const match = host?.match(/^api([.-])(.+\.wepublish\.cloud)$/i)
  if (!match) return null
  return { separator: match[1], rest: match[2] }
}

/**
 * Recover the medium slug from `apiUrl` (handles both the `api.` and `api-`
 * host forms). Returns null when `apiUrl` is empty or doesn't match.
 */
export function parseMediumFromApiUrl(
  apiUrl: string | null | undefined
): string | null {
  const parsed = parseApiHost(apiUrl)
  if (!parsed) return null
  return parsed.rest.replace(/\.wepublish\.cloud$/i, '') || null
}

/**
 * Editor link for the dashboard. An explicit `override` wins; otherwise the URL
 * is derived from `apiUrl` by swapping the `api` prefix for `editor` (keeping the
 * same separator, e.g. `api-bajour…` → `editor-bajour…`). Returns null when
 * neither is available so the caller can hide the link.
 */
export function composeEditorUrl(
  apiUrl: string | null | undefined,
  override?: string | null
): string | null {
  if (override) return override
  const parsed = parseApiHost(apiUrl)
  return parsed ? `https://editor${parsed.separator}${parsed.rest}` : null
}

/**
 * Website link for the dashboard. An explicit `override` wins; otherwise the URL
 * is derived from `apiUrl` by dropping the `api` prefix segment
 * (`<medium>.wepublish.cloud`). Returns null when neither is available so the
 * caller can hide the link.
 */
export function composeWebsiteUrl(
  apiUrl: string | null | undefined,
  override?: string | null
): string | null {
  if (override) return override
  const parsed = parseApiHost(apiUrl)
  return parsed ? `https://${parsed.rest}` : null
}
