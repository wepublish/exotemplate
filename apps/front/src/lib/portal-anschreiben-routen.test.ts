/**
 * Logik-Tests für die Consent-Flow-Routen (Task 9, Fix-Runde 1):
 * /api/portal/anschreiben und /api/portal/nicht-relevant. Handler direkt
 * aufgerufen, die Directus-Helfer aus portal-guard gemockt (Muster wie
 * portal-dna-routen.test.ts / portal-routen.test.ts).
 *
 * Relative Pfade statt '@/lib/...'/'@/pages/...' in den jest.mock-Aufrufen:
 * next/jest schreibt nur Import-Statements um, nicht den String im
 * jest.mock-Aufruf; beide Pfade lösen auf dieselbe Datei auf.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { erzeugeSessionToken, PORTAL_COOKIE } from './portal-session'
import { CONSENT_TEXT_VERSION } from './consent'
import { STATUS_STATION } from '../graphql/applications.mutations'

jest.mock('./portal-guard', () => {
  const actual = jest.requireActual('./portal-guard')
  return {
    ...actual,
    ladePortalMedium: jest.fn(),
    existiertOffeneApplication: jest.fn(),
    ladeConsentLogs: jest.fn(),
    legeApplicationAn: jest.fn(),
    legeConsentLogAn: jest.fn(),
    ladeStiftungName: jest.fn(),
    legeAgentVorschlagAn: jest.fn(),
    existiertVorschlagMitDedupKey: jest.fn(),
    legeAgentLessonAn: jest.fn(),
  }
})

import {
  ladePortalMedium,
  existiertOffeneApplication,
  ladeConsentLogs,
  legeApplicationAn,
  legeConsentLogAn,
  ladeStiftungName,
  legeAgentVorschlagAn,
  existiertVorschlagMitDedupKey,
  legeAgentLessonAn,
} from './portal-guard'
import anschreiben from '../pages/api/portal/anschreiben'
import nichtRelevant from '../pages/api/portal/nicht-relevant'

const ladeMediumMock = ladePortalMedium as jest.Mock
const existiertOffenMock = existiertOffeneApplication as jest.Mock
const ladeConsentLogsMock = ladeConsentLogs as jest.Mock
const legeApplicationMock = legeApplicationAn as jest.Mock
const legeConsentLogMock = legeConsentLogAn as jest.Mock
const ladeStiftungMock = ladeStiftungName as jest.Mock
const legeVorschlagMock = legeAgentVorschlagAn as jest.Mock
const existiertVorschlagMock = existiertVorschlagMitDedupKey as jest.Mock
const legeLessonMock = legeAgentLessonAn as jest.Mock

const SECRET = 'anschreiben-routen-test-geheimnis-4711'

const MEDIUM = {
  id: '6',
  name: 'Bajour',
  slug: 'bajour',
  matchingFreigeschaltet: '2026-07-01T00:00:00Z',
  dnaFreigabe: null,
}

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

beforeEach(() => {
  process.env.PORTAL_SESSION_SECRET = SECRET
  jest.clearAllMocks()
})

afterEach(() => {
  delete process.env.PORTAL_SESSION_SECRET
})

// ─── /api/portal/anschreiben ───────────────────────────────────────────────────

describe('/api/portal/anschreiben', () => {
  it('andere Methode → 405', async () => {
    const { res, getStatus } = makeRes()
    await anschreiben(makeReq({ method: 'GET' }), res)
    expect(getStatus()).toBe(405)
  })

  it('ohne Session → 401, kein Schreibzugriff', async () => {
    const { res, getStatus } = makeRes()
    await anschreiben(makeReq({ method: 'POST', body: { stiftung_id: 1 } }), res)
    expect(getStatus()).toBe(401)
    expect(ladeMediumMock).not.toHaveBeenCalled()
  })

  it('ohne stiftung_id (gültige Zahl) → 400', async () => {
    const { res, getStatus } = makeRes()
    await anschreiben(makeReq({ method: 'POST', body: {}, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(400)
  })

  it('Medium nicht gefunden → 404', async () => {
    ladeMediumMock.mockResolvedValue(null)
    const { res, getStatus } = makeRes()
    await anschreiben(makeReq({ method: 'POST', body: { stiftung_id: 1 }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(404)
  })

  it('Matching noch nicht freigeschaltet → 403', async () => {
    ladeMediumMock.mockResolvedValue({ ...MEDIUM, matchingFreigeschaltet: null })
    const { res, getStatus, getJson } = makeRes()
    await anschreiben(makeReq({ method: 'POST', body: { stiftung_id: 1 }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(403)
    expect(getJson()).toEqual({ grund: 'noch_nicht_freigeschaltet' })
  })

  it('bereits eine offene Application für dieses Paar → 409 bereits_vorhanden, kein Consent-Check, kein Write', async () => {
    ladeMediumMock.mockResolvedValue(MEDIUM)
    existiertOffenMock.mockResolvedValue(true)
    const { res, getStatus, getJson } = makeRes()
    await anschreiben(makeReq({ method: 'POST', body: { stiftung_id: 8466 }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(409)
    expect(getJson()).toEqual({ bereits_vorhanden: true })
    expect(ladeConsentLogsMock).not.toHaveBeenCalled()
    expect(legeConsentLogMock).not.toHaveBeenCalled()
    expect(legeApplicationMock).not.toHaveBeenCalled()
  })

  it('Voll-Consent nötig (leere Logs), consent_bestaetigt fehlt → 409 consent_noetig mit Volltext, kein Write (Fix-Runde 1)', async () => {
    ladeMediumMock.mockResolvedValue(MEDIUM)
    existiertOffenMock.mockResolvedValue(false)
    ladeConsentLogsMock.mockResolvedValue([])
    const { res, getStatus, getJson } = makeRes()
    await anschreiben(makeReq({ method: 'POST', body: { stiftung_id: 8466 }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(409)
    const json = getJson()
    expect(json.consent_noetig).toBe(true)
    expect(json.consent_kurz).toBeUndefined()
    expect(typeof json.text).toBe('string')
    expect((json.text as string).length).toBeGreaterThan(0)
    expect(legeConsentLogMock).not.toHaveBeenCalled()
    expect(legeApplicationMock).not.toHaveBeenCalled()
  })

  it('Folge-Gesuch (Consent der aktuellen Version liegt schon vor), consent_bestaetigt fehlt → 409 consent_kurz OHNE Volltext, kein Write (Fix-Runde 1, Important 1)', async () => {
    ladeMediumMock.mockResolvedValue(MEDIUM)
    existiertOffenMock.mockResolvedValue(false)
    ladeConsentLogsMock.mockResolvedValue([{ text_version: CONSENT_TEXT_VERSION, kontext: 'erstgesuch' }])
    const { res, getStatus, getJson } = makeRes()
    await anschreiben(makeReq({ method: 'POST', body: { stiftung_id: 9051 }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(409)
    expect(getJson()).toEqual({ consent_kurz: true })
    expect(legeConsentLogMock).not.toHaveBeenCalled()
    expect(legeApplicationMock).not.toHaveBeenCalled()
  })

  it('Erfolg (erstes Gesuch, consent_bestaetigt:true): consent_log ZUERST (kontext erstgesuch), dann Application MIT eingebettetem portal.consent_id, agent_vorschlaege angelegt (Important 2)', async () => {
    ladeMediumMock.mockResolvedValue(MEDIUM)
    existiertOffenMock.mockResolvedValue(false)
    ladeConsentLogsMock.mockResolvedValue([])
    legeConsentLogMock.mockResolvedValue({ id: 'consent-99' })
    ladeStiftungMock.mockResolvedValue('Stiftung Convivium')
    legeApplicationMock.mockResolvedValue({ id: 'app-1' })
    existiertVorschlagMock.mockResolvedValue(false)
    legeVorschlagMock.mockResolvedValue(undefined)

    const { res, getStatus, getJson } = makeRes()
    await anschreiben(
      makeReq({ method: 'POST', body: { stiftung_id: 8466, consent_bestaetigt: true }, cookie: sessionCookie() }),
      res,
    )

    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({ status: 'ok', application_id: 'app-1' })

    // Selbstheilender Write (Important 2): consent_log VOR application, nie umgekehrt.
    expect(legeConsentLogMock).toHaveBeenCalledTimes(1)
    expect(legeApplicationMock).toHaveBeenCalledTimes(1)
    expect(legeConsentLogMock.mock.invocationCallOrder[0]).toBeLessThan(legeApplicationMock.mock.invocationCallOrder[0])

    const [consentPayload] = legeConsentLogMock.mock.calls[0] as [Record<string, unknown>]
    expect(consentPayload.kontext).toBe('erstgesuch')
    expect(consentPayload.medium_slug).toBe('bajour')
    expect(consentPayload.text_version).toBe(CONSENT_TEXT_VERSION)

    const [appPayload] = legeApplicationMock.mock.calls[0] as [Record<string, unknown>]
    expect(appPayload.status).toBe('identifiziert')
    expect(appPayload.stiftung_name).toBe('Stiftung Convivium')
    expect(appPayload.medium_id).toBe('bajour')
    expect(appPayload.portal).toEqual(
      expect.objectContaining({ consent_id: 'consent-99', angefordert_von: 'redaktion@bajour.ch' }),
    )

    expect(legeVorschlagMock).toHaveBeenCalledTimes(1)
    const [vorschlag] = legeVorschlagMock.mock.calls[0] as [Record<string, unknown>]
    expect(vorschlag.dedup_key).toBe('portal|anschreiben|bajour|8466')
    expect(String(vorschlag.titel)).toContain('Stiftung Convivium')
  })

  it('Erfolg (Folge-Gesuch, consent_bestaetigt:true): kontext gesuch:<stiftung_id> (dokumentierte Abweichung vom Brief-gesuch:<app-id>)', async () => {
    ladeMediumMock.mockResolvedValue(MEDIUM)
    existiertOffenMock.mockResolvedValue(false)
    ladeConsentLogsMock.mockResolvedValue([{ text_version: CONSENT_TEXT_VERSION, kontext: 'erstgesuch' }])
    legeConsentLogMock.mockResolvedValue({ id: 'consent-100' })
    ladeStiftungMock.mockResolvedValue('Stiftung X')
    legeApplicationMock.mockResolvedValue({ id: 'app-2' })
    existiertVorschlagMock.mockResolvedValue(false)

    const { res, getStatus } = makeRes()
    await anschreiben(
      makeReq({ method: 'POST', body: { stiftung_id: 9051, consent_bestaetigt: true }, cookie: sessionCookie() }),
      res,
    )
    expect(getStatus()).toBe(200)
    const [consentPayload] = legeConsentLogMock.mock.calls[0] as [Record<string, unknown>]
    expect(consentPayload.kontext).toBe('gesuch:9051')
  })

  it('Dedup greift: bereits ein Vorschlag mit diesem Schlüssel → kein zweiter agent_vorschlag, Application trotzdem angelegt', async () => {
    ladeMediumMock.mockResolvedValue(MEDIUM)
    existiertOffenMock.mockResolvedValue(false)
    ladeConsentLogsMock.mockResolvedValue([])
    legeConsentLogMock.mockResolvedValue({ id: 'consent-1' })
    ladeStiftungMock.mockResolvedValue('Stiftung X')
    legeApplicationMock.mockResolvedValue({ id: 'app-3' })
    existiertVorschlagMock.mockResolvedValue(true)

    const { res, getStatus } = makeRes()
    await anschreiben(
      makeReq({ method: 'POST', body: { stiftung_id: 1, consent_bestaetigt: true }, cookie: sessionCookie() }),
      res,
    )
    expect(getStatus()).toBe(200)
    expect(legeApplicationMock).toHaveBeenCalledTimes(1)
    expect(legeVorschlagMock).not.toHaveBeenCalled()
  })

  it('Schreibfehler (legeApplicationAn wirft, verwaiste consent_log-Zeile bleibt harmlos) → 502', async () => {
    ladeMediumMock.mockResolvedValue(MEDIUM)
    existiertOffenMock.mockResolvedValue(false)
    ladeConsentLogsMock.mockResolvedValue([])
    legeConsentLogMock.mockResolvedValue({ id: 'consent-1' })
    ladeStiftungMock.mockResolvedValue('Stiftung X')
    legeApplicationMock.mockRejectedValue(new Error('Directus down'))

    const { res, getStatus, getJson } = makeRes()
    await anschreiben(
      makeReq({ method: 'POST', body: { stiftung_id: 1, consent_bestaetigt: true }, cookie: sessionCookie() }),
      res,
    )
    expect(getStatus()).toBe(502)
    expect(getJson()).toEqual({ error: 'Daten momentan nicht verfügbar' })
    expect(legeConsentLogMock).toHaveBeenCalledTimes(1)
  })
})

// ─── /api/portal/nicht-relevant ─────────────────────────────────────────────────

describe('/api/portal/nicht-relevant', () => {
  it('andere Methode → 405', async () => {
    const { res, getStatus } = makeRes()
    await nichtRelevant(makeReq({ method: 'GET' }), res)
    expect(getStatus()).toBe(405)
  })

  it('ohne Session → 401, kein Schreibzugriff', async () => {
    const { res, getStatus } = makeRes()
    await nichtRelevant(makeReq({ method: 'POST', body: { stiftung_id: 1, grund: 'passt_nicht' } }), res)
    expect(getStatus()).toBe(401)
    expect(legeApplicationMock).not.toHaveBeenCalled()
  })

  it('ohne stiftung_id → 400', async () => {
    const { res, getStatus } = makeRes()
    await nichtRelevant(makeReq({ method: 'POST', body: { grund: 'passt_nicht' }, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(400)
  })

  it('ungültiger grund → 400', async () => {
    const { res, getStatus } = makeRes()
    await nichtRelevant(
      makeReq({ method: 'POST', body: { stiftung_id: 1, grund: 'nicht_im_katalog' }, cookie: sessionCookie() }),
      res,
    )
    expect(getStatus()).toBe(400)
  })

  it('Medium nicht gefunden → 404', async () => {
    ladeMediumMock.mockResolvedValue(null)
    const { res, getStatus } = makeRes()
    await nichtRelevant(
      makeReq({ method: 'POST', body: { stiftung_id: 1, grund: 'passt_nicht' }, cookie: sessionCookie() }),
      res,
    )
    expect(getStatus()).toBe(404)
  })

  it('Matching noch nicht freigeschaltet → 403', async () => {
    ladeMediumMock.mockResolvedValue({ ...MEDIUM, matchingFreigeschaltet: null })
    const { res, getStatus } = makeRes()
    await nichtRelevant(
      makeReq({ method: 'POST', body: { stiftung_id: 1, grund: 'passt_nicht' }, cookie: sessionCookie() }),
      res,
    )
    expect(getStatus()).toBe(403)
  })

  it('Erfolg: Marker-Application (status ausgeblendet) + agent_lesson mit quelle portal', async () => {
    ladeMediumMock.mockResolvedValue(MEDIUM)
    ladeStiftungMock.mockResolvedValue('Edi und Brigitt Gysi Stiftung')
    legeApplicationMock.mockResolvedValue({ id: 'app-9' })
    legeLessonMock.mockResolvedValue(undefined)

    const { res, getStatus, getJson } = makeRes()
    await nichtRelevant(
      makeReq({
        method: 'POST',
        body: { stiftung_id: 9051, grund: 'passt_nicht', freitext: 'Nicht unser Fokus' },
        cookie: sessionCookie(),
      }),
      res,
    )

    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({ status: 'ok' })

    expect(legeApplicationMock).toHaveBeenCalledTimes(1)
    const [appPayload] = legeApplicationMock.mock.calls[0] as [Record<string, unknown>]
    expect(appPayload.status).toBe('ausgeblendet')
    expect(appPayload.station).toBe(STATUS_STATION.ausgeblendet)
    expect(appPayload.stiftung_id).toBe(9051)
    expect(appPayload.zuletzt_geaendert_quelle).toBe('portal')
    expect(String(appPayload.bemerkung)).toContain('Edi und Brigitt Gysi Stiftung')
    expect(String(appPayload.bemerkung)).toContain('Passt inhaltlich nicht')

    expect(legeLessonMock).toHaveBeenCalledTimes(1)
    const [lessonPayload] = legeLessonMock.mock.calls[0] as [Record<string, unknown>]
    expect(lessonPayload.quelle).toBe('portal')
    expect(lessonPayload.kategorie).toBe('passt_nicht')
  })

  it('Directus-Schreibfehler → 502', async () => {
    ladeMediumMock.mockResolvedValue(MEDIUM)
    ladeStiftungMock.mockResolvedValue('Stiftung X')
    legeApplicationMock.mockRejectedValue(new Error('Directus down'))

    const { res, getStatus, getJson } = makeRes()
    await nichtRelevant(
      makeReq({ method: 'POST', body: { stiftung_id: 1, grund: 'passt_nicht' }, cookie: sessionCookie() }),
      res,
    )
    expect(getStatus()).toBe(502)
    expect(getJson()).toEqual({ error: 'Daten momentan nicht verfügbar' })
  })
})
