import { createError } from '@directus/errors'
import type { ManualWorkEntry, TopUp } from '../../DirectusTypes'
import {
  JIRA_ISSUE_GROUP_ID,
  computeEntryGroups,
  decorateBillability,
  findJiraEntryGroup,
  getJiraIssue,
  mergeSameJiraIssues,
  type EntryGroup,
  type EntryGroupComputed,
  type EntryGroups
} from './aggregateHours'
import { getGroupEntriesFromClockodo } from './clockodo'
import { getEstimatesFromJira } from './jira'
import type { BillingEnv } from './env'

export interface ClientPeriodBillingInput {
  clockodoCustomerId: string
  jiraPrefix: string
  from: Date
  to: Date
  topUps: TopUp[]
  manualWorkEntries: ManualWorkEntry[]
}

export function movedJiraIssueError(message: string): Error {
  const ErrorClass = createError('MOVED_JIRA_ISSUE', message, 500)
  return new ErrorClass()
}

/**
 * Fetches Clockodo entries for the given period, decorates the Jira group with
 * issue estimates and past entries, and returns the computed billability.
 */
export async function computeClientPeriodBilling(
  input: ClientPeriodBillingInput,
  env: BillingEnv
): Promise<EntryGroupComputed> {
  const entryGroupsWithinPeriod = await getGroupEntriesFromClockodo(
    {
      from: input.from,
      to: input.to,
      filter: { billable: 1, customers_id: input.clockodoCustomerId }
    },
    env
  )

  await decorateJiraEntries(entryGroupsWithinPeriod, {
    jiraPrefix: input.jiraPrefix,
    clockodoCustomerId: input.clockodoCustomerId,
    periodFrom: input.from,
    env
  })

  return computeEntryGroups(
    entryGroupsWithinPeriod,
    input.topUps,
    input.manualWorkEntries
  )
}

interface DecorateContext {
  jiraPrefix: string
  clockodoCustomerId: string
  periodFrom: Date
  env: BillingEnv
}

async function decorateJiraEntries(
  entryGroups: EntryGroups,
  ctx: DecorateContext
): Promise<void> {
  const jiraGroup = findJiraEntryGroup(entryGroups)
  if (!jiraGroup || !jiraGroup.sub_groups.length) {
    return
  }

  mergeSameJiraIssues(jiraGroup, ctx.jiraPrefix)
  await attachJiraEstimates(jiraGroup, ctx.jiraPrefix, ctx.env)
  await attachPastEntries(jiraGroup, ctx)
  decorateBillability(jiraGroup)
}

async function attachJiraEstimates(
  jiraGroup: EntryGroup,
  jiraPrefix: string,
  env: BillingEnv
): Promise<void> {
  const issueKeys = jiraGroup.sub_groups
    .map((subGroup) => subGroup.name)
    .filter((name) => !!getJiraIssue(name, jiraPrefix))

  const estimates = await getEstimatesFromJira(issueKeys, env)

  for (const estimate of estimates) {
    const existing = jiraGroup.sub_groups.find(
      (subGroup) => subGroup.name === estimate.key
    )
    if (!existing) {
      throw movedJiraIssueError(
        `Could not find jira key ${estimate.key}. The jira issue was probably moved into another project. Rename it on Clockodo.`
      )
    }
    existing.jiraIssue = estimate
  }
}

async function attachPastEntries(
  jiraGroup: EntryGroup,
  ctx: DecorateContext
): Promise<void> {
  const from = new Date(ctx.periodFrom)
  from.setMonth(from.getMonth() - 12)

  const pastEntries = (
    await getGroupEntriesFromClockodo(
      {
        from,
        to: ctx.periodFrom,
        grouping: ['services_id', 'texts_id'],
        filter: {
          customers_id: ctx.clockodoCustomerId,
          services_id: JIRA_ISSUE_GROUP_ID
        }
      },
      ctx.env
    )
  ).groups?.[0]?.sub_groups

  if (!pastEntries) {
    return
  }

  for (const issue of jiraGroup.sub_groups) {
    const foundPastEntry = pastEntries.find(
      (pastEntry) =>
        pastEntry !== undefined &&
        getJiraIssue(pastEntry.name, ctx.jiraPrefix) === issue.name
    )
    if (foundPastEntry) {
      issue.pastEntryGroup = foundPastEntry
    }
  }
}
