/**
 * Logik-Tests für die Operator-Routen der Portal-Steuerung (Task 4):
 * /api/matching-freischalten (DNA-Freigabe-Gate) und /api/zugangsverwaltung
 * (Anlegen-Dedup). Muster wie portal-routen.test.ts: Handler direkt
 * aufgerufen, portal-guard-Helfer gemockt, Directus-Aufrufe der Routen
 * selbst über global.fetch gemockt.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

jest.mock('./portal-guard', () => {
  const actual = jest.requireActual('./portal-guard')
  return {
    ...actual,
    ladePortalMedium: jest.fn(),
    erzeugeZugangsLink: jest.fn(),
  }
})

jest.mock('./dna-pipeline', () => ({
  triggerErstMatch: jest.fn(),
}))

import { ladePortalMedium, erzeugeZugangsLink } from './portal-guard'
import { triggerErstMatch } from './dna-pipeline'
import matchingFreischalten from '../pages/api/matching-freischalten'
import zugangsverwaltung from '../pages/api/zugangsverwaltung'

const ladeMock = ladePortalMedium as jest.Mock
const erzeugeLinkMock = erzeugeZugangsLink as jest.Mock
const erstMatchMock = triggerErstMatch as jest.Mock

const SECRET = 'steuerung-test-geheimnis-0815'

function makeRes() {
  let status = 200
  let body: unknown
  const res = {
    status: jest.fn((s: number) => {
      status = s
      return res
    }),
    json: jest.fn((j: unknown) => {
      body = j
      return res
    }),
    setHeader: jest.fn(() => res),
  } as unknown as NextApiResponse
  return { res, getStatus: () => status, getJson: () => body as Record<string, unknown> }
}

function makeReq(opts: { method: string; body?: unknown }): NextApiRequest {
  return { method: opts.method, body: opts.body ?? {}, query: {}, headers: {} } as unknown as NextApiRequest
}

beforeEach(() => {
  process.env.PORTAL_SESSION_SECRET = SECRET
  jest.clearAllMocks()
})

afterEach(() => {
  delete process.env.PORTAL_SESSION_SECRET
})

describe('/api/matching-freischalten (DNA-Freigabe-Gate)', () => {
  it('DNA nicht freigegeben → 422, kein PATCH, kein Erst-Match', async () => {
    ladeMock.mockResolvedValue({ id: '6', name: 'Bajour', slug: 'bajour', matchingFreigeschaltet: null, dnaFreigabe: null })
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const { res, getStatus, getJson } = makeRes()
    await matchingFreischalten(makeReq({ method: 'POST', body: { medium_slug: 'bajour' } }), res)

    expect(getStatus()).toBe(422)
    expect(getJson()).toEqual({ error: 'DNA ist vom Medium noch nicht freigegeben' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(erstMatchMock).not.toHaveBeenCalled()
  })

  it('Medium nicht gefunden → 404, kein PATCH', async () => {
    ladeMock.mockResolvedValue(null)
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const { res, getStatus } = makeRes()
    await matchingFreischalten(makeReq({ method: 'POST', body: { medium_slug: 'gibtsnicht' } }), res)

    expect(getStatus()).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(erstMatchMock).not.toHaveBeenCalled()
  })

  it('DNA freigegeben → PATCH (slug+mandant-Filter, Stempel-Felder) + Erst-Match + 200', async () => {
    ladeMock.mockResolvedValue({
      id: '6',
      name: 'Bajour',
      slug: 'bajour',
      matchingFreigeschaltet: null,
      dnaFreigabe: '2026-07-08T10:00:00Z',
    })
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [{ id: 6 }] }) })
    global.fetch = fetchMock as unknown as typeof fetch
    erstMatchMock.mockResolvedValue(undefined)

    const { res, getStatus, getJson } = makeRes()
    await matchingFreischalten(makeReq({ method: 'POST', body: { medium_slug: 'bajour' } }), res)

    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({ status: 'ok' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/items/faas_medien')
    expect(opts.method).toBe('PATCH')
    const body = JSON.parse(opts.body as string)
    expect(body.query.filter.slug).toEqual({ _eq: 'bajour' })
    expect(typeof body.data.matching_freigeschaltet).toBe('string')
    expect(body.data.matching_freigeschaltet_von).toBe('team')

    expect(erstMatchMock).toHaveBeenCalledWith('bajour')
  })
})

describe('/api/zugangsverwaltung aktion=anlegen (Dedup)', () => {
  it('bestehender Zugang (email+medium+mandant) → KEIN Create, neuer Link für den bestehenden, {link, bestehend:true}', async () => {
    // Erster fetch-Aufruf der Route ist der Dedup-Lookup → liefert einen Treffer.
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'z-alt', email: 'redaktion@bajour.ch', medium_slug: 'bajour' }] }),
    })
    global.fetch = fetchMock as unknown as typeof fetch
    erzeugeLinkMock.mockResolvedValue('/api/portal/einloesen?token=neu.link')

    const { res, getStatus, getJson } = makeRes()
    await zugangsverwaltung(
      makeReq({ method: 'POST', body: { aktion: 'anlegen', email: ' Redaktion@Bajour.CH ', medium_slug: 'bajour' } }),
      res,
    )

    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({ link: '/api/portal/einloesen?token=neu.link', bestehend: true })

    // Genau EIN fetch (der Lookup), kein zweiter (Create).
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [lookupUrl] = fetchMock.mock.calls[0] as [string]
    const decoded = decodeURIComponent(lookupUrl)
    expect(decoded).toContain('redaktion@bajour.ch')
    expect(decoded).toContain('bajour')
    expect(erzeugeLinkMock).toHaveBeenCalledWith('z-alt', 'redaktion@bajour.ch', 'bajour', SECRET)
  })

  it('kein bestehender Zugang → Create (lowercase-E-Mail, status eingeladen) + Link, {link} ohne bestehend', async () => {
    const fetchMock = jest
      .fn()
      // 1. Aufruf: Dedup-Lookup, leer.
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) })
      // 2. Aufruf: Create.
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: { id: 'z-neu' } }) })
    global.fetch = fetchMock as unknown as typeof fetch
    erzeugeLinkMock.mockResolvedValue('/api/portal/einloesen?token=frisch.link')

    const { res, getStatus, getJson } = makeRes()
    await zugangsverwaltung(
      makeReq({ method: 'POST', body: { aktion: 'anlegen', email: 'Neu@Bajour.CH', medium_slug: 'bajour' } }),
      res,
    )

    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({ link: '/api/portal/einloesen?token=frisch.link' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, createOpts] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(createOpts.method).toBe('POST')
    const createBody = JSON.parse(createOpts.body as string)
    expect(createBody.email).toBe('neu@bajour.ch')
    expect(createBody.status).toBe('eingeladen')
    expect(erzeugeLinkMock).toHaveBeenCalledWith('z-neu', 'neu@bajour.ch', 'bajour', SECRET)
  })
})
