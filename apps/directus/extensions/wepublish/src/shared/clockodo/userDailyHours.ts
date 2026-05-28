import axios from 'axios'
import type { BillingEnv } from '../billing/env'
import { getClockodoDateFormat } from '../billing/aggregateHours'
import { clockodoHeaders } from './headers'

const SECONDS_PER_HOUR = 60 * 60

export interface UserDailyHours {
  usersId: number
  day: string
  hours: number
}

/**
 * Subset of a single node in Clockodo's `/v2/entrygroups` response. The
 * canonical shape (with all fields) lives in `shared/billing/aggregateHours.ts`
 * — we redeclare just the bits we read here to keep the BI wrapper decoupled.
 *
 * Two field names matter and bit me once: Clockodo uses **snake_case**
 * (`sub_groups`, not `subGroups`) and reports work as **seconds** in
 * `duration`, not hours in any field named `hours`. Mixing those up silently
 * returns 0 for every user/day pair.
 */
interface EntryGroupRow {
  group: string
  name?: string
  duration?: number
  sub_groups?: EntryGroupRow[]
}

interface EntryGroupsResponse {
  groups: EntryGroupRow[]
}

/**
 * Fetch per-user, per-day captured hours across the workspace for a date
 * range. Used by the BI "missing hours" surface and the daily reminder — both
 * want raw "who logged what when", independent of which customer was billed.
 */
export async function getClockodoUserDailyHours(
  env: BillingEnv,
  from: Date | string,
  to: Date | string
): Promise<UserDailyHours[]> {
  const response = await axios.get<EntryGroupsResponse>(
    'https://my.clockodo.com/api/v2/entrygroups',
    {
      headers: clockodoHeaders(env),
      params: {
        time_since: getClockodoDateFormat(from),
        // Clockodo's `time_until` is a timestamp, not a calendar-day cutoff.
        // The shared formatter produces midnight UTC, so passing `to` as-is
        // excludes everything logged later that same day. Advance by one day
        // so the entire `to` day is included.
        time_until: getClockodoDateFormat(addOneDay(to)),
        grouping: ['users_id', 'day'],
        round_to_minutes: 15
      }
    }
  )

  return flattenUserDailyGroups(response.data.groups ?? [])
}

function addOneDay(date: Date | string): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + 1)
  return d
}

/**
 * Clockodo's `entrygroups` response is a tree: the outer level is the first
 * `grouping` axis (`users_id`), each carrying nested `sub_groups` for the
 * next axis (`day`). Each group reports its captured time as `duration` in
 * **seconds** — converted to hours here so callers don't need to know.
 *
 * Exported so it can be unit-tested independently of the HTTP call.
 */
export function flattenUserDailyGroups(
  groups: EntryGroupRow[]
): UserDailyHours[] {
  const result: UserDailyHours[] = []
  for (const userGroup of groups) {
    const usersId = Number(userGroup.group)
    if (!Number.isFinite(usersId)) continue

    const dayGroups = userGroup.sub_groups ?? []
    for (const day of dayGroups) {
      const date = day.group
      if (!date) continue
      const durationSeconds = day.duration ?? 0
      const hours = durationSeconds / SECONDS_PER_HOUR
      result.push({ usersId, day: date, hours })
    }
  }
  return result
}
