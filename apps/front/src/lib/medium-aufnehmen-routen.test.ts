/**
 * Logik-Tests für /api/medium-aufnehmen: Hallo + Magic-Link in einem Schritt.
 * Handler direkt aufgerufen; legeZugangAnMitLink (portal-guard) und das
 * Ereignis-Protokoll gemockt, die Directus-Aufrufe der Route selbst über
 * global.fetch (Muster wie portal-steuerung-routen.test.ts).
 */
import type { NextApiRequest, NextApiResponse } from 'next'

jest.mock('./portal-guard', () => {
  const actual = jest.requireActual('./portal-guard')
  return {
    ...actual,
    legeZugangAnMitLink: jest.fn(),
  }
})

jest.mock('./medium-events', () => ({ schreibeMediumEvent: jest.fn().mockResolvedValue(undefined) }))

import { legeZugangAnMitLink } from './portal-guard'
import { schreibeMediumEvent } from './medium-events'
import mediumAufnehmen from '../pages/api/medium-aufnehmen'

const legeZugangMock = legeZugangAnMitLink as jest.Mock
const eventMock = schreibeMediumEvent as jest.Mock

const SECRET = 'aufnehmen-test-geheimnis-4711'

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

/** fetch-Mock: 1. Aufruf Duplikat-Lookup, 2. Aufruf Medium-Create. */
function mockLookupUndCreate(fetchMock: jest.Mock, lookupTreffer: unknown[] = []) {
  fetchMock
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: lookupTreffer }) })
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: { id: 42 } }) })
}

beforeEach(() => {
  process.env.PORTAL_SESSION_SECRET = SECRET
  jest.clearAllMocks()
})

afterEach(() => {
  delete process.env.PORTAL_SESSION_SECRET
})

describe('/api/medium-aufnehmen', () => {
  it('andere Methode → 405', async () => {
    const { res, getStatus } = makeRes()
    await mediumAufnehmen(makeReq({ method: 'GET' }), res)
    expect(getStatus()).toBe(405)
  })

  it('ohne name → 400', async () => {
    const { res, getStatus } = makeRes()
    await mediumAufnehmen(makeReq({ method: 'POST', body: {} }), res)
    expect(getStatus()).toBe(400)
  })

  it('Name ohne Slug-Substanz (nur Sonderzeichen) → 400', async () => {
    const { res, getStatus } = makeRes()
    await mediumAufnehmen(makeReq({ method: 'POST', body: { name: '***' } }), res)
    expect(getStatus()).toBe(400)
  })

  it('Slug existiert schon (mandantenrein) → 409 bereits_vorhanden, kein Create, kein Ereignis', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [{ id: 7, slug: 'hauptstadt' }] }) })
    global.fetch = fetchMock as unknown as typeof fetch

    const { res, getStatus, getJson } = makeRes()
    await mediumAufnehmen(makeReq({ method: 'POST', body: { name: 'Hauptstadt' } }), res)

    expect(getStatus()).toBe(409)
    expect(getJson()).toEqual({ bereits_vorhanden: true, slug: 'hauptstadt' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(eventMock).not.toHaveBeenCalled()
  })

  it('ohne E-Mail: Medium angelegt (Slug, Mandant, API-URL-Vorschlag) + medium_aufgenommen, KEIN Zugang', async () => {
    const fetchMock = jest.fn()
    mockLookupUndCreate(fetchMock)
    global.fetch = fetchMock as unknown as typeof fetch

    const { res, getStatus, getJson } = makeRes()
    await mediumAufnehmen(makeReq({ method: 'POST', body: { name: 'Neue Wege', website: 'https://neuewege.ch' } }), res)

    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({ slug: 'neue_wege' })

    const [, createOpts] = fetchMock.mock.calls[1] as [string, RequestInit]
    const createBody = JSON.parse(createOpts.body as string)
    expect(createBody.slug).toBe('neue_wege')
    expect(createBody.mandant).toBe('wepublish')
    expect(createBody.is_active).toBe(true)
    expect(createBody.website).toBe('https://neuewege.ch')
    expect(createBody.wepublish_api_url).toBe('https://api-neue_wege.wepublish.cloud/v1')

    expect(eventMock).toHaveBeenCalledTimes(1)
    expect(eventMock).toHaveBeenCalledWith(
      expect.objectContaining({ medium_id: 'neue_wege', typ: 'medium_aufgenommen', titel: 'Medium aufgenommen: Neue Wege' }),
    )
    expect(legeZugangMock).not.toHaveBeenCalled()
  })

  it('mit E-Mail: Medium + Zugang + Link in einem Schritt, beide Ereignisse', async () => {
    const fetchMock = jest.fn()
    mockLookupUndCreate(fetchMock)
    global.fetch = fetchMock as unknown as typeof fetch
    legeZugangMock.mockResolvedValue({ link: 'https://portal.example/api/portal/einloesen?token=abc', bestehend: false })

    const { res, getStatus, getJson } = makeRes()
    await mediumAufnehmen(
      makeReq({ method: 'POST', body: { name: 'Hauptstadt', email: ' Redaktion@Hauptstadt.BE ' } }),
      res,
    )

    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({
      slug: 'hauptstadt',
      link: 'https://portal.example/api/portal/einloesen?token=abc',
      zugangBestehend: false,
    })
    expect(legeZugangMock).toHaveBeenCalledWith('redaktion@hauptstadt.be', 'hauptstadt', 'wepublish', 'team', SECRET)

    expect(eventMock).toHaveBeenCalledWith(expect.objectContaining({ typ: 'medium_aufgenommen' }))
    expect(eventMock).toHaveBeenCalledWith(
      expect.objectContaining({ typ: 'zugang_erstellt', medium_id: 'hauptstadt', detail: 'redaktion@hauptstadt.be' }),
    )
  })

  it('mit E-Mail, Zugang existiert schon → zugangBestehend:true, KEIN zugang_erstellt-Ereignis', async () => {
    const fetchMock = jest.fn()
    mockLookupUndCreate(fetchMock)
    global.fetch = fetchMock as unknown as typeof fetch
    legeZugangMock.mockResolvedValue({ link: 'https://portal.example/link', bestehend: true })

    const { res, getStatus, getJson } = makeRes()
    await mediumAufnehmen(makeReq({ method: 'POST', body: { name: 'Hauptstadt', email: 'x@y.ch' } }), res)

    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({ slug: 'hauptstadt', link: 'https://portal.example/link', zugangBestehend: true })
    const eventTypen = eventMock.mock.calls.map((c: [Record<string, unknown>]) => c[0].typ)
    expect(eventTypen).toEqual(['medium_aufgenommen'])
  })

  it('mit E-Mail ohne PORTAL_SESSION_SECRET → 503, nichts angelegt', async () => {
    delete process.env.PORTAL_SESSION_SECRET
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const { res, getStatus } = makeRes()
    await mediumAufnehmen(makeReq({ method: 'POST', body: { name: 'Hauptstadt', email: 'x@y.ch' } }), res)

    expect(getStatus()).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Create schlägt fehl → 502, kein Ereignis', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) })
      .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('kaputt') })
    global.fetch = fetchMock as unknown as typeof fetch

    const { res, getStatus } = makeRes()
    await mediumAufnehmen(makeReq({ method: 'POST', body: { name: 'Hauptstadt' } }), res)

    expect(getStatus()).toBe(502)
    expect(eventMock).not.toHaveBeenCalled()
  })
})
