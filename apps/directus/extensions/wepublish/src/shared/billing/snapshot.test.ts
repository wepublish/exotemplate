import { describe, expect, it, vi } from 'vitest'
import type { Sums } from './aggregateHours'
import {
  persistBillingSnapshotFailure,
  persistBillingSnapshotSuccess,
  type BillingSnapshotRow,
  type SnapshotsServiceLike
} from './snapshot'

function service(initial: BillingSnapshotRow[] = []): SnapshotsServiceLike & {
  rows: BillingSnapshotRow[]
} {
  const rows = [...initial]
  return {
    rows,
    readByQuery: vi.fn(async (query: any) => {
      const target = query?.filter?.clientPeriodId?._eq
      return rows.filter((r) => r.clientPeriodId === target)
    }),
    createOne: vi.fn(async (payload: any) => {
      const row: BillingSnapshotRow = {
        id: `id-${rows.length + 1}`,
        clientPeriodId: payload.clientPeriodId,
        totalUsedHours: payload.totalUsedHours,
        totalTopUps: payload.totalTopUps,
        totalUsedPercentage: payload.totalUsedPercentage,
        totalAvailableHours: payload.totalAvailableHours,
        totalManualWorkHours: payload.totalManualWorkHours,
        billableHours: payload.billableHours,
        computedAt: payload.computedAt,
        lastError: payload.lastError,
        lastErrorAt: payload.lastErrorAt
      }
      rows.push(row)
      return row.id
    }),
    updateOne: vi.fn(async (id: string | number, payload: any) => {
      const idx = rows.findIndex((r) => r.id === id)
      if (idx === -1) throw new Error(`No row ${id}`)
      rows[idx] = { ...rows[idx], ...payload } as BillingSnapshotRow
      return id
    })
  }
}

const baseSums: Sums = {
  billableHours: 100,
  nonBillableHours: 5,
  computedTopUps: [],
  totalTopUps: 200,
  totalManualWorkHours: 10,
  totalUsedHours: 110,
  totalAvailableHours: 90,
  totalUsedPercentage: 55
}

describe('toSnapshotSums (defensive coercion)', () => {
  it('coerces Infinity / NaN to 0 so the typed Postgres columns never see them', async () => {
    const svc = service()

    await persistBillingSnapshotSuccess({
      service: svc,
      clientPeriodId: 99,
      sums: {
        ...baseSums,
        totalUsedPercentage: Number.POSITIVE_INFINITY,
        totalAvailableHours: Number.NaN
      },
      computedAt: new Date('2026-05-28T10:00:00Z')
    })

    expect(svc.rows[0]).toMatchObject({
      totalUsedPercentage: 0,
      totalAvailableHours: 0
    })
  })
})

describe('persistBillingSnapshotSuccess', () => {
  it('creates a new row when none exists', async () => {
    const svc = service()
    const computedAt = new Date('2026-05-28T10:00:00Z')

    await persistBillingSnapshotSuccess({
      service: svc,
      clientPeriodId: 42,
      sums: baseSums,
      computedAt
    })

    expect(svc.createOne).toHaveBeenCalledTimes(1)
    expect(svc.updateOne).not.toHaveBeenCalled()
    expect(svc.rows[0]).toMatchObject({
      clientPeriodId: 42,
      totalUsedHours: 110,
      totalUsedPercentage: 55,
      computedAt: '2026-05-28T10:00:00.000Z',
      lastError: null,
      lastErrorAt: null
    })
  })

  it('updates the existing row and clears prior error', async () => {
    const svc = service([
      {
        id: 'id-1',
        clientPeriodId: 42,
        totalUsedHours: 5,
        totalTopUps: 100,
        totalUsedPercentage: 5,
        totalAvailableHours: 95,
        totalManualWorkHours: 0,
        billableHours: 5,
        computedAt: '2026-05-27T10:00:00.000Z',
        lastError: 'Clockodo 429',
        lastErrorAt: '2026-05-28T09:00:00.000Z'
      }
    ])

    await persistBillingSnapshotSuccess({
      service: svc,
      clientPeriodId: 42,
      sums: baseSums,
      computedAt: new Date('2026-05-28T10:00:00Z')
    })

    expect(svc.createOne).not.toHaveBeenCalled()
    expect(svc.updateOne).toHaveBeenCalledTimes(1)
    expect(svc.rows[0]).toMatchObject({
      totalUsedHours: 110,
      lastError: null,
      lastErrorAt: null,
      computedAt: '2026-05-28T10:00:00.000Z'
    })
  })
})

describe('persistBillingSnapshotFailure', () => {
  it('records error on existing row without overwriting sums', async () => {
    const svc = service([
      {
        id: 'id-1',
        clientPeriodId: 42,
        totalUsedHours: 110,
        totalTopUps: 200,
        totalUsedPercentage: 55,
        totalAvailableHours: 90,
        totalManualWorkHours: 10,
        billableHours: 100,
        computedAt: '2026-05-27T10:00:00.000Z',
        lastError: null,
        lastErrorAt: null
      }
    ])

    await persistBillingSnapshotFailure({
      service: svc,
      clientPeriodId: 42,
      error: new Error('Jira 401'),
      failedAt: new Date('2026-05-28T11:00:00Z')
    })

    expect(svc.createOne).not.toHaveBeenCalled()
    expect(svc.rows[0]).toMatchObject({
      totalUsedHours: 110,
      totalUsedPercentage: 55,
      lastError: 'Jira 401',
      lastErrorAt: '2026-05-28T11:00:00.000Z'
    })
  })

  it('creates an empty error row when no prior snapshot exists', async () => {
    const svc = service()

    await persistBillingSnapshotFailure({
      service: svc,
      clientPeriodId: 42,
      error: 'boom',
      failedAt: new Date('2026-05-28T11:00:00Z')
    })

    expect(svc.createOne).toHaveBeenCalledTimes(1)
    expect(svc.rows[0]).toMatchObject({
      clientPeriodId: 42,
      totalUsedHours: 0,
      totalTopUps: 0,
      lastError: 'boom',
      lastErrorAt: '2026-05-28T11:00:00.000Z',
      computedAt: null
    })
  })
})
