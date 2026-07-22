/**
 * Logik-Tests für die Gesuch-Routen (Task 10, Fix-Runde 1):
 * /api/portal/gesuch-aktion (Status-Sequenz-Gate, Important 1) und
 * /api/portal/gesuche (Listen-Filter auf Portal-Bezug, Important 2). Handler
 * direkt aufgerufen, Directus-Zugriffe gemockt (Muster wie
 * portal-anschreiben-routen.test.ts / portal-guard.test.ts).
 *
 * Relative Pfade statt '@/lib/...'/'@/pages/...' in den jest.mock-Aufrufen:
 * next/jest schreibt nur Import-Statements um, nicht den String im
 * jest.mock-Aufruf; beide Pfade lösen auf dieselbe Datei auf.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { erzeugeSessionToken, PORTAL_COOKIE } from './portal-session'
import type { PortalGesuchApplicationRoh } from './portal-guard'

jest.mock('./portal-guard', () => {
  const actual = jest.requireActual('./portal-guard')
  return {
    ...actual,
    ladeApplicationFuerPortal: jest.fn(),
    patchApplication: jest.fn(),
  }
})

import { ladeApplicationFuerPortal, patchApplication } from './portal-guard'
import gesuchAktion from '../pages/api/portal/gesuch-aktion'
import gesucheListe from '../pages/api/portal/gesuche'

const ladeAppMock = ladeApplicationFuerPortal as jest.Mock
const patchMock = patchApplication as jest.Mock

const SECRET = 'gesuche-routen-test-geheimnis-4711'

function makeRes() {
  let status = 200
  let body: unknown
  const headers: Record<string, unknown> = {}
  const res = {
    status: jest.fn((s: number) => {
      status = s
      return res
    }),
    json: jest.fn((j: unknown) => {
      body = j
      return res
    }),
    setHeader: jest.fn((k: string, v: unknown) => {
      headers[k.toLowerCase()] = v
      return res
    }),
  } as unknown as NextApiResponse
  return { res, getStatus: () => status, getJson: () => body as Record<string, unknown>, getHeaders: () => headers }
}

function makeReq(opts: { method: string; body?: unknown; cookie?: string }): NextApiRequest {
  return {
    method: opts.method,
    body: opts.body ?? {},
    query: {},
    headers: opts.cookie ? { cookie: opts.cookie } : {},
  } as unknown as NextApiRequest
}

const sessionCookie = () => `${PORTAL_COOKIE}=${erzeugeSessionToken('redaktion@bajour.ch', 'bajour', SECRET)}`

/** Application-Grundgerüst (portal-guard.ladeApplicationFuerPortal-Rückgabeform); pro Test mit einem eigenen `portal`/`status` überschrieben. */
function baueApp(teil: Partial<PortalGesuchApplicationRoh>): PortalGesuchApplicationRoh {
  return {
    id: 'app-1',
    stiftungId: '123',
    stiftungName: 'Stiftung Test',
    status: 'in_arbeit',
    bemerkung: null,
    eingereichtAm: null,
    entschiedenAm: null,
    betragZugesagtChf: null,
    portal: {},
    ...teil,
  }
}

beforeEach(() => {
  process.env.PORTAL_SESSION_SECRET = SECRET
  jest.clearAllMocks()
})

afterEach(() => {
  delete process.env.PORTAL_SESSION_SECRET
})

// ─── /api/portal/gesuch-aktion: Status-Sequenz-Gate (Fix-Runde 1, Important 1) ─

describe('/api/portal/gesuch-aktion (Status-Sequenz-Gate)', () => {
  it('final bei Status "in_arbeit" (kein freigegeben_am) → 409, kein Schreibzugriff', async () => {
    ladeAppMock.mockResolvedValue(baueApp({ status: 'in_arbeit', portal: {} }))
    const { res, getStatus, getJson } = makeRes()
    await gesuchAktion(makeReq({ method: 'POST', body: { id: 'app-1', aktion: 'final' }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(409)
    expect(getJson()).toEqual({ grund: 'final_erfordert_status_bereit' })
    expect(patchMock).not.toHaveBeenCalled()
  })

  it('final bei Status "bereit" (freigegeben_am gesetzt) → 200, ein Schreibzugriff', async () => {
    ladeAppMock.mockResolvedValue(
      baueApp({ status: 'in_arbeit', portal: { freigegeben_am: '2026-07-01T00:00:00Z' } }),
    )
    patchMock.mockResolvedValue(undefined)
    const { res, getStatus, getJson } = makeRes()
    await gesuchAktion(makeReq({ method: 'POST', body: { id: 'app-1', aktion: 'final' }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({ status: 'ok' })
    expect(patchMock).toHaveBeenCalledTimes(1)
  })

  it('final bei Status "abgeschickt" (bereits weiter fortgeschritten) → 409, kein Schreibzugriff', async () => {
    ladeAppMock.mockResolvedValue(
      baueApp({
        status: 'in_arbeit',
        portal: { freigegeben_am: '2026-07-01T00:00:00Z', abgeschickt_am: '2026-07-03T00:00:00Z' },
      }),
    )
    const { res, getStatus, getJson } = makeRes()
    await gesuchAktion(makeReq({ method: 'POST', body: { id: 'app-1', aktion: 'final' }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(409)
    expect(getJson()).toEqual({ grund: 'final_erfordert_status_bereit' })
    expect(patchMock).not.toHaveBeenCalled()
  })

  it('abgeschickt bei Status "in_arbeit" (weder bereit noch final) → 409, kein Schreibzugriff', async () => {
    ladeAppMock.mockResolvedValue(baueApp({ status: 'in_arbeit', portal: {} }))
    const { res, getStatus, getJson } = makeRes()
    await gesuchAktion(
      makeReq({ method: 'POST', body: { id: 'app-1', aktion: 'abgeschickt' }, cookie: sessionCookie() }),
      res,
    )
    expect(getStatus()).toBe(409)
    expect(getJson()).toEqual({ grund: 'abgeschickt_erfordert_status_bereit_oder_final' })
    expect(patchMock).not.toHaveBeenCalled()
  })

  it('abgeschickt bei Status "bereit" → 200', async () => {
    ladeAppMock.mockResolvedValue(
      baueApp({ status: 'in_arbeit', portal: { freigegeben_am: '2026-07-01T00:00:00Z' } }),
    )
    patchMock.mockResolvedValue(undefined)
    const { res, getStatus } = makeRes()
    await gesuchAktion(
      makeReq({ method: 'POST', body: { id: 'app-1', aktion: 'abgeschickt', betrag: 15000 }, cookie: sessionCookie() }),
      res,
    )
    expect(getStatus()).toBe(200)
    expect(patchMock).toHaveBeenCalledTimes(1)
  })

  it('abgeschickt bei Status "final" → 200 (final ODER bereit erlaubt)', async () => {
    ladeAppMock.mockResolvedValue(
      baueApp({
        status: 'in_arbeit',
        portal: { freigegeben_am: '2026-07-01T00:00:00Z', final_am: '2026-07-02T00:00:00Z' },
      }),
    )
    patchMock.mockResolvedValue(undefined)
    const { res, getStatus } = makeRes()
    await gesuchAktion(
      makeReq({ method: 'POST', body: { id: 'app-1', aktion: 'abgeschickt' }, cookie: sessionCookie() }),
      res,
    )
    expect(getStatus()).toBe(200)
    expect(patchMock).toHaveBeenCalledTimes(1)
  })

  it('zusage bei Status "bereit" (noch nicht abgeschickt) → 409, kein Schreibzugriff', async () => {
    ladeAppMock.mockResolvedValue(
      baueApp({ status: 'in_arbeit', portal: { freigegeben_am: '2026-07-01T00:00:00Z' } }),
    )
    const { res, getStatus, getJson } = makeRes()
    await gesuchAktion(
      makeReq({ method: 'POST', body: { id: 'app-1', aktion: 'zusage', betrag: 20000 }, cookie: sessionCookie() }),
      res,
    )
    expect(getStatus()).toBe(409)
    expect(getJson()).toEqual({ grund: 'zusage_erfordert_status_abgeschickt' })
    expect(patchMock).not.toHaveBeenCalled()
  })

  it('zusage bei Status "abgeschickt" → 200, Betrag aus dem Body übernommen', async () => {
    ladeAppMock.mockResolvedValue(
      baueApp({
        status: 'in_arbeit',
        portal: { freigegeben_am: '2026-07-01T00:00:00Z', abgeschickt_am: '2026-07-03T00:00:00Z' },
        betragZugesagtChf: null,
      }),
    )
    patchMock.mockResolvedValue(undefined)
    const { res, getStatus } = makeRes()
    await gesuchAktion(
      makeReq({ method: 'POST', body: { id: 'app-1', aktion: 'zusage', betrag: 20000 }, cookie: sessionCookie() }),
      res,
    )
    expect(getStatus()).toBe(200)
    const [, patchData] = patchMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(patchData.betrag_zugesagt_chf).toBe(20000)
  })

  it('zusage ohne Betrag im Body: Fallback auf bereits gesetzten betrag_zugesagt_chf statt Nullen (Fix-Runde 1, Minor 3)', async () => {
    ladeAppMock.mockResolvedValue(
      baueApp({
        status: 'in_arbeit',
        portal: { freigegeben_am: '2026-07-01T00:00:00Z', abgeschickt_am: '2026-07-03T00:00:00Z' },
        betragZugesagtChf: 12500,
      }),
    )
    patchMock.mockResolvedValue(undefined)
    const { res, getStatus } = makeRes()
    await gesuchAktion(makeReq({ method: 'POST', body: { id: 'app-1', aktion: 'zusage' }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(200)
    const [, patchData] = patchMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(patchData.betrag_zugesagt_chf).toBe(12500)
  })

  it('absage bei Status "final" (noch nicht abgeschickt) → 409, kein Schreibzugriff', async () => {
    ladeAppMock.mockResolvedValue(
      baueApp({
        status: 'in_arbeit',
        portal: { freigegeben_am: '2026-07-01T00:00:00Z', final_am: '2026-07-02T00:00:00Z' },
      }),
    )
    const { res, getStatus, getJson } = makeRes()
    await gesuchAktion(
      makeReq({ method: 'POST', body: { id: 'app-1', aktion: 'absage', grund: 'Kein Budget mehr frei.' }, cookie: sessionCookie() }),
      res,
    )
    expect(getStatus()).toBe(409)
    expect(getJson()).toEqual({ grund: 'absage_erfordert_status_abgeschickt' })
    expect(patchMock).not.toHaveBeenCalled()
  })

  it('absage bei Status "abgeschickt" → 200', async () => {
    ladeAppMock.mockResolvedValue(
      baueApp({
        status: 'in_arbeit',
        bemerkung: 'Bestehende Notiz.',
        portal: { freigegeben_am: '2026-07-01T00:00:00Z', abgeschickt_am: '2026-07-03T00:00:00Z' },
      }),
    )
    patchMock.mockResolvedValue(undefined)
    const { res, getStatus } = makeRes()
    await gesuchAktion(
      makeReq({ method: 'POST', body: { id: 'app-1', aktion: 'absage', grund: 'Kein Budget mehr frei.' }, cookie: sessionCookie() }),
      res,
    )
    expect(getStatus()).toBe(200)
    expect(patchMock).toHaveBeenCalledTimes(1)
    const [, patchData] = patchMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(String(patchData.bemerkung)).toContain('Kein Budget mehr frei.')
  })

  it('zusage/absage bei Status "zugesagt"/"abgelehnt" (bereits entschieden) → 409, kein erneuter Schreibzugriff', async () => {
    ladeAppMock.mockResolvedValue(baueApp({ status: 'zugesagt', portal: { freigegeben_am: '2026-07-01T00:00:00Z' } }))
    const { res, getStatus, getJson } = makeRes()
    await gesuchAktion(
      makeReq({ method: 'POST', body: { id: 'app-1', aktion: 'zusage', betrag: 5000 }, cookie: sessionCookie() }),
      res,
    )
    expect(getStatus()).toBe(409)
    expect(getJson()).toEqual({ grund: 'zusage_erfordert_status_abgeschickt' })
    expect(patchMock).not.toHaveBeenCalled()
  })
})

// ─── /api/portal/gesuche: Listen-Filter auf Portal-Bezug (Fix-Runde 1, Important 2) ─

describe('/api/portal/gesuche (Listen-Filter auf Portal-Bezug)', () => {
  const MOCK_APPS = [
    { id: 'a1', stiftung_id: 1, stiftung_name: 'Ohne Portal-json', status: 'in_arbeit', portal: null },
    { id: 'a2', stiftung_id: 2, stiftung_name: 'Leeres Portal-Objekt', status: 'in_arbeit', portal: {} },
    {
      id: 'a3',
      stiftung_id: 3,
      stiftung_name: 'Uebers Portal angefordert',
      status: 'in_arbeit',
      portal: { angefordert_am: '2026-07-01T00:00:00Z' },
    },
    {
      id: 'a4',
      stiftung_id: 4,
      stiftung_name: 'Vom Operator freigegeben',
      status: 'in_arbeit',
      portal: { freigegeben_am: '2026-07-02T00:00:00Z' },
    },
  ]

  it('Applications ohne portal-json bzw. ohne angefordert_am/freigegeben_am erscheinen NICHT, mit einem der beiden Felder erscheinen sie', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: MOCK_APPS }) })
    global.fetch = mockFetch as unknown as typeof fetch

    const { res, getStatus, getJson } = makeRes()
    await gesucheListe(makeReq({ method: 'GET', cookie: sessionCookie() }), res)

    expect(getStatus()).toBe(200)
    const { gesuche } = getJson() as { gesuche: Array<{ id: string; stiftungName: string }> }
    const ids = gesuche.map((g) => g.id).sort()
    expect(ids).toEqual(['a3', 'a4'])
    expect(gesuche.find((g) => g.id === 'a1')).toBeUndefined()
    expect(gesuche.find((g) => g.id === 'a2')).toBeUndefined()
  })

  it('ohne Session → 401, kein Fetch', async () => {
    const mockFetch = jest.fn()
    global.fetch = mockFetch as unknown as typeof fetch
    const { res, getStatus } = makeRes()
    await gesucheListe(makeReq({ method: 'GET' }), res)
    expect(getStatus()).toBe(401)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('andere Methode → 405', async () => {
    const { res, getStatus } = makeRes()
    await gesucheListe(makeReq({ method: 'POST' }), res)
    expect(getStatus()).toBe(405)
  })
})
