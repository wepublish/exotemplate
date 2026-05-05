import { format } from 'date-fns'
import { ManualWorkEntry, TopUp } from '../../DirectusTypes'

const JIRA_ISSUE_GROUP_ID = '1100301'
const BILLABLE_PART_WEP = 0.5
const SECONDS_PER_HOUR = 60 * 60

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

export interface JiraIssue {
  expand: string
  id: string
  self: string
  key: string
  fields: {
    customfield_10028: string
    /**
     * Live status of the Jira issue. We expose `statusCategory.key` because
     * Jira normalizes every workflow state into one of `new`, `indeterminate`,
     * or `done` — that's the most reliable signal that a ticket is finished
     * (covers "Done", "Cancelled", "Resolved", "Closed", etc.) regardless of
     * the team's custom workflow naming.
     */
    status?: {
      name: string
      statusCategory: {
        key: 'new' | 'indeterminate' | 'done'
        name: string
      }
    }
  }
}

export function computeEntryGroups(
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

  const totalManualWorkHours: number = roundToQuarter(
    manualWorkEntries.reduce(
      (sum: number, manualWork) =>
        sum + (parseFloat(String(manualWork.hours)) || 0),
      0
    )
  )
  const totalUsedHours = billableHours + totalManualWorkHours
  const totalAvailableHours = totalTopUps - totalUsedHours
  const totalUsedPercentage =
    Math.round((totalUsedHours * 100) / totalTopUps) || 0

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
      totalUsedPercentage:
        totalUsedPercentage === null ? 100 : totalUsedPercentage
    }
  }
}

export function computeTopUps(topUps: TopUp[]): TopUpComputed[] {
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

export function getBillableAndNonBillableHours(
  groups: EntryGroup[]
): Pick<Sums, 'billableHours' | 'nonBillableHours'> {
  let billableHours = 0
  let nonBillableHours = 0

  for (const entryGroup of groups) {
    billableHours +=
      entryGroup?.billability?.billableTotal || entryGroup.duration
    nonBillableHours += entryGroup?.billability?.billablePart || 0
  }
  return {
    billableHours: roundToQuarter(billableHours / SECONDS_PER_HOUR),
    nonBillableHours: roundToQuarter(nonBillableHours / SECONDS_PER_HOUR)
  }
}

export function decorateBillability(jiraGroup: EntryGroup): void {
  const aggregate: Billability = {
    durationJira: 0,
    durationPast: 0,
    jiraAvailable: 0,
    durationCurrent: 0,
    billableDirect: 0,
    billablePart: 0,
    billableTotal: 0
  }

  for (const issue of jiraGroup.sub_groups) {
    const durationJira =
      Number.parseFloat(issue.jiraIssue?.fields.customfield_10028 ?? '0') *
      SECONDS_PER_HOUR
    const durationCurrent = issue.duration || 0

    let billableDirect = 0
    let billablePart = 0
    let durationPast = 0
    let jiraAvailable = 0

    if (durationJira > 0) {
      durationPast = issue?.pastEntryGroup?.duration || 0
      jiraAvailable = durationJira - durationPast

      if (durationCurrent > jiraAvailable) {
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

    aggregate.durationJira += durationJira
    aggregate.durationPast += durationPast
    aggregate.jiraAvailable += jiraAvailable
    aggregate.durationCurrent += durationCurrent
    aggregate.billableDirect += billableDirect
    aggregate.billablePart += billablePart
    aggregate.billableTotal += billableTotal
  }

  jiraGroup.billability = aggregate
}

export function mergeSameJiraIssues(
  jiraGroup: EntryGroup,
  jiraPrefix: string
): void {
  const cleanSubGroups: EntryGroup[] = []

  for (const subGroup of jiraGroup.sub_groups) {
    const issueKey = getJiraIssue(subGroup.name, jiraPrefix)

    if (!issueKey) {
      console.warn(`No jira issue key found for jira subgroup ${subGroup.name}`)
      cleanSubGroups.push(subGroup)
      continue
    }

    const existing = cleanSubGroups.find(
      (cleanSubGroup) => cleanSubGroup.name === issueKey
    )
    if (existing) {
      existing.sub_groups.push(...subGroup.sub_groups)
      existing.duration += subGroup.duration
      existing.revenue += subGroup.revenue
    } else {
      subGroup.name = issueKey
      cleanSubGroups.push(subGroup)
    }
  }

  jiraGroup.sub_groups = cleanSubGroups
}

export function findJiraEntryGroup(
  entryGroups: EntryGroups
): EntryGroup | undefined {
  return entryGroups.groups.find((group) => group.group === JIRA_ISSUE_GROUP_ID)
}

export function getClockodoDateFormat(date: string | Date): string {
  return format(new Date(date), 'yyyy-MM-dd') + 'T00:00:00Z'
}

export function getJiraIssue(
  text: string | undefined,
  jiraPrefix: string
): string | undefined {
  return text?.match(new RegExp(`${jiraPrefix}-\\d+`))?.[0]
}

export function roundToQuarter(hours: number): number {
  return Math.round(hours / 0.25) * 0.25
}

export { JIRA_ISSUE_GROUP_ID, BILLABLE_PART_WEP, SECONDS_PER_HOUR }
