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
    legeZugangAnMitLink: jest.fn(),
  }
})

jest.mock('./dna-pipeline', () => ({
  triggerErstMatch: jest.fn(),
}))

// Ereignis-Protokoll mocken: die Routen schreiben fire-and-forget nach
// medium_events (würde sonst über global.fetch mitlaufen und die
// fetch-Zählungen unten verfälschen).
jest.mock('./medium-events', () => ({ schreibeMediumEvent: jest.fn().mockResolvedValue(undefined) }))

import { ladePortalMedium, legeZugangAnMitLink } from './portal-guard'
import { triggerErstMatch } from './dna-pipeline'
import { schreibeMediumEvent } from './medium-events'
import matchingFreischalten from '../pages/api/matching-freischalten'
import zugangsverwaltung from '../pages/api/zugangsverwaltung'

const ladeMock = ladePortalMedium as jest.Mock
const legeZugangMock = legeZugangAnMitLink as jest.Mock
const erstMatchMock = triggerErstMatch as jest.Mock
const eventMock = schreibeMediumEvent as jest.Mock

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

    // Roadmap-Ereignis wurde protokolliert.
    expect(eventMock).toHaveBeenCalledWith(
      expect.objectContaining({ medium_id: 'bajour', typ: 'matching_freigegeben' }),
    )
  })
})

describe('/api/zugangsverwaltung aktion=anlegen (Dedup via legeZugangAnMitLink)', () => {
  it('bestehender Zugang → {link, bestehend:true}, KEIN zugang_erstellt-Ereignis, E-Mail normalisiert', async () => {
    legeZugangMock.mockResolvedValue({ link: '/api/portal/einloesen?token=neu.link', bestehend: true })

    const { res, getStatus, getJson } = makeRes()
    await zugangsverwaltung(
      makeReq({ method: 'POST', body: { aktion: 'anlegen', email: ' Redaktion@Bajour.CH ', medium_slug: 'bajour' } }),
      res,
    )

    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({ link: '/api/portal/einloesen?token=neu.link', bestehend: true })
    expect(legeZugangMock).toHaveBeenCalledWith('redaktion@bajour.ch', 'bajour', 'wepublish', 'team', SECRET)

    // Nur ein neuer Link, kein neuer Zugang → KEIN zugang_erstellt-Ereignis.
    expect(eventMock).not.toHaveBeenCalled()
  })

  it('kein bestehender Zugang → {link} ohne bestehend + zugang_erstellt-Ereignis', async () => {
    legeZugangMock.mockResolvedValue({ link: '/api/portal/einloesen?token=frisch.link', bestehend: false })

    const { res, getStatus, getJson } = makeRes()
    await zugangsverwaltung(
      makeReq({ method: 'POST', body: { aktion: 'anlegen', email: 'Neu@Bajour.CH', medium_slug: 'bajour' } }),
      res,
    )

    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({ link: '/api/portal/einloesen?token=frisch.link' })

    // Echtes Neu-Anlegen → zugang_erstellt-Ereignis mit E-Mail im Detail.
    expect(eventMock).toHaveBeenCalledWith(
      expect.objectContaining({ medium_id: 'bajour', typ: 'zugang_erstellt', detail: 'neu@bajour.ch' }),
    )
  })

  it('Helfer wirft (Directus-Fehler) → 502, kein Ereignis', async () => {
    legeZugangMock.mockRejectedValue(new Error('Directus down'))
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const { res, getStatus } = makeRes()
    await zugangsverwaltung(
      makeReq({ method: 'POST', body: { aktion: 'anlegen', email: 'neu@bajour.ch', medium_slug: 'bajour' } }),
      res,
    )

    expect(getStatus()).toBe(502)
    expect(eventMock).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
