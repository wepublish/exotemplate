import type { ClientPeriod, Period } from '../DirectusTypes'

/**
 * Minimal interface so callers can pass either a Directus ItemsService directly
 * or a stub in tests without depending on the full Directus type surface.
 */
export interface ClientPeriodsServiceLike {
  readByQuery(query: unknown): Promise<ClientPeriod[]>
}

export interface FindCurrentClientPeriodOptions {
  /**
   * Extra fields to request alongside the period's `id`, `from`, `to`, `name`.
   * The default field selection is intentionally narrow; callers needing the
   * full row (topUps, manualWorkEntries) pass them here so we don't fetch
   * heavy data when we don't need it.
   */
  extraFields?: string[]
}

const DEFAULT_FIELDS: readonly string[] = [
  'id',
  'Periods_id.id',
  'Periods_id.from',
  'Periods_id.to',
  'Periods_id.name'
]

/**
 * Returns the `Clients_Periods` row whose linked period covers `now` for the
 * given client. When several periods overlap (mid-period contract renewal
 * etc.) the one with the latest `from` date wins — matches the existing
 * behaviour of the weekly-report + jira-threshold-notifier loops.
 */
export async function findCurrentClientPeriod(
  service: ClientPeriodsServiceLike,
  clientId: string,
  now: Date,
  options: FindCurrentClientPeriodOptions = {}
): Promise<ClientPeriod | null> {
  const today = now.toISOString()

  const fields = [...DEFAULT_FIELDS, ...(options.extraFields ?? [])]

  const rows = await service.readByQuery({
    filter: {
      Clients_id: { _eq: clientId },
      Periods_id: { from: { _lte: today }, to: { _gte: today } }
    },
    fields,
    limit: -1
  })

  if (rows.length === 0) return null

  return rows.reduce((best, candidate) => {
    const bestFrom = (best.Periods_id as Period).from
    const candidateFrom = (candidate.Periods_id as Period).from
    return candidateFrom > bestFrom ? candidate : best
  })
}
