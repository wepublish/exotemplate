import axios from 'axios'
import {format} from 'date-fns'

export interface EntryGroups {
  groups: EntryGroup[]
}

export interface EntryGroup {
  group: string
  grouped_by: string[]
  name: string
  revenue: number
  budget: number
  budget_is_hours: boolean
  budget_is_strict: boolean
  note: string
  hourly_rate: number
  billable: number
  billable_amount: number
  duration: number
  restrictions: string[]
  jiraIssue: JiraIssue
  sub_groups: EntryGroup[]
}

export interface EntryGroupParams {
  time_since: string
  time_until: string
  grouping: string[]
  round_to_minutes: number
  filter: {
    customers_id: number | string
    billable: 0 | 1 | 2
  }
}

// response from jira api
export interface JiraIssue {
  expand: string
  id: string
  self: string
  key: string,
  fields: {
    customfield_10028: string
  }
}


export default defineEventHandler(async (event): Promise<EntryGroup[]> => {
  try {
    // TODO: authenticate with directus or move it to directus

    const {customer_id: customerId, from, to, jira_prefix: jiraPrefix} = getQuery(event)

    if (!customerId || !from || !to || !jiraPrefix) {
      throw new Error('customerId, from, to or jiraPrefix param not provided!')
    }  

    const entryGroupsWithinPeriod = await getGroupEntriesWithinPeriod(from as string, to as string, customerId as string)

    await cleanAndDecorateJiraIssues(entryGroupsWithinPeriod, jiraPrefix as string)

    // decorated and cleand within object as of params by reference
    return entryGroupsWithinPeriod.groups
  } catch (error: any) {
    const errorMessage = JSON.stringify(error.response?.data || error.message)
    console.error(errorMessage)
    throw createError({
      statusCode: error.response?.status || 500,
      statusMessage: errorMessage,
      data: error.response?.data
    })
  }
})

async function cleanAndDecorateJiraIssues (groups: EntryGroups, jiraPrefix: string): Promise<void> {
  const JIRA_ISSUE_GROUP_ID = '1100301'
  
  let jiraGroup = groups.groups.find(group => group.group === JIRA_ISSUE_GROUP_ID)

  if (!jiraGroup || !jiraGroup.sub_groups.length) {
    return
  }

  // merge same jira issues within the subgroups together. clean-up differently texted jira entries.
  mergeSameJiraIssues(jiraGroup, jiraPrefix)

  // decorate jira subgroups with estimated story points from jira
  await decorateJiraIssues(jiraGroup, jiraPrefix)
}

async function decorateJiraIssues (jiraGroup: EntryGroup, jiraPrefix: string): Promise<void> {
  const issueKeys = jiraGroup.sub_groups
    .map(subGroup => subGroup.name)
    .filter(subGroup => !!getJiraIssue(subGroup, jiraPrefix))

  const estimatesFromJira = await getEstimatesFromJira(issueKeys)

  // attach estimates
  for (let estimate of estimatesFromJira) {
    const existing = jiraGroup.sub_groups.find(subGroup => subGroup.name === estimate.key)
    if (!existing) {
      throw new Error(`Unexpected Error: Could not find jira key where it should exist. ${estimate.key}`)
    }

    // assign the estimate from jira api
    existing.jiraIssue = estimate
  }
}

function mergeSameJiraIssues (jiraGroup: EntryGroup, jiraPrefix: string): void {
  const jiraSubGroups = jiraGroup.sub_groups
  const cleanSubGroups: EntryGroup[] = []

  for (let subGroup of jiraSubGroups) {
    const issueKey = getJiraIssue(subGroup.name, jiraPrefix)

    if (!issueKey) {
      console.warn(`No jira issue key found for jira subgroup ${subGroup.name}`)
      cleanSubGroups.push(subGroup)
      continue
    }

    // eventually merge of the same jira issues
    const existing = cleanSubGroups.find(cleanSubGroup => cleanSubGroup.name === issueKey)
    if (existing) {
      // merge if same jira issue key
      existing.sub_groups.push(...subGroup.sub_groups)
      // merge duration & revenue
      existing.duration += subGroup.duration
      existing.revenue += subGroup.revenue
    } else {
      subGroup.name = issueKey
      cleanSubGroups.push(subGroup)
    }
  }

  // replace with clean subgroups
  jiraGroup.sub_groups = cleanSubGroups
}

function getJiraIssue (text: string | undefined, jiraPrefix: string): string | undefined {
  return text?.match(new RegExp(`${jiraPrefix}-\\d+`))?.[0]
}

async function getEstimatesFromJira (issueKeys: string[]): Promise<JiraIssue[]> {
  // do not request jira, if no issue keys.
  if (!issueKeys.length) {
    return []
  }

  const config = useRuntimeConfig()

  // Default configuration - overwrite these or set in runtime config/.env
  const JIRA_DOMAIN = 'wepublish.atlassian.net'
  const email = config.jiraEmail
  const apiKey = config.jiraApiKey

  try {
    if (!email) {
      throw new Error('Email to access Jira is not configured!')
    }
    if (!apiKey) {
      throw new Error('API Key to access Jira is not configured!')
    }

    const jql = `key in (${issueKeys.join(', ')})`

    const response = await axios.get(`https://${JIRA_DOMAIN}/rest/api/3/search/jql`, {
      params: {
        jql,
        fields: 'key, customfield_10028'
      },
      auth: {
        username: email,
        password: apiKey
      },
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    })

    if (!response.data.issues) {
      throw new Error('Missing jira issues in response.')
    }

    // some checks
    if (!response.data.issues.length) {
      throw new Error(`Empty response from Jira when it shouldn't.`)
    }

    if (!response.data.isLast) {
      throw new Error('Response from Jira should contain isLast property in answer. Probably need implementation to fetch all Jira issue.')
    }

    return response.data.issues as JiraIssue[]
  } catch (error: any) {
    const errorMessage = error?.response?.data || error?.message || 'No error message provided in issues.ts'
    console.log(errorMessage)
    throw createError({
      statusCode: error.response?.status || 500,
      statusMessage: errorMessage,
      data: error.response?.data
    })
  }
}

async function getGroupEntriesWithinPeriod (from: string | Date, to: string | Date, customerId: string | number): Promise<EntryGroups> {
  const config = useRuntimeConfig()
  const timeSince = getClockodoDateFormat(from)
  const timeUntil = getClockodoDateFormat(to)

  const params = {
    time_since: timeSince,
    time_until: timeUntil,
    grouping: ['services_id', 'texts_id', 'day'],
    round_to_minutes: 15,
    filter: {
      customers_id: customerId,
      billable: 2
    }
  }


  return (await axios.get('https://my.clockodo.com/api/v2/entrygroups', {
    params,
    headers: {
    'X-Clockodo-External-Application': 'Inside We.Publish Nuxt Application',
    'X-ClockodoApiUser': config.clockodoApiEmail,
    'X-ClockodoApiKey': config.clockodoApiKey,
    }
  })).data
}

function getClockodoDateFormat (date: string | Date): string {
  return format(new Date(date), 'yyyy-MM-dd') + 'T00:00:00Z'
}