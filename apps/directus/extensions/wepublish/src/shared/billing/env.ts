export interface BillingEnv {
  clockodoApiEmail: string
  clockodoApiKey: string
  jiraEmail: string
  jiraApiKey: string
}

export function readBillingEnv(env: Record<string, unknown>): BillingEnv {
  const clockodoApiEmail = env.CLOCKODO_API_EMAIL as string | undefined
  const clockodoApiKey = env.CLOCKODO_API_KEY as string | undefined
  const jiraEmail = env.JIRA_EMAIL as string | undefined
  const jiraApiKey = env.JIRA_API_KEY as string | undefined

  if (!clockodoApiEmail || !clockodoApiKey || !jiraEmail || !jiraApiKey) {
    throw new Error(
      'Missing billing env variables (CLOCKODO_API_EMAIL, CLOCKODO_API_KEY, JIRA_EMAIL, JIRA_API_KEY).'
    )
  }

  return { clockodoApiEmail, clockodoApiKey, jiraEmail, jiraApiKey }
}
