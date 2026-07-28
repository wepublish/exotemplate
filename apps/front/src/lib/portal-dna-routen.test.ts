/**
 * Logik-Tests für die Portal-DNA-Routen (Task 7): Handler direkt aufgerufen,
 * die Directus-Helfer aus portal-guard, der Starter aus generate-dna.ts und
 * der Job-Leser aus generate-dna-jobs gemockt (Muster wie portal-routen.test.ts).
 *
 * Relative Pfade statt '@/lib/...'/'@/pages/...' in den jest.mock-Aufrufen:
 * next/jest schreibt nur Import-Statements um, nicht den String im
 * jest.mock-Aufruf; beide Pfade lösen auf dieselbe Datei auf.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { erzeugeSessionToken, PORTAL_COOKIE } from './portal-session'

jest.mock('./portal-guard', () => {
  const actual = jest.requireActual('./portal-guard')
  return {
    ...actual,
    ladePortalMedium: jest.fn(),
    ladeAktiveDnaDetails: jest.fn(),
    ladeArbeitsDnaProfil: jest.fn(),
    setzeDnaFreigabe: jest.fn(),
    legeAgentVorschlagAn: jest.fn(),
  }
})

jest.mock('../pages/api/medium-knowledge/generate-dna', () => ({
  starteGenerateDnaJob: jest.fn(),
}))

jest.mock('./generate-dna-jobs', () => ({
  getGenerateJob: jest.fn(),
}))

// Ereignis-Protokoll mocken: geprüft wird nur, DASS und WOMIT geschrieben wird.
jest.mock('./medium-events', () => ({ schreibeMediumEvent: jest.fn().mockResolvedValue(undefined) }))

import {
  ladePortalMedium,
  ladeAktiveDnaDetails,
  ladeArbeitsDnaProfil,
  setzeDnaFreigabe,
  legeAgentVorschlagAn,
} from './portal-guard'
import { starteGenerateDnaJob } from '../pages/api/medium-knowledge/generate-dna'
import { getGenerateJob } from './generate-dna-jobs'
import { schreibeMediumEvent } from './medium-events'
import dnaErzeugen from '../pages/api/portal/dna-erzeugen'
import dna from '../pages/api/portal/dna'

const ladeMediumMock = ladePortalMedium as jest.Mock
const ladeDnaMock = ladeAktiveDnaDetails as jest.Mock
const ladeProfilMock = ladeArbeitsDnaProfil as jest.Mock
const setzeFreigabeMock = setzeDnaFreigabe as jest.Mock
const vorschlagMock = legeAgentVorschlagAn as jest.Mock
const starteMock = starteGenerateDnaJob as jest.Mock
const getJobMock = getGenerateJob as jest.Mock
const eventMock = schreibeMediumEvent as jest.Mock

const SECRET = 'dna-routen-test-geheimnis-4711'

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

function makeReq(opts: { method: string; body?: unknown; query?: Record<string, unknown>; cookie?: string }): NextApiRequest {
  return {
    method: opts.method,
    body: opts.body ?? {},
    query: opts.query ?? {},
    headers: opts.cookie ? { cookie: opts.cookie } : {},
  } as unknown as NextApiRequest
}

const sessionCookie = () => `${PORTAL_COOKIE}=${erzeugeSessionToken('redaktion@bajour.ch', 'bajour', SECRET)}`

beforeEach(() => {
  process.env.PORTAL_SESSION_SECRET = SECRET
  jest.clearAllMocks()
})

afterEach(() => {
  delete process.env.PORTAL_SESSION_SECRET
})

// ─── /api/portal/dna-erzeugen ─────────────────────────────────────────────────

describe('/api/portal/dna-erzeugen', () => {
  it('ohne Session → 401', async () => {
    const { res, getStatus } = makeRes()
    await dnaErzeugen(makeReq({ method: 'POST' }), res)
    expect(getStatus()).toBe(401)
  })

  it('ohne PORTAL_SESSION_SECRET → 503', async () => {
    delete process.env.PORTAL_SESSION_SECRET
    const { res, getStatus } = makeRes()
    await dnaErzeugen(makeReq({ method: 'POST' }), res)
    expect(getStatus()).toBe(503)
  })

  const MEDIUM_MIT_LOGO = { id: '6', name: 'Bajour', slug: 'bajour', matchingFreigeschaltet: null, dnaFreigabe: null, logoUrl: 'file-abc', logoHochgeladen: true }

  it('POST: startet den Job für session.mediumSlug, NIE aus dem Body', async () => {
    ladeMediumMock.mockResolvedValue(MEDIUM_MIT_LOGO)
    starteMock.mockResolvedValue({ jobId: 'job-9', running: false })
    const { res, getStatus, getJson } = makeRes()

    await dnaErzeugen(makeReq({ method: 'POST', body: { medium_id: 'ein-anderes-medium' }, cookie: sessionCookie() }), res)

    expect(ladeMediumMock).toHaveBeenCalledWith('bajour')
    expect(starteMock).toHaveBeenCalledWith('bajour')
    expect(getStatus()).toBe(202)
    expect(getJson()).toEqual({ job_id: 'job-9', status: 'running' })
  })

  it('POST: bereits laufender Job → 200 statt 202', async () => {
    ladeMediumMock.mockResolvedValue(MEDIUM_MIT_LOGO)
    starteMock.mockResolvedValue({ jobId: 'job-9', running: true })
    const { res, getStatus, getJson } = makeRes()

    await dnaErzeugen(makeReq({ method: 'POST', cookie: sessionCookie() }), res)

    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({ job_id: 'job-9', status: 'running' })
  })

  it('POST: Starter meldet Fehler → 400', async () => {
    ladeMediumMock.mockResolvedValue(MEDIUM_MIT_LOGO)
    starteMock.mockResolvedValue({ fehler: 'medium_id (string) erforderlich' })
    const { res, getStatus, getJson } = makeRes()

    await dnaErzeugen(makeReq({ method: 'POST', cookie: sessionCookie() }), res)

    expect(getStatus()).toBe(400)
    expect(getJson()).toEqual({ error: 'medium_id (string) erforderlich' })
  })

  // ── Logo-Gate (Fix-Runde 1, Important) ───────────────────────────────────

  it('POST: kein logo_hochgeladen → 403, KEIN Job gestartet', async () => {
    ladeMediumMock.mockResolvedValue({ ...MEDIUM_MIT_LOGO, logoUrl: null, logoHochgeladen: false })
    const { res, getStatus, getJson } = makeRes()

    await dnaErzeugen(makeReq({ method: 'POST', cookie: sessionCookie() }), res)

    expect(getStatus()).toBe(403)
    expect(getJson()).toEqual({ error: 'Bitte ladet zuerst euer Logo hoch, dann kümmern wir uns um eure DNA.' })
    expect(starteMock).not.toHaveBeenCalled()
  })

  it('POST: logo_url gesetzt (nur Favicon-Auto-Fetch), logo_hochgeladen false → weiterhin 403 (Provenienz, nicht blosse Anwesenheit)', async () => {
    ladeMediumMock.mockResolvedValue({ ...MEDIUM_MIT_LOGO, logoUrl: 'file-favicon-auto', logoHochgeladen: false })
    const { res, getStatus } = makeRes()

    await dnaErzeugen(makeReq({ method: 'POST', cookie: sessionCookie() }), res)

    expect(getStatus()).toBe(403)
    expect(starteMock).not.toHaveBeenCalled()
  })

  it('POST: Medium der Session existiert nicht (mehr) → 404, KEIN Job gestartet', async () => {
    ladeMediumMock.mockResolvedValue(null)
    const { res, getStatus } = makeRes()

    await dnaErzeugen(makeReq({ method: 'POST', cookie: sessionCookie() }), res)

    expect(getStatus()).toBe(404)
    expect(starteMock).not.toHaveBeenCalled()
  })

  it('POST: Directus beim Logo-Gate-Lookup nicht erreichbar → 502, KEIN Job gestartet', async () => {
    ladeMediumMock.mockRejectedValue(new Error('Netz weg'))
    const { res, getStatus } = makeRes()

    await dnaErzeugen(makeReq({ method: 'POST', cookie: sessionCookie() }), res)

    expect(getStatus()).toBe(502)
    expect(starteMock).not.toHaveBeenCalled()
  })

  it('GET ohne job_id → 400', async () => {
    const { res, getStatus } = makeRes()
    await dnaErzeugen(makeReq({ method: 'GET', cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(400)
  })

  it('GET mit job_id eines ANDEREN Mediums → 404 (kein Cross-Medium-Einblick)', async () => {
    getJobMock.mockResolvedValue({ id: 'job-9', medium_id: 'ein-fremdes-medium', status: 'running', phase: 'sammeln', startedAt: '2026-07-09T08:00:00.000Z' })
    const { res, getStatus } = makeRes()

    await dnaErzeugen(makeReq({ method: 'GET', query: { job_id: 'job-9' }, cookie: sessionCookie() }), res)

    expect(getStatus()).toBe(404)
  })

  it('GET mit unbekannter job_id → 404', async () => {
    getJobMock.mockResolvedValue(undefined)
    const { res, getStatus } = makeRes()
    await dnaErzeugen(makeReq({ method: 'GET', query: { job_id: 'unbekannt' }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(404)
  })

  it('GET mit job_id des eigenen Mediums → 200 mit Job-Status', async () => {
    getJobMock.mockResolvedValue({
      id: 'job-9',
      medium_id: 'bajour',
      status: 'done',
      phase: 'fertig',
      startedAt: '2026-07-09T08:00:00.000Z',
      result: { sound_feeling: 'x' },
    })
    const { res, getStatus, getJson } = makeRes()

    await dnaErzeugen(makeReq({ method: 'GET', query: { job_id: 'job-9' }, cookie: sessionCookie() }), res)

    expect(getStatus()).toBe(200)
    expect(getJson()).toMatchObject({ id: 'job-9', medium_id: 'bajour', status: 'done', phase: 'fertig' })
    expect(getJson().result).toEqual({ sound_feeling: 'x' })
  })

  it('andere Methode → 405', async () => {
    const { res, getStatus } = makeRes()
    await dnaErzeugen(makeReq({ method: 'DELETE', cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(405)
  })
})

// ─── /api/portal/dna ──────────────────────────────────────────────────────────

const AKTIVE_DNA = {
  id: 12,
  version: 3,
  soundFeeling: 'Bajour ist unabhängiger Lokaljournalismus für Basel.',
  tags: [{ tag_slug: 'geo_basel', gewicht: 3, begruendung: 'Basler Lokaljournalismus im Zentrum.' }],
  schaerfe: 74,
  aktivSeit: '2026-07-01T08:00:00.000Z',
  hatteCrawl: true,
}

describe('GET /api/portal/dna', () => {
  it('ohne Session → 401', async () => {
    const { res, getStatus } = makeRes()
    await dna(makeReq({ method: 'GET' }), res)
    expect(getStatus()).toBe(401)
  })

  it('ohne PORTAL_SESSION_SECRET → 503', async () => {
    delete process.env.PORTAL_SESSION_SECRET
    const { res, getStatus } = makeRes()
    await dna(makeReq({ method: 'GET' }), res)
    expect(getStatus()).toBe(503)
  })

  it('andere Methode → 405', async () => {
    const { res, getStatus } = makeRes()
    await dna(makeReq({ method: 'DELETE', cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(405)
  })

  it('keine aktive DNA: {dna:null, freigegeben:false, freigegebenAm:null}, KEIN Fehler', async () => {
    ladeMediumMock.mockResolvedValue({ id: '6', name: 'Bajour', slug: 'bajour', matchingFreigeschaltet: null, dnaFreigabe: null })
    ladeDnaMock.mockResolvedValue(null)
    const { res, getStatus, getJson } = makeRes()

    await dna(makeReq({ method: 'GET', cookie: sessionCookie() }), res)

    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({ dna: null, freigegeben: false, freigegebenAm: null, pdfDaten: null })
    expect(ladeProfilMock).not.toHaveBeenCalled()
  })

  it('aktive DNA + Freigabe gesetzt: schlanke Ansicht + pdfDaten (mit Arbeits-DNA-Profil)', async () => {
    ladeMediumMock.mockResolvedValue({ id: '6', name: 'Bajour', slug: 'bajour', matchingFreigeschaltet: null, dnaFreigabe: '2026-07-05T09:00:00.000Z' })
    ladeDnaMock.mockResolvedValue(AKTIVE_DNA)
    ladeProfilMock.mockResolvedValue({
      dna_summary: 'Zusammenfassung',
      core_themes: ['Lokaljournalismus'],
      editorial_stance: [],
      societal_impact: [],
      target_groups: [],
      geographic_focus: '',
      funding_keywords: [],
      grant_strengths: [],
      matching_foundation_themes: [],
    })
    const { res, getStatus, getJson } = makeRes()

    await dna(makeReq({ method: 'GET', cookie: sessionCookie() }), res)

    expect(getStatus()).toBe(200)
    const json = getJson()
    expect(json.freigegeben).toBe(true)
    expect(json.freigegebenAm).toBe('2026-07-05T09:00:00.000Z')
    expect(json.dna).toEqual({
      soundFeeling: AKTIVE_DNA.soundFeeling,
      tags: [{ slug: 'geo_basel', label: 'Basel' }],
      schaerfe: 74,
      aktivSeit: '2026-07-01T08:00:00.000Z',
    })
    expect(json.pdfDaten).toMatchObject({ id: 12, version: 3, tag_count: 1, hatte_crawl: true })
    expect((json.pdfDaten as Record<string, unknown>).quellen).toBeUndefined()
  })

  it('Medium nicht gefunden → 404', async () => {
    ladeMediumMock.mockResolvedValue(null)
    ladeDnaMock.mockResolvedValue(null)
    const { res, getStatus } = makeRes()
    await dna(makeReq({ method: 'GET', cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(404)
  })

  it('Directus nicht erreichbar → 502', async () => {
    ladeMediumMock.mockRejectedValue(new Error('Netz weg'))
    ladeDnaMock.mockResolvedValue(null)
    const { res, getStatus } = makeRes()
    await dna(makeReq({ method: 'GET', cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(502)
  })
})

describe('POST /api/portal/dna {aktion:"freigeben"}', () => {
  it('keine aktive DNA → 409, kein PATCH, kein Vorschlag', async () => {
    ladeDnaMock.mockResolvedValue(null)
    const { res, getStatus } = makeRes()

    await dna(makeReq({ method: 'POST', body: { aktion: 'freigeben' }, cookie: sessionCookie() }), res)

    expect(getStatus()).toBe(409)
    expect(setzeFreigabeMock).not.toHaveBeenCalled()
    expect(vorschlagMock).not.toHaveBeenCalled()
  })

  it('falsche/fehlende aktion → 422', async () => {
    const { res, getStatus } = makeRes()
    await dna(makeReq({ method: 'POST', body: { aktion: 'irgendwas' }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(422)
  })

  it('aktive DNA vorhanden: PATCH faas_medien + agent_vorschlaege-Zeile, 200', async () => {
    ladeDnaMock.mockResolvedValue(AKTIVE_DNA)
    setzeFreigabeMock.mockResolvedValue(undefined)
    vorschlagMock.mockResolvedValue(undefined)
    const { res, getStatus, getJson } = makeRes()

    await dna(makeReq({ method: 'POST', body: { aktion: 'freigeben' }, cookie: sessionCookie() }), res)

    expect(getStatus()).toBe(200)
    expect((getJson() as { status: string }).status).toBe('ok')

    expect(setzeFreigabeMock).toHaveBeenCalledTimes(1)
    const [slug, wer] = setzeFreigabeMock.mock.calls[0] as [string, string, string]
    expect(slug).toBe('bajour')
    expect(wer).toBe('redaktion@bajour.ch')

    expect(vorschlagMock).toHaveBeenCalledTimes(1)
    const [vorschlag] = vorschlagMock.mock.calls[0] as [Record<string, unknown>]
    expect(vorschlag.typ).toBe('portal')
    expect(String(vorschlag.titel)).toBe('DNA freigegeben: bajour')
    expect(String(vorschlag.beschreibung)).toContain('Matching-Freischaltung prüfen')

    // Roadmap-Ereignis wurde protokolliert.
    expect(eventMock).toHaveBeenCalledWith(
      expect.objectContaining({ medium_id: 'bajour', typ: 'dna_freigegeben', actor: 'redaktion@bajour.ch' }),
    )
  })

  it('keine aktive DNA (409) → KEIN dna_freigegeben-Ereignis', async () => {
    ladeDnaMock.mockResolvedValue(null)
    const { res, getStatus } = makeRes()

    await dna(makeReq({ method: 'POST', body: { aktion: 'freigeben' }, cookie: sessionCookie() }), res)

    expect(getStatus()).toBe(409)
    expect(eventMock).not.toHaveBeenCalled()
  })
})
