import { describe, expect, it, vi } from 'vitest'
import type { ClientPeriod } from '../DirectusTypes'
import {
  findCurrentClientPeriod,
  type ClientPeriodsServiceLike
} from './clientPeriods'

function row(id: number, from: string, to: string): ClientPeriod {
  return {
    id,
    Periods_id: { id, from, to, name: `P${id}` }
  } as unknown as ClientPeriod
}

function service(rows: ClientPeriod[]): ClientPeriodsServiceLike {
  return {
    readByQuery: vi.fn(async () => rows)
  }
}

describe('findCurrentClientPeriod', () => {
  it('returns null when no period covers now', async () => {
    const result = await findCurrentClientPeriod(
      service([]),
      'client-1',
      new Date('2026-05-28T12:00:00Z')
    )
    expect(result).toBeNull()
  })

  it('returns the only matching period', async () => {
    const r = row(7, '2026-05-01', '2026-05-31')
    const result = await findCurrentClientPeriod(
      service([r]),
      'client-1',
      new Date('2026-05-15T00:00:00Z')
    )
    expect(result?.id).toBe(7)
  })

  it('picks the period with the latest `from` when multiple overlap', async () => {
    const older = row(1, '2026-01-01', '2026-12-31')
    const newer = row(2, '2026-05-01', '2026-06-30')
    const result = await findCurrentClientPeriod(
      service([older, newer]),
      'client-1',
      new Date('2026-05-20T00:00:00Z')
    )
    expect(result?.id).toBe(2)
  })

  it('passes through the filter for the given client + today', async () => {
    const svc = service([row(1, '2026-05-01', '2026-05-31')])
    await findCurrentClientPeriod(
      svc,
      'client-42',
      new Date('2026-05-28T09:00:00Z')
    )
    const query = (svc.readByQuery as any).mock.calls[0][0]
    expect(query.filter.Clients_id._eq).toBe('client-42')
    expect(query.filter.Periods_id.from._lte).toBe('2026-05-28T09:00:00.000Z')
    expect(query.filter.Periods_id.to._gte).toBe('2026-05-28T09:00:00.000Z')
  })

  it('appends extraFields onto the default field selection', async () => {
    const svc = service([row(1, '2026-05-01', '2026-05-31')])
    await findCurrentClientPeriod(
      svc,
      'client-1',
      new Date('2026-05-15T00:00:00Z'),
      { extraFields: ['topUps.*', 'manualWorkEntries.*'] }
    )
    const query = (svc.readByQuery as any).mock.calls[0][0]
    expect(query.fields).toContain('topUps.*')
    expect(query.fields).toContain('manualWorkEntries.*')
    expect(query.fields).toContain('Periods_id.from')
  })
})
