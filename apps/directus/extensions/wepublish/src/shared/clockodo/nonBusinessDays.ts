import axios from 'axios'
import type { BillingEnv } from '../billing/env'
import { clockodoHeaders } from './headers'

/**
 * One public-holiday entry, normalised from Clockodo's v2
 * `/api/v2/nonbusinessDays` payload into the shape the BI layer consumes.
 *
 * `nonbusinessgroups_id` is the calendar group; each user's group (from
 * `/api/v3/users`) decides which calendar applies. `half_day` = 1 means a
 * half-day holiday (e.g. Christmas Eve afternoon) — the BI layer halves the
 * expected hours instead of marking the whole day off.
 */
export interface ClockodoNonBusinessDay {
  id: number
  date: string
  name: string
  half_day: number
  nonbusinessgroups_id: number
}

/**
 * Raw v2 row. v2 renamed several fields vs. the old v1 surface: the resolved
 * date for the requested year is `evaluated_date` (was `date`), `half_day` is
 * a boolean (was 0/1), and the calendar group is `nonbusiness_group_id` (was
 * `nonbusinessgroups_id`). We map them all back below.
 */
interface ClockodoNonBusinessDayV2 {
  id: number
  name: string
  half_day: boolean
  nonbusiness_group_id: number
  evaluated_date: string
}

interface ClockodoNonBusinessDaysResponse {
  data: ClockodoNonBusinessDayV2[]
}

/**
 * Fetch the configured non-business days (public holidays + company-defined
 * closures) for a given year from Clockodo's v2 endpoint
 * (`/api/v2/nonbusinessDays`). The legacy `/api/nonbusinessdays` was removed
 * on 2026-05-01; v2 returns rows under `data` and uses the renamed fields
 * mapped back to the legacy names the BI layer expects.
 *
 * Year is required by the API. Multi-year ranges fan out into N requests at
 * the caller — same pattern as absences.
 */
export async function getClockodoNonBusinessDays(
  env: BillingEnv,
  year: number
): Promise<ClockodoNonBusinessDay[]> {
  const response = await axios.get<ClockodoNonBusinessDaysResponse>(
    'https://my.clockodo.com/api/v2/nonbusinessDays',
    {
      headers: clockodoHeaders(env),
      params: { year }
    }
  )
  return (response.data.data ?? []).map((d) => ({
    id: d.id,
    date: d.evaluated_date,
    name: d.name,
    half_day: d.half_day ? 1 : 0,
    nonbusinessgroups_id: d.nonbusiness_group_id
  }))
}
