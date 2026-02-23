import { defineEndpoint } from '@directus/extensions-sdk'
import {
  createError,
  InvalidPayloadError,
  ForbiddenError,
  ContainsNullValuesError
} from '@directus/errors'
import axios from 'axios'
import { format } from 'date-fns'
import {
  Client,
  ClientPeriod,
  ManualWorkEntry,
  Period,
  TopUp
} from './DirectusTypes'

export interface EntryGroups {
  groups: EntryGroup[]
}

export interface EntryGroupComputed extends EntryGroups {
  sums: Sums
}

export interface Sums {
  billableHours: number
  nonBillableHours: number

  computedTopUps: TopUpComputed[]

  totalTopUps: number
  totalManualWorkHours: number
  totalUsedHours: number
  totalAvailableHours: number

  totalUsedPercentage: number
}

export interface TopUpComputed extends TopUp {
  paidHours: number
  clientHours: number
  wepHours: number
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
  sub_groups: EntryGroup[]

  // decorating entries
  jiraIssue?: JiraIssue
  pastEntryGroup?: EntryGroup
  billability?: Billability
}

export interface Billability {
  durationJira: number
  durationPast: number
  jiraAvailable: number
  durationCurrent: number
  billableDirect: number
  billablePart: number
  billableTotal: number
}

// response from jira api
export interface JiraIssue {
  expand: string
  id: string
  self: string
  key: string
  fields: {
    customfield_10028: string
  }
}

// https://docs.clockodo.com/#tag/EntryGroup
type ClockodoGrouping = (
  | 'billable'
  | 'customers_id'
  | 'day'
  | 'month'
  | 'is_lumpsum'
  | 'lumpsum_services_id'
  | 'projects_id'
  | 'services_id'
  | 'subprojects_id'
  | 'texts_id'
  | 'users_id'
  | 'week'
  | 'year'
)[]

interface ClockodoPrams {
  from: string | Date
  to: string | Date
  grouping?: ClockodoGrouping
  filter: {
    billable?: 0 | 1 | 2
    customers_id: string | number
    services_id?: string | number
  }
}

interface ValidatedEnv {
  clockodoApiEmail: string
  clockodoApiKey: string
  jiraEmail: string
  jiraApiKey: string
}

const JIRA_ISSUE_GROUP_ID = '1100301'
const MISSING_ENV_ERROR = createError('500', 'Missing env variables.')

export default defineEndpoint((router, context) => {
  router.get('/', async (_req: Request & any, res, next) => {
    try {
      const accountability = _req.accountability

      // check for user permission
      if (!accountability.user) {
        return next(new ForbiddenError())
      }

      // check for env variables
      const { services, getSchema, env } = context

      const clockodoApiEmail = env.CLOCKODO_API_EMAIL
      const clockodoApiKey = env.CLOCKODO_API_KEY
      const jiraEmail = env.JIRA_EMAIL
      const jiraApiKey = env.JIRA_API_KEY

      if (!clockodoApiEmail || !clockodoApiKey || !jiraEmail || !jiraApiKey) {
        return next(new MISSING_ENV_ERROR())
      }

      const validatedEnv = {
        clockodoApiEmail,
        clockodoApiKey,
        jiraEmail,
        jiraApiKey
      } as ValidatedEnv

      // check for query variables
      const clientPeriodId = _req.query?.clientPeriodId

      if (!clientPeriodId) {
        return next(
          new InvalidPayloadError({ reason: 'Missing param clientPeriodId' })
        )
      }

      // load client period table data
      const ItemsService = services.ItemsService
      const schema = await getSchema()

      const clientPeriodService = new ItemsService<ClientPeriod>(
        'Clients_Periods',
        { schema, accountability }
      )

      const {
        topUps,
        manualWorkEntries,
        Clients_id: client,
        Periods_id: period
      } = await clientPeriodService.readOne(clientPeriodId, {
        fields: [
          '*',
          'topUps.*',
          'manualWorkEntries.*',
          'Clients_id.*',
          'Periods_id.*'
        ]
      })

      if (!client || !period) {
        return next(
          new ContainsNullValuesError({
            collection: 'Clients_Periods',
            field: 'id'
          })
        )
      }

      const {
        jira_short_code: jiraPrefix,
        clockodo_customer_id: clockCustomerid
      } = client as Client
      const { from, to } = period as Period

      if (!clockCustomerid) {
        return next(
          new ContainsNullValuesError({
            collection: 'Client',
            field: 'clockodo_customer_id'
          })
        )
      }
      if (!jiraPrefix) {
        return next(
          new ContainsNullValuesError({
            collection: 'Client',
            field: 'jira_short_code'
          })
        )
      }

      // load basic data from clockodo within time period
      const entryGroupsWithinPeriod = await getGroupEntriesFromClockodo(
        {
          from: from,
          to: to,
          filter: {
            billable: 1,
            customers_id: clockCustomerid
          }
        },
        validatedEnv
      )

      // decorate jira issues from clockodo
      await groupAndDecorateJiraIssues(
        entryGroupsWithinPeriod,
        jiraPrefix,
        clockCustomerid,
        new Date(from),
        validatedEnv
      )

      const entryGroupComputed = computeEntryGroups(
        entryGroupsWithinPeriod,
        topUps as TopUp[],
        manualWorkEntries as ManualWorkEntry[]
      )

      return res.send(entryGroupComputed)
    } catch (e) {
      return next(e)
    }
  })
})

function computeEntryGroups(
  entryGroupsWithinPeriod: EntryGroups,
  topUps: TopUp[],
  manualWorkEntries: ManualWorkEntry[]
): EntryGroupComputed {
  const { billableHours, nonBillableHours } = getBillableAndNonBillableHours(
    entryGroupsWithinPeriod.groups
  )
  const computedTopUps = computeTopUps(topUps)
  const totalTopUps = computedTopUps.reduce(
    (sum, topUp) => sum + topUp.clientHours,
    0
  )
  const totalManualWorkHours = manualWorkEntries.reduce(
    (sum, manualWork) => sum + (manualWork.hours || 0),
    0
  )
  const totalUsedHours = billableHours + totalManualWorkHours
  const totalAvailableHours = totalTopUps - totalUsedHours
  const totalUsedPercentage = Math.round((totalUsedHours * 100) / totalTopUps)

  return {
    groups: entryGroupsWithinPeriod.groups,
    sums: {
      billableHours,
      nonBillableHours,
      computedTopUps,
      totalTopUps,
      totalManualWorkHours,
      totalUsedHours,
      totalAvailableHours,
      totalUsedPercentage
    }
  }
}

function computeTopUps(topUps: TopUp[]): TopUpComputed[] {
  return topUps.map((topUp) => {
    const paidHours =
      Math.round(((topUp.amount || 0) / topUp.hourlyRate) * 2) / 2

    const clientHours =
      Math.round(
        (paidHours * (100 - (topUp.wepPercentage || 0))) / 100 / 0.25
      ) * 0.25
    const wepHours = paidHours - clientHours
    return {
      ...topUp,
      paidHours,
      clientHours,
      wepHours
    }
  })
}

function getBillableAndNonBillableHours(
  groups: EntryGroup[]
): Pick<Sums, 'billableHours' | 'nonBillableHours'> {
  let billableHours = 0
  let nonBillableHours = 0

  for (let entryGroup of groups) {
    billableHours +=
      entryGroup?.billability?.billableTotal || entryGroup.duration
    nonBillableHours += entryGroup?.billability?.billablePart || 0
  }
  return {
    billableHours: roundToQuarter(billableHours / 3600),
    nonBillableHours: roundToQuarter(nonBillableHours / 3600)
  }
}

async function groupAndDecorateJiraIssues(
  groups: EntryGroups,
  jiraPrefix: string,
  clockodoCustomerId: string,
  timePeriodFrom: Date,
  env: ValidatedEnv
): Promise<void> {
  let jiraGroup = groups.groups.find(
    (group) => group.group === JIRA_ISSUE_GROUP_ID
  )

  if (!jiraGroup || !jiraGroup.sub_groups.length) {
    return
  }

  // merge same jira issues within the subgroups together. clean-up differently texted jira entries.
  mergeSameJiraIssues(jiraGroup, jiraPrefix)

  // decorate jira subgroups with estimated story points from jira
  await decorateWithJiraIssues(jiraGroup, jiraPrefix, env)

  // decorate jira subgroups with working hours delivered prior to the time period.
  await decorateWithPastEntries(
    jiraGroup,
    jiraPrefix,
    env,
    clockodoCustomerId,
    timePeriodFrom
  )

  // summarize and calculate the billability
  decorateBillability(jiraGroup)
}

function decorateBillability(jiraGroup: EntryGroup): void {
  const BILLABLE_PART_WEP = 0.5

  jiraGroup.billability = {
    durationJira: 0,
    durationPast: 0,
    jiraAvailable: 0,
    durationCurrent: 0,
    billableDirect: 0,
    billablePart: 0,
    billableTotal: 0
  }

  for (let issue of jiraGroup.sub_groups) {
    let billableDirect = 0
    let billablePart = 0

    const durationJira =
      Number.parseFloat(issue.jiraIssue?.fields.customfield_10028 ?? '0') *
      60 *
      60
    const durationCurrent = issue.duration || 0

    // only for jira calculations
    let durationPast = 0
    let jiraAvailable = 0

    // in case of estimations from Jira, we need to split exeed work to client and wep
    if (durationJira > 0) {
      durationPast = issue?.pastEntryGroup?.duration || 0

      // how many hours are available from jira
      jiraAvailable = durationJira - durationPast

      // if current work exeeds the available jira hours, split the hours on top
      if (durationCurrent > jiraAvailable) {
        // avoid negativ jira hours
        const minZeroJiraAvailable = Math.max(0, jiraAvailable)

        billableDirect = minZeroJiraAvailable
        billablePart =
          (durationCurrent - minZeroJiraAvailable) * BILLABLE_PART_WEP
      } else {
        billableDirect = durationCurrent
      }
    } else {
      billableDirect = durationCurrent
    }

    const billableTotal = billableDirect + billablePart

    issue.billability = {
      durationJira,
      durationPast,
      jiraAvailable,
      durationCurrent,
      billableDirect,
      billablePart,
      billableTotal
    }

    // sum-up for the entire jira group
    jiraGroup.billability.durationJira += durationJira
    jiraGroup.billability.durationPast += durationPast
    jiraGroup.billability.jiraAvailable += jiraAvailable
    jiraGroup.billability.durationCurrent += durationCurrent
    jiraGroup.billability.billableDirect += billableDirect
    jiraGroup.billability.billablePart += billablePart
    jiraGroup.billability.billableTotal += billableTotal
  }
}

/**
 * get past entries (1 year back) from clockodo
 * @param customerId
 * @param timePeriodFrom
 * @returns
 */
async function decorateWithPastEntries(
  jiraGroup: EntryGroup,
  jiraPrefix: string,
  env: ValidatedEnv,
  customerId: string,
  timePeriodFrom: Date
): Promise<void> {
  const from = new Date(
    new Date(timePeriodFrom).setMonth(timePeriodFrom.getMonth() - 12)
  )

  const pastEntries = (
    await getGroupEntriesFromClockodo(
      {
        from,
        to: timePeriodFrom,
        grouping: ['services_id', 'texts_id'],
        filter: {
          customers_id: customerId,
          services_id: JIRA_ISSUE_GROUP_ID
        }
      },
      env
    )
  ).groups?.[0]?.sub_groups

  if (!pastEntries) {
    return
  }

  for (let jiraIssue of jiraGroup.sub_groups) {
    const foundPastEntry = pastEntries.find(
      (pastEntry) =>
        pastEntry !== undefined &&
        getJiraIssue(pastEntry.name, jiraPrefix) === jiraIssue.name
    )

    if (foundPastEntry) {
      jiraIssue.pastEntryGroup = foundPastEntry
    }
  }
}

function mergeSameJiraIssues(jiraGroup: EntryGroup, jiraPrefix: string): void {
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
    const existing = cleanSubGroups.find(
      (cleanSubGroup) => cleanSubGroup.name === issueKey
    )
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
async function decorateWithJiraIssues(
  jiraGroup: EntryGroup,
  jiraPrefix: string,
  env: ValidatedEnv
): Promise<void> {
  const issueKeys = jiraGroup.sub_groups
    .map((subGroup) => subGroup.name)
    .filter((subGroup) => !!getJiraIssue(subGroup, jiraPrefix))

  const estimatesFromJira = await getEstimatesFromJira(issueKeys, env)

  // attach estimates
  for (let estimate of estimatesFromJira) {
    const existing = jiraGroup.sub_groups.find(
      (subGroup) => subGroup.name === estimate.key
    )
    if (!existing) {
      throw new Error(
        `Unexpected Error: Could not find jira key where it should exist. ${estimate.key}`
      )
    }

    // assign the estimate from jira api
    existing.jiraIssue = estimate
  }
}

async function getGroupEntriesFromClockodo(
  { from, to, grouping, filter }: ClockodoPrams,
  env: ValidatedEnv
): Promise<EntryGroups> {
  const time_since = getClockodoDateFormat(from)
  const time_until = getClockodoDateFormat(to)

  const params = {
    time_since,
    time_until,
    grouping:
      grouping || (['services_id', 'texts_id', 'day'] as ClockodoGrouping),
    round_to_minutes: 15,
    filter
  }

  return (
    await axios.get('https://my.clockodo.com/api/v2/entrygroups', {
      params,
      headers: {
        'X-Clockodo-External-Application': 'Inside We.Publish Nuxt Application',
        'X-ClockodoApiUser': env.clockodoApiEmail,
        'X-ClockodoApiKey': env.clockodoApiKey
      }
    })
  ).data
}

async function getEstimatesFromJira(
  issueKeys: string[],
  env: ValidatedEnv
): Promise<JiraIssue[]> {
  // do not request jira, if no issue keys.
  if (!issueKeys.length) {
    return []
  }

  // Default configuration - overwrite these or set in runtime config/.env
  const JIRA_DOMAIN = 'wepublish.atlassian.net'
  const email = env.jiraEmail
  const apiKey = env.jiraApiKey

  try {
    if (!email) {
      throw new Error('Email to access Jira is not configured!')
    }
    if (!apiKey) {
      throw new Error('API Key to access Jira is not configured!')
    }

    const jql = `key in (${issueKeys.join(', ')})`

    const response = await axios.get(
      `https://${JIRA_DOMAIN}/rest/api/3/search/jql`,
      {
        params: {
          jql,
          fields: 'key, customfield_10028'
        },
        auth: {
          username: email,
          password: apiKey
        },
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      }
    )

    if (!response.data.issues) {
      throw new Error('Missing jira issues in response.')
    }

    // some checks
    if (!response.data.issues.length) {
      throw new Error(`Empty response from Jira when it shouldn't.`)
    }

    if (!response.data.isLast) {
      throw new Error(
        'Response from Jira should contain isLast property in answer. Probably need implementation to fetch all Jira issue.'
      )
    }

    return response.data.issues as JiraIssue[]
  } catch (error: any) {
    const errorMessage =
      error?.response?.data ||
      error?.message ||
      'No error message provided in issues.ts'
    console.log(errorMessage)
    throw new Error(errorMessage)
  }
}

/**
 * Helper functions
 */
function getClockodoDateFormat(date: string | Date): string {
  return format(new Date(date), 'yyyy-MM-dd') + 'T00:00:00Z'
}

function getJiraIssue(
  text: string | undefined,
  jiraPrefix: string
): string | undefined {
  return text?.match(new RegExp(`${jiraPrefix}-\\d+`))?.[0]
}

function roundToQuarter(hours: number) {
  return Math.round(hours / 0.25) * 0.25
}
