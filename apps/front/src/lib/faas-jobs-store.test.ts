/**
 * Tests für faas-jobs-store.ts — persistente Job-Ablage in Directus.
 * Alle vier Funktionen werden gegen einen fetch-Mock geprüft.
 */

import {
  createPersistentJob,
  getPersistentJob,
  patchPersistentJob,
  findRunningPersistentJob,
} from './faas-jobs-store'

const ROW = {
  id: 'j1',
  typ: 'betrag',
  key: '11:wepublish',
  status: 'running' as const,
  phase: null,
  ergebnis: null,
  fehler: null,
  started_at: '2026-06-11T08:00:00.000Z',
}

describe('faas-jobs-store', () => {
  const fetchMock = jest.fn()
  beforeEach(() => {
    global.fetch = fetchMock as unknown as typeof fetch
    fetchMock.mockReset()
  })

  test('createPersistentJob legt Zeile an und mappt Felder', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: ROW }) })
    const job = await createPersistentJob('betrag', '11:wepublish')
    expect(job.id).toBe('j1')
    expect(job.status).toBe('running')
    expect(job.startedAt).toBe(Date.parse(ROW.started_at))
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/items/faas_jobs')
    expect(JSON.parse((init as RequestInit).body as string).typ).toBe('betrag')
  })

  test('getPersistentJob liefert undefined bei leerem Ergebnis', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
    expect(await getPersistentJob('betrag', 'gibtsnicht')).toBeUndefined()
  })

  test('patchPersistentJob mappt result auf ergebnis und error auf fehler', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    await patchPersistentJob('j1', { status: 'done', result: { x: 1 }, error: undefined })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toEqual({ status: 'done', ergebnis: { x: 1 } })
  })

  test('findRunningPersistentJob filtert auf typ, key, running und Frische', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [ROW] }) })
    const job = await findRunningPersistentJob('betrag', '11:wepublish', 15 * 60_000)
    expect(job?.id).toBe('j1')
    const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]))
    expect(url).toContain('"status":{"_eq":"running"}')
    expect(url).toContain('"started_at":{"_gte"')
  })
})
