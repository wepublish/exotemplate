import type { TopUp } from './DirectusTypes'

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
