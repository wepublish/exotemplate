/**
 * Logik-Tests für die Operator-Route /api/medium-zuruecksetzen (Voller
 * Neustart eines Mediums). Muster wie portal-steuerung-routen.test.ts:
 * Handler direkt aufgerufen, portal-guard.ladePortalMedium gemockt, die
 * Directus-Aufrufe der Route über global.fetch gemockt.
 */
import type { NextApiRequest, NextApiResponse } from 'next'

jest.mock('./portal-guard', () => {
  const actual = jest.requireActual('./portal-guard')
  return { ...actual, ladePortalMedium: jest.fn() }
})

import { ladePortalMedium } from './portal-guard'
import handler from '../pages/api/medium-zuruecksetzen'

const ladeMock = ladePortalMedium as jest.Mock

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
  process.env.PORTAL_SESSION_SECRET = 'reset-test-geheimnis-0815'
  jest.clearAllMocks()
})

afterEach(() => {
  delete process.env.PORTAL_SESSION_SECRET
})

describe('/api/medium-zuruecksetzen', () => {
  it('ohne medium_slug → 400, kein Directus-Call', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    const { res, getStatus } = makeRes()
    await handler(makeReq({ method: 'POST', body: {} }), res)
    expect(getStatus()).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falsche Methode → 405', async () => {
    const { res, getStatus } = makeRes()
    await handler(makeReq({ method: 'GET' }), res)
    expect(getStatus()).toBe(405)
  })

  it('Medium nicht gefunden → 404, keine Löschung', async () => {
    ladeMock.mockResolvedValue(null)
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    const { res, getStatus } = makeRes()
    await handler(makeReq({ method: 'POST', body: { medium_slug: 'gibtsnicht' } }), res)
    expect(getStatus()).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Happy Path: löscht dna/knowledge/matches, PATCH setzt Felder zurück, 200', async () => {
    ladeMock.mockResolvedValue({ id: '9', name: 'Zwölf', slug: 'zwolf', matchingFreigeschaltet: null, dnaFreigabe: null })
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({ data: [{ id: 1 }] }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const { res, getStatus, getJson } = makeRes()
    await handler(makeReq({ method: 'POST', body: { medium_slug: 'zwolf' } }), res)

    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({ status: 'ok', geloescht: { dna: 1, uploads: 1, matches: 1 } })

    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>
    const deletes = calls.filter(([, o]) => o?.method === 'DELETE').map(([u]) => u)
    expect(deletes.some((u) => u.includes('/items/medium_dna'))).toBe(true)
    expect(deletes.some((u) => u.includes('/items/medium_knowledge'))).toBe(true)
    expect(deletes.some((u) => u.includes('/items/match_results'))).toBe(true)

    const patch = calls.find(([, o]) => o?.method === 'PATCH')
    expect(patch).toBeDefined()
    const [purl, popts] = patch as [string, RequestInit]
    expect(purl).toContain('/items/faas_medien')
    const pbody = JSON.parse(popts.body as string)
    expect(pbody.query.filter.slug).toEqual({ _eq: 'zwolf' })
    expect(pbody.data.logo_url).toBeNull()
    expect(pbody.data.logo_hochgeladen).toBe(false)
    expect(pbody.data.dna_medium_freigabe).toBeNull()
    expect(pbody.data.matching_freigeschaltet).toBeNull()
    expect(pbody.data.arbeits_dna).toBeNull()
  })
})
