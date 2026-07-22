/**
 * Routen-Tests für den Word-Export des Gesuchs (Task 12, Fix-Runde 1):
 * /api/portal/gesuch-export. Handler direkt aufgerufen, Directus-Helfer aus
 * portal-guard gemockt, `baueGesuchDocx` (echtes Word-Rendering, docx-Paket)
 * gemockt (Muster wie portal-gesuche-routen.test.ts /
 * portal-anschreiben-routen.test.ts). `gesuchPortalStatus` /
 * GESUCH_STATUS_AB_BEREIT aus portal-status.ts bleiben ECHT (reine
 * Ableitungslogik, kein IO, siehe Modul-Kommentar dort). Das Freigabe-Gate
 * wird also über echte status/portal-Kombinationen ausgelöst, nicht über
 * einen vorgetäuschten Rückgabewert.
 *
 * Zwei sicherheitskritische Eigenschaften stehen im Vordergrund:
 * - Cross-Medium-Isolation: eine fremde/nicht existierende id liefert 404,
 *   OHNE dass ein docx gebaut wird (ladeApplicationFuerPortal prüft die
 *   Zugehörigkeit zum Session-Medium bereits selbst, siehe portal-guard.ts).
 * - Pre-Freigabe-Gate: solange der Status noch nicht mindestens 'bereit'
 *   ist ODER der Gesuchstext leer ist, liefert die Route 409, OHNE ein docx
 *   zu bauen (kein Text-Leak vor der Operator-Freigabe).
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
    ladePortalMedium: jest.fn(),
  }
})

jest.mock('./gesuch-docx', () => ({
  baueGesuchDocx: jest.fn(),
}))

import { ladeApplicationFuerPortal, ladePortalMedium } from './portal-guard'
import { baueGesuchDocx } from './gesuch-docx'
import gesuchExport from '../pages/api/portal/gesuch-export'

const ladeAppMock = ladeApplicationFuerPortal as jest.Mock
const ladeMediumMock = ladePortalMedium as jest.Mock
const baueDocxMock = baueGesuchDocx as jest.Mock

const SECRET = 'gesuch-export-routen-test-geheimnis-4711'

// Kleinster gefälschter docx-Puffer: eine echte docx-Datei ist ein ZIP-Archiv,
// dessen Signatur mit 'PK' beginnt (siehe gesuch-docx.test.ts). baueGesuchDocx
// wird gemockt (kein echtes Word-Rendering hier), der Puffer dient nur zur
// Prüfung, dass die Route ihn unverändert weiterreicht.
const FAKE_DOCX_BUFFER = Buffer.from('PK-fake-docx-inhalt')

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
  // Der Logo-Ladepfad in gesuch-export.ts (ladeLogoDateiId/ladeLogoBuffer)
  // ruft global.fetch direkt auf, nicht über einen portal-guard-Helfer:
  // ok:false lässt ihn best effort auf "kein Logo" degradieren, ohne den
  // Export zu stören (siehe Modul-Kommentar der Route).
  global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch
})

afterEach(() => {
  delete process.env.PORTAL_SESSION_SECRET
})

describe('/api/portal/gesuch-export', () => {
  it('andere Methode → 405 mit Allow-Header, kein Directus-Zugriff', async () => {
    const { res, getStatus, getHeaders } = makeRes()
    await gesuchExport(makeReq({ method: 'POST' }), res)
    expect(getStatus()).toBe(405)
    expect(getHeaders().allow).toBe('GET')
    expect(ladeAppMock).not.toHaveBeenCalled()
    expect(baueDocxMock).not.toHaveBeenCalled()
  })

  it('ohne Session → 401, kein Directus-Zugriff, kein docx', async () => {
    const { res, getStatus } = makeRes()
    await gesuchExport(makeReq({ method: 'GET', query: { id: 'app-1' } }), res)
    expect(getStatus()).toBe(401)
    expect(ladeAppMock).not.toHaveBeenCalled()
    expect(baueDocxMock).not.toHaveBeenCalled()
  })

  it('fehlende id → 400, kein Directus-Zugriff', async () => {
    const { res, getStatus } = makeRes()
    await gesuchExport(makeReq({ method: 'GET', query: {}, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(400)
    expect(ladeAppMock).not.toHaveBeenCalled()
  })

  it('leere id (nur Leerzeichen) → 400, kein Directus-Zugriff', async () => {
    const { res, getStatus } = makeRes()
    await gesuchExport(makeReq({ method: 'GET', query: { id: '   ' }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(400)
    expect(ladeAppMock).not.toHaveBeenCalled()
  })

  it('Application nicht gefunden bzw. gehört einem anderen Medium (Cross-Medium-Isolation) → 404, kein docx', async () => {
    ladeAppMock.mockResolvedValue(null)
    const { res, getStatus, getJson } = makeRes()
    await gesuchExport(makeReq({ method: 'GET', query: { id: 'fremde-app' }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(404)
    expect(getJson()).toEqual({ error: 'Antrag nicht gefunden.' })
    expect(ladeAppMock).toHaveBeenCalledWith('fremde-app', 'bajour')
    expect(baueDocxMock).not.toHaveBeenCalled()
  })

  it('Status noch nicht "bereit" (in_arbeit, kein freigegeben_am) → 409, kein docx (Freigabe-Gate)', async () => {
    ladeAppMock.mockResolvedValue(baueApp({ status: 'in_arbeit', portal: { gesuch_text: 'Ein Entwurfstext.' } }))
    const { res, getStatus, getJson } = makeRes()
    await gesuchExport(makeReq({ method: 'GET', query: { id: 'app-1' }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(409)
    expect(getJson()).toEqual({ error: 'Der Gesuchstext ist noch nicht verfügbar.' })
    expect(baueDocxMock).not.toHaveBeenCalled()
  })

  it('Status "bereit", aber gesuch_text leer/nur Leerzeichen → 409, kein docx (Gate greift auch ohne Text)', async () => {
    ladeAppMock.mockResolvedValue(
      baueApp({ status: 'in_arbeit', portal: { freigegeben_am: '2026-07-01T00:00:00Z', gesuch_text: '   ' } }),
    )
    const { res, getStatus, getJson } = makeRes()
    await gesuchExport(makeReq({ method: 'GET', query: { id: 'app-1' }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(409)
    expect(getJson()).toEqual({ error: 'Der Gesuchstext ist noch nicht verfügbar.' })
    expect(baueDocxMock).not.toHaveBeenCalled()
  })

  it('Directus-Fehler beim Laden der Application → 502, kein docx', async () => {
    ladeAppMock.mockRejectedValue(new Error('Directus down'))
    const { res, getStatus, getJson } = makeRes()
    await gesuchExport(makeReq({ method: 'GET', query: { id: 'app-1' }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(502)
    expect(getJson()).toEqual({ error: 'Daten momentan nicht verfügbar' })
    expect(baueDocxMock).not.toHaveBeenCalled()
  })

  it('Erfolg (Status "bereit", gesuch_text vorhanden) → 200, docx-Header + Puffer, baueGesuchDocx einmal aufgerufen', async () => {
    ladeAppMock.mockResolvedValue(
      baueApp({
        status: 'in_arbeit',
        stiftungName: 'Stiftung Sonnenschein',
        portal: { freigegeben_am: '2026-07-01T00:00:00Z', gesuch_text: 'Sehr geehrte Damen und Herren...' },
      }),
    )
    ladeMediumMock.mockResolvedValue({ id: '6', name: 'Bajour', slug: 'bajour', matchingFreigeschaltet: null, dnaFreigabe: null })
    baueDocxMock.mockResolvedValue(FAKE_DOCX_BUFFER)

    const { res, getStatus, getHeaders, getSend } = makeRes()
    await gesuchExport(makeReq({ method: 'GET', query: { id: 'app-1' }, cookie: sessionCookie() }), res)

    expect(getStatus()).toBe(200)
    expect(getHeaders()['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(String(getHeaders()['content-disposition'])).toBe(
      'attachment; filename="gesuch_stiftung_sonnenschein.docx"',
    )
    expect(getHeaders()['content-length']).toBe(String(FAKE_DOCX_BUFFER.length))

    expect(baueDocxMock).toHaveBeenCalledTimes(1)
    const [args] = baueDocxMock.mock.calls[0] as [Record<string, unknown>]
    expect(args.mediumSlug).toBe('bajour')
    expect(args.mediumName).toBe('Bajour')
    expect(args.stiftungName).toBe('Stiftung Sonnenschein')
    expect(args.text).toBe('Sehr geehrte Damen und Herren...')

    const gesendet = getSend() as Buffer
    expect(Buffer.isBuffer(gesendet)).toBe(true)
    expect(gesendet.subarray(0, 2).toString()).toBe('PK')
  })

  it('Erfolg, aber Medium nicht ladbar (best effort) → mediumName fällt auf den Slug zurück, Export gelingt trotzdem', async () => {
    ladeAppMock.mockResolvedValue(
      baueApp({
        status: 'in_arbeit',
        stiftungName: 'Stiftung X',
        portal: { final_am: '2026-07-02T00:00:00Z', gesuch_text: 'Text vorhanden.' },
      }),
    )
    ladeMediumMock.mockResolvedValue(null)
    baueDocxMock.mockResolvedValue(FAKE_DOCX_BUFFER)

    const { res, getStatus } = makeRes()
    await gesuchExport(makeReq({ method: 'GET', query: { id: 'app-1' }, cookie: sessionCookie() }), res)

    expect(getStatus()).toBe(200)
    const [args] = baueDocxMock.mock.calls[0] as [Record<string, unknown>]
    expect(args.mediumName).toBe('bajour')
  })
})
