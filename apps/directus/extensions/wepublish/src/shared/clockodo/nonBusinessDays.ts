import axios from 'axios'
import type { BillingEnv } from '../billing/env'
import { clockodoHeaders } from './headers'

/**
 * One public-holiday entry from Clockodo's `/api/nonbusinessdays/` endpoint.
 *
 * `nonbusinessgroups_id` is the calendar group; each user's
 * `nonbusinessgroups_id` (from `/v2/users`) decides which calendar applies.
 * `half_day` = 1 means a half-day holiday (e.g. Christmas Eve afternoon) —
 * the BI layer halves the expected hours instead of marking the whole day off.
 */
export interface ClockodoNonBusinessDay {
  id: number
  date: string
  name: string
  half_day: number
  nonbusinessgroups_id: number
}

interface ClockodoNonBusinessDaysResponse {
  nonbusinessdays: ClockodoNonBusinessDay[]
}

/**
 * Fetch the configured non-business days (public holidays + company-defined
 * closures) for a given year. Clockodo's endpoint sits on the v1 surface
 * (`/api/nonbusinessdays/`), not v2.
 *
 * Year is required by the API. Multi-year ranges fan out into N requests at
 * the caller — same pattern as absences.
 */
export async function getClockodoNonBusinessDays(
  env: BillingEnv,
  year: number
): Promise<ClockodoNonBusinessDay[]> {
  const response = await axios.get<ClockodoNonBusinessDaysResponse>(
    'https://my.clockodo.com/api/nonbusinessdays/',
    {
      headers: clockodoHeaders(env),
      params: { year }
    }
  )
  return response.data.nonbusinessdays ?? []
}
