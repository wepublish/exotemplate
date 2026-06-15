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

/**
 * v4 absence row. Fields we read carry the same names as the old v2 payload;
 * `type` is only present when the API key has absence-administration rights
 * (the integration key does), so it's optional defensively.
 */
interface ClockodoAbsenceV4 {
  id: number
  users_id: number
  date_since: string
  date_until: string
  type?: number
  status: number
}

interface ClockodoAbsencesResponse {
  data: ClockodoAbsenceV4[]
}

export const CLOCKODO_ABSENCE_STATUS_APPROVED = 1

/**
 * Fetch all absences for a given year via Clockodo's v4 endpoint
 * (`/api/v4/absences`). The legacy `/api/v2/absences` was removed on
 * 2026-05-01, so the year now goes through the `filter` deep-object param
 * (`filter[year]=…`) and the workspace's absences come back under `data`
 * instead of `absences`. Multi-year ranges fan out into N requests at the
 * caller; status filtering (approved-only) stays downstream in the BI layer.
 */
export async function getClockodoAbsences(
  env: BillingEnv,
  year: number
): Promise<ClockodoAbsence[]> {
  const response = await axios.get<ClockodoAbsencesResponse>(
    'https://my.clockodo.com/api/v4/absences',
    {
      headers: clockodoHeaders(env),
      params: { 'filter[year]': year }
    }
  )

  return (response.data.data ?? []).map((a) => ({
    id: a.id,
    users_id: a.users_id,
    date_since: a.date_since,
    date_until: a.date_until,
    type: a.type ?? 0,
    status: a.status
  }))
}
