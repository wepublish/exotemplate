import axios from 'axios'
import type { BillingEnv } from '../billing/env'
import { clockodoHeaders } from './headers'

/**
 * One row from Clockodo's `/api/targethours/` endpoint. Each user can have
 * multiple rows over time (date-bounded contracts), so the BI logic looks up
 * the row that covers the date in question rather than just taking "the user's
 * target".
 *
 * Two shapes share this interface:
 *   - `type: 'weekly'` carries per-weekday hour fields (`monday`..`sunday`)
 *     plus `compensation_daily`.
 *   - `type: 'monthly'` carries `monthly_target` plus per-weekday workday
 *     booleans. We approximate the daily expected from `monthly_target` for
 *     monthly contracts since per-weekday hours aren't on the row.
 *
 * Note: the endpoint lives on Clockodo's v1 surface (`/api/targethours/`),
 * unlike the `/api/v2/*` calls used elsewhere — v2 doesn't have an equivalent.
 */
export interface ClockodoTargetHourRow {
  id: number
  users_id: number
  type: 'weekly' | 'monthly'
  date_since: string
  date_until: string | null
  compensation_monthly?: number | null
  compensation_daily?: number | null
  // Weekly-type fields
  monday?: number | null
  tuesday?: number | null
  wednesday?: number | null
  thursday?: number | null
  friday?: number | null
  saturday?: number | null
  sunday?: number | null
  absence_fixed_credit?: boolean | null
  // Monthly-type fields
  monthly_target?: number | null
  monday_is_workday?: boolean | null
  tuesday_is_workday?: boolean | null
  wednesday_is_workday?: boolean | null
  thursday_is_workday?: boolean | null
  friday_is_workday?: boolean | null
  saturday_is_workday?: boolean | null
  sunday_is_workday?: boolean | null
}

interface ClockodoTargetHoursResponse {
  targethours: ClockodoTargetHourRow[]
}

export async function getClockodoTargetHours(
  env: BillingEnv
): Promise<ClockodoTargetHourRow[]> {
  const response = await axios.get<ClockodoTargetHoursResponse>(
    'https://my.clockodo.com/api/targethours/',
    { headers: clockodoHeaders(env) }
  )
  return response.data.targethours ?? []
}
