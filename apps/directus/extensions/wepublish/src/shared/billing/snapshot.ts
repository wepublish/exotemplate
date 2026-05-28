import type { Sums } from './aggregateHours'

/**
 * Subset of `Sums` we persist to `BillingSnapshots`. Mirrors the fields the
 * overview tile needs (the two progress bars + the labels under them); we
 * deliberately don't store the heavy per-entry detail, which still lives in
 * the in-memory billingCache and is reconstructed live on the detail pages.
 */
export interface SnapshotSums {
  totalUsedHours: number
  totalTopUps: number
  totalUsedPercentage: number
  totalAvailableHours: number
  totalManualWorkHours: number
  billableHours: number
}

export function toSnapshotSums(sums: Sums): SnapshotSums {
  // Defensive: the `BillingSnapshots` columns are typed Postgres numeric /
  // integer, so any non-finite value (Infinity / NaN) would 500 the upsert
  // with `invalid input syntax for type integer: "Infinity"`. The known
  // trigger is the divide-by-zero path in `computeEntryGroups` for clients
  // without top-ups; that's fixed at the source, but we keep this guard so
  // future arithmetic regressions can't silently corrupt the snapshot table.
  return {
    totalUsedHours: safeFinite(sums.totalUsedHours),
    totalTopUps: safeFinite(sums.totalTopUps),
    totalUsedPercentage: safeFinite(sums.totalUsedPercentage),
    totalAvailableHours: safeFinite(sums.totalAvailableHours),
    totalManualWorkHours: safeFinite(sums.totalManualWorkHours),
    billableHours: safeFinite(sums.billableHours)
  }
}

function safeFinite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

/**
 * Persisted snapshot row, minus the Directus housekeeping fields.
 */
export interface BillingSnapshotRow extends SnapshotSums {
  id: string
  clientPeriodId: number
  computedAt: string
  lastError: string | null
  lastErrorAt: string | null
}

/**
 * Minimal interface we need from a Directus ItemsService<BillingSnapshot>.
 * Defined here so callers can pass a real service in production and a stub in
 * tests without bringing in Directus' generated types.
 */
export interface SnapshotsServiceLike {
  readByQuery(query: unknown): Promise<BillingSnapshotRow[]>
  createOne(payload: unknown): Promise<string | number>
  updateOne(id: string | number, payload: unknown): Promise<string | number>
}

interface PersistSuccessArgs {
  service: SnapshotsServiceLike
  clientPeriodId: number
  sums: Sums
  computedAt?: Date
}

/**
 * Upsert a successful computation. We look up by `clientPeriodId` (unique) and
 * create-or-update accordingly. On success we always clear any previous
 * `lastError` so the UI no longer flags the tile.
 */
export async function persistBillingSnapshotSuccess(
  args: PersistSuccessArgs
): Promise<void> {
  const existing = await findByClientPeriod(args.service, args.clientPeriodId)
  const computedAt = (args.computedAt ?? new Date()).toISOString()

  const payload = {
    clientPeriodId: args.clientPeriodId,
    ...toSnapshotSums(args.sums),
    computedAt,
    lastError: null,
    lastErrorAt: null
  }

  if (existing) {
    await args.service.updateOne(existing.id, payload)
  } else {
    await args.service.createOne(payload)
  }
}

interface PersistFailureArgs {
  service: SnapshotsServiceLike
  clientPeriodId: number
  error: unknown
  failedAt?: Date
}

/**
 * Record a refresh failure. Sums are NOT touched — the UI still sees the last
 * good values but flags the row as stale-with-error. If no snapshot exists
 * yet (brand-new period that never succeeded), we still create one with empty
 * sums + the error so the overview can render an explicit error tile.
 */
export async function persistBillingSnapshotFailure(
  args: PersistFailureArgs
): Promise<void> {
  const existing = await findByClientPeriod(args.service, args.clientPeriodId)
  const lastErrorAt = (args.failedAt ?? new Date()).toISOString()
  const lastError = stringifyError(args.error)

  if (existing) {
    await args.service.updateOne(existing.id, { lastError, lastErrorAt })
    return
  }

  await args.service.createOne({
    clientPeriodId: args.clientPeriodId,
    totalUsedHours: 0,
    totalTopUps: 0,
    totalUsedPercentage: 0,
    totalAvailableHours: 0,
    totalManualWorkHours: 0,
    billableHours: 0,
    computedAt: null,
    lastError,
    lastErrorAt
  })
}

async function findByClientPeriod(
  service: SnapshotsServiceLike,
  clientPeriodId: number
): Promise<BillingSnapshotRow | null> {
  const rows = await service.readByQuery({
    filter: { clientPeriodId: { _eq: clientPeriodId } },
    limit: 1
  })
  return rows[0] ?? null
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
