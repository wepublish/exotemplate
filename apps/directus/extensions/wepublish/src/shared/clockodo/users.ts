import axios from 'axios'
import type { BillingEnv } from '../billing/env'
import { clockodoHeaders } from './headers'

export interface ClockodoUser {
  id: number
  name: string
  email: string
  weekly_target_hours: number | null
  active: boolean
  nonbusinessgroups_id: number | null
}

interface ClockodoUsersResponse {
  users: Array<{
    id: number
    name: string
    email: string
    weekly_target_hours?: number | null
    active?: boolean
    nonbusinessgroups_id?: number | null
  }>
}

/**
 * Fetch the workspace's user list from Clockodo. Returned rows are normalised
 * to the small subset the BI dashboard needs — Clockodo's payload carries
 * many more fields we don't use today.
 */
export async function getClockodoUsers(
  env: BillingEnv
): Promise<ClockodoUser[]> {
  const response = await axios.get<ClockodoUsersResponse>(
    'https://my.clockodo.com/api/v2/users',
    { headers: clockodoHeaders(env) }
  )

  return response.data.users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    weekly_target_hours: u.weekly_target_hours ?? null,
    active: u.active ?? true,
    nonbusinessgroups_id: u.nonbusinessgroups_id ?? null
  }))
}
