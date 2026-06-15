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

interface ClockodoUserV3 {
  id: number
  name: string
  email?: string | null
  active?: boolean
  // v3 renamed the nonbusiness-group field; both names are emitted today but
  // the old one is deprecated, so prefer the new and fall back to the old.
  nonbusiness_groups_id?: number | null
  nonbusinessgroups_id?: number | null
}

interface ClockodoUsersResponse {
  data: ClockodoUserV3[]
}

/**
 * Fetch the workspace's user list from Clockodo's v3 endpoint
 * (`/api/v3/users`). The legacy `/api/v2/users` was removed on 2026-05-01.
 * v3 is paginated and returns rows under `data` (not `users`); we request the
 * max page size to pull the whole team in one call since the workspace is well
 * under that. Returned rows are normalised to the small subset the BI
 * dashboard needs.
 *
 * `weekly_target_hours` is intentionally null: it isn't on the user payload
 * (never was — the per-user weekly target lives on `/api/targethours/`).
 */
export async function getClockodoUsers(
  env: BillingEnv
): Promise<ClockodoUser[]> {
  const response = await axios.get<ClockodoUsersResponse>(
    'https://my.clockodo.com/api/v3/users',
    {
      headers: clockodoHeaders(env),
      params: { items_per_page: 1000 }
    }
  )

  return (response.data.data ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email ?? '',
    weekly_target_hours: null,
    active: u.active ?? true,
    nonbusinessgroups_id:
      u.nonbusiness_groups_id ?? u.nonbusinessgroups_id ?? null
  }))
}
