import axios from 'axios'
import type { BillingEnv } from './env'
import type { JiraIssue } from './aggregateHours'

const JIRA_DOMAIN = 'wepublish.atlassian.net'

export interface JiraAssignee {
  email: string | null
  displayName: string | null
  accountId: string | null
}

/**
 * Fetches the assignee of a Jira issue. Returns `null` when the issue has no
 * assignee, the issue cannot be found, or the credentials don't allow reading
 * it. Errors are logged but never thrown — the calling halt hook treats a
 * missing assignee as "skip the personal DM, the channel post still goes out".
 */
export async function getJiraIssueAssignee(
  issueKey: string,
  env: Pick<BillingEnv, 'jiraEmail' | 'jiraApiKey'>
): Promise<JiraAssignee | null> {
  if (!issueKey) return null
  try {
    const response = await axios.get(
      `https://${JIRA_DOMAIN}/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
      {
        params: { fields: 'assignee' },
        auth: { username: env.jiraEmail, password: env.jiraApiKey },
        headers: { Accept: 'application/json' }
      }
    )
    const assignee = response.data?.fields?.assignee
    if (!assignee) return null
    return {
      email: assignee.emailAddress ?? null,
      displayName: assignee.displayName ?? null,
      accountId: assignee.accountId ?? null
    }
  } catch (error: unknown) {
    console.error(
      `[jira] failed to fetch assignee for ${issueKey}: ${extractErrorMessage(error)}`
    )
    return null
  }
}

export async function getEstimatesFromJira(
  issueKeys: string[],
  env: BillingEnv
): Promise<JiraIssue[]> {
  if (!issueKeys.length) {
    return []
  }

  const jql = `key in (${issueKeys.join(', ')})`

  try {
    const response = await axios.get(
      `https://${JIRA_DOMAIN}/rest/api/3/search/jql`,
      {
        params: { jql, fields: 'key, customfield_10028, status' },
        auth: { username: env.jiraEmail, password: env.jiraApiKey },
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      }
    )

    if (!response.data.issues) {
      throw new Error('Missing jira issues in response.')
    }
    if (!response.data.issues.length) {
      throw new Error(`Empty response from Jira when it shouldn't.`)
    }
    if (!response.data.isLast) {
      throw new Error(
        'Response from Jira should contain isLast property in answer. Probably need implementation to fetch all Jira issue.'
      )
    }

    return response.data.issues as JiraIssue[]
  } catch (error: unknown) {
    const message = extractErrorMessage(error)
    console.log(message)
    throw new Error(message)
  }
}

function extractErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as { response?: { data?: unknown } }).response?.data !==
      'undefined'
  ) {
    const data = (error as { response: { data: unknown } }).response.data
    return typeof data === 'string' ? data : JSON.stringify(data)
  }
  if (error instanceof Error) {
    return error.message
  }
  return 'No error message provided.'
}
