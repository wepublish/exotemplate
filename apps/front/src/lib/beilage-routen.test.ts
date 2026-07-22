/**
 * Routen-Tests für den Beilagen-Download (Task 10, Pre-Deploy-Fix Final-Review):
 * /api/portal/beilage. Handler direkt aufgerufen, Directus-Helfer aus
 * portal-guard gemockt (Muster wie gesuch-export-routen.test.ts /
 * portal-gesuche-routen.test.ts). `gesuchPortalStatus` / GESUCH_STATUS_AB_BEREIT
 * aus portal-status.ts bleiben ECHT (reine Ableitungslogik, kein IO): das
 * Freigabe-Gate wird über echte status/portal-Kombinationen ausgelöst, nicht
 * über einen vorgetäuschten Rückgabewert.
 *
 * Im Fokus steht das neu ergänzte Freigabe-Gate (Defense-in-Depth, mirror von
 * gesuch-export.ts): solange der Gesuch-Status noch nicht mindestens 'bereit'
 * ist, liefert die Route 409, OHNE den fileId-Zugehörigkeits-Check oder den
 * Directus-Asset-Fetch überhaupt auszuführen. Die bestehenden Eigenschaften
 * (Cross-Medium-Isolation, fileId-Zugehörigkeit, echter Download) bleiben
 * daneben abgedeckt.
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
  }
})

import { ladeApplicationFuerPortal } from './portal-guard'
import beilage from '../pages/api/portal/beilage'

const ladeAppMock = ladeApplicationFuerPortal as jest.Mock

const SECRET = 'beilage-routen-test-geheimnis-4711'
const FAKE_ASSET_BUFFER = Buffer.from('%PDF-fake-inhalt')

function makeRes() {
  let status = 200
  let body: unknown
  let gesendet: unknown
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
    send: jest.fn((t: unknown) => {
      gesendet = t
      return res
    }),
  } as unknown as NextApiResponse
  return {
    res,
    getStatus: () => status,
    getJson: () => body as Record<string, unknown>,
    getSend: () => gesendet,
    getHeaders: () => headers,
  }
}

function makeReq(opts: { method: string; query?: Record<string, unknown>; cookie?: string }): NextApiRequest {
  return {
    method: opts.method,
    body: {},
    query: opts.query ?? {},
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
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => 'application/pdf' },
    arrayBuffer: async () => FAKE_ASSET_BUFFER,
  }) as unknown as typeof fetch
})

afterEach(() => {
  delete process.env.PORTAL_SESSION_SECRET
})

describe('/api/portal/beilage', () => {
  it('andere Methode → 405 mit Allow-Header, kein Directus-Zugriff', async () => {
    const { res, getStatus, getHeaders } = makeRes()
    await beilage(makeReq({ method: 'POST' }), res)
    expect(getStatus()).toBe(405)
    expect(getHeaders().allow).toBe('GET')
    expect(ladeAppMock).not.toHaveBeenCalled()
  })

  it('ohne Session → 401, kein Directus-Zugriff', async () => {
    const { res, getStatus } = makeRes()
    await beilage(makeReq({ method: 'GET', query: { app: 'app-1', file: 'file-1' } }), res)
    expect(getStatus()).toBe(401)
    expect(ladeAppMock).not.toHaveBeenCalled()
  })

  it('fehlende app/file → 400, kein Directus-Zugriff', async () => {
    const { res, getStatus } = makeRes()
    await beilage(makeReq({ method: 'GET', query: { app: 'app-1' }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(400)
    expect(ladeAppMock).not.toHaveBeenCalled()
  })

  it('Application nicht gefunden bzw. gehört einem anderen Medium (Cross-Medium-Isolation) → 404, kein Asset-Fetch', async () => {
    ladeAppMock.mockResolvedValue(null)
    const { res, getStatus, getJson } = makeRes()
    await beilage(makeReq({ method: 'GET', query: { app: 'fremde-app', file: 'file-1' }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(404)
    expect(getJson()).toEqual({ error: 'Antrag nicht gefunden.' })
    expect(ladeAppMock).toHaveBeenCalledWith('fremde-app', 'bajour')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('Status noch nicht "bereit" (in_arbeit, kein freigegeben_am) → 409, kein Asset-Fetch (Freigabe-Gate)', async () => {
    ladeAppMock.mockResolvedValue(
      baueApp({ status: 'in_arbeit', portal: { beilagen: [{ fileId: 'file-1', name: 'beleg.pdf' }] } }),
    )
    const { res, getStatus, getJson } = makeRes()
    await beilage(makeReq({ method: 'GET', query: { app: 'app-1', file: 'file-1' }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(409)
    expect(getJson()).toEqual({ error: 'Der Gesuchstext ist noch nicht verfügbar.' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('Status "bereit", aber fileId gehört nicht zu den Beilagen → 403, kein Asset-Fetch', async () => {
    ladeAppMock.mockResolvedValue(
      baueApp({
        status: 'in_arbeit',
        portal: { freigegeben_am: '2026-07-01T00:00:00Z', beilagen: [{ fileId: 'file-1', name: 'beleg.pdf' }] },
      }),
    )
    const { res, getStatus, getJson } = makeRes()
    await beilage(makeReq({ method: 'GET', query: { app: 'app-1', file: 'fremde-datei' }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(403)
    expect(getJson()).toEqual({ error: 'Diese Datei gehört nicht zu diesem Antrag.' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('Erfolg (Status "bereit", fileId gehört zur Application) → 200, Datei-Stream mit Content-Disposition', async () => {
    ladeAppMock.mockResolvedValue(
      baueApp({
        status: 'in_arbeit',
        portal: { freigegeben_am: '2026-07-01T00:00:00Z', beilagen: [{ fileId: 'file-1', name: 'beleg.pdf' }] },
      }),
    )
    const { res, getStatus, getHeaders, getSend } = makeRes()
    await beilage(makeReq({ method: 'GET', query: { app: 'app-1', file: 'file-1' }, cookie: sessionCookie() }), res)

    expect(getStatus()).toBe(200)
    expect(getHeaders()['content-type']).toBe('application/pdf')
    expect(getHeaders()['content-disposition']).toBe('attachment; filename="beleg.pdf"')
    expect(Buffer.isBuffer(getSend())).toBe(true)
  })

  it('Directus-Fehler beim Laden der Application → 502, kein Asset-Fetch', async () => {
    ladeAppMock.mockRejectedValue(new Error('Directus down'))
    const { res, getStatus, getJson } = makeRes()
    await beilage(makeReq({ method: 'GET', query: { app: 'app-1', file: 'file-1' }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(502)
    expect(getJson()).toEqual({ error: 'Daten momentan nicht verfügbar' })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
