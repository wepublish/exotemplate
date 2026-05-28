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
