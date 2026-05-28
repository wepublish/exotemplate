import axios from 'axios'
import type { BillingEnv } from '../billing/env'
import { clockodoHeaders } from './headers'

/**
 * Clockodo absence types (id values, documented at
 * https://www.clockodo.com/en/api/absences/). We surface the numeric code as
 * `type` and let the BI layer translate to user-facing strings.
 *
 * Status `1` ("approved") is the only one that counts as a real absence for
 * the BI dashboard. Requested / rejected / cancelled rows are ignored so
 * someone with a still-pending vacation request isn't excused from capturing.
 */
export interface ClockodoAbsence {
  id: number
  users_id: number
  date_since: string
  date_until: string
  type: number
  status: number
}

interface ClockodoAbsencesResponse {
  absences: Array<{
    id: number
    users_id: number
    date_since: string
    date_until: string
    type: number
    status: number
  }>
}

export const CLOCKODO_ABSENCE_STATUS_APPROVED = 1

/**
 * Fetch all absences for a given year. Clockodo's v2 endpoint requires the
 * `year` parameter — multi-year ranges fan out into N requests at the caller.
 */
export async function getClockodoAbsences(
  env: BillingEnv,
  year: number
): Promise<ClockodoAbsence[]> {
  const response = await axios.get<ClockodoAbsencesResponse>(
    'https://my.clockodo.com/api/v2/absences',
    {
      headers: clockodoHeaders(env),
      params: { year }
    }
  )

  return response.data.absences
}
