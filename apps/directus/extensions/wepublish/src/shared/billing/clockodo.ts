import axios from 'axios'
import type { BillingEnv } from './env'
import { type EntryGroups, getClockodoDateFormat } from './aggregateHours'

export type ClockodoGrouping = (
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

export interface ClockodoParams {
  from: string | Date
  to: string | Date
  grouping?: ClockodoGrouping
  filter: {
    billable?: 0 | 1 | 2
    customers_id: string | number
    services_id?: string | number
  }
}

const DEFAULT_GROUPING: ClockodoGrouping = ['services_id', 'texts_id', 'day']

export async function getGroupEntriesFromClockodo(
  { from, to, grouping, filter }: ClockodoParams,
  env: BillingEnv
): Promise<EntryGroups> {
  const response = await axios.get<EntryGroups>(
    'https://my.clockodo.com/api/v2/entrygroups',
    {
      params: {
        time_since: getClockodoDateFormat(from),
        time_until: getClockodoDateFormat(to),
        grouping: grouping || DEFAULT_GROUPING,
        round_to_minutes: 15,
        filter
      },
      headers: {
        'X-Clockodo-External-Application': 'Inside We.Publish Nuxt Application',
        'X-ClockodoApiUser': env.clockodoApiEmail,
        'X-ClockodoApiKey': env.clockodoApiKey
      }
    }
  )

  return response.data
}
