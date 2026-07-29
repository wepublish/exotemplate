/**
 * Logik-Tests für die Portal-Routen: Handler direkt aufgerufen, die
 * Directus-Helfer aus portal-guard gemockt, Session-/Token-Funktionen echt
 * (Muster wie outbox-send.test.ts).
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { erzeugeLoginToken, erzeugeSessionToken, PORTAL_COOKIE } from './portal-session'

// Relativer Pfad statt '@/lib/portal-guard': der SWC-Transform von next/jest
// schreibt nur Import-Statements um, nicht den String im jest.mock-Aufruf,
// und Jests eigener Resolver kennt den '@/'-Alias nicht. Beide Pfade lösen
// auf dieselbe Datei auf, der Mock greift also auch für die Handler-Imports.
jest.mock('./portal-guard', () => {
  const actual = jest.requireActual('./portal-guard')
  return {
    ...actual,
    findePortalZugang: jest.fn(),
    patchePortalZugang: jest.fn(),
    erzeugeZugangsLink: jest.fn(),
    loeseZugangEin: jest.fn(),
    legeAgentVorschlagAn: jest.fn(),
    existiertVorschlagMitDedupKey: jest.fn(),
    ladePortalMedium: jest.fn(),
    hatAktiveMediumDna: jest.fn(),
    ladeWissenFuerMedium: jest.fn(),
    legeWissensEintragAn: jest.fn(),
    // Fragebogen bearbeiten (29.07.2026): die Route liest den bestehenden
    // Eintrag und patcht ihn statt einen zweiten anzulegen.
    ladeFragebogenEintrag: jest.fn(),
    patcheWissensEintrag: jest.fn(),
  }
})

// Ereignis-Protokoll mocken: die Routen schreiben fire-and-forget nach
// medium_events; hier wird nur geprüft, DASS und WOMIT sie es tun.
jest.mock('./medium-events', () => ({ schreibeMediumEvent: jest.fn().mockResolvedValue(undefined) }))

import {
  findePortalZugang,
  patchePortalZugang,
  erzeugeZugangsLink,
  loeseZugangEin,
  legeAgentVorschlagAn,
  existiertVorschlagMitDedupKey,
  ladePortalMedium,
  hatAktiveMediumDna,
  ladeWissenFuerMedium,
  legeWissensEintragAn,
  ladeFragebogenEintrag,
  patcheWissensEintrag,
} from './portal-guard'
import { schreibeMediumEvent } from './medium-events'
import loginAnfordern from '../pages/api/portal/login-anfordern'
import einloesen from '../pages/api/portal/einloesen'
import logout from '../pages/api/portal/logout'
import me from '../pages/api/portal/me'
import wissen from '../pages/api/portal/wissen'

const findeMock = findePortalZugang as jest.Mock
const patchMock = patchePortalZugang as jest.Mock
const erzeugeLinkMock = erzeugeZugangsLink as jest.Mock
const loeseMock = loeseZugangEin as jest.Mock
const vorschlagMock = legeAgentVorschlagAn as jest.Mock
const dedupMock = existiertVorschlagMitDedupKey as jest.Mock
const ladeMock = ladePortalMedium as jest.Mock
const hatDnaMock = hatAktiveMediumDna as jest.Mock
const ladeWissenMock = ladeWissenFuerMedium as jest.Mock
const legeWissenMock = legeWissensEintragAn as jest.Mock
const ladeFragebogenMock = ladeFragebogenEintrag as jest.Mock
const patcheWissenMock = patcheWissensEintrag as jest.Mock
const eventMock = schreibeMediumEvent as jest.Mock

const SECRET = 'routen-test-geheimnis-4711'

const ZUGANG = {
  id: 'z-1',
  email: 'redaktion@bajour.ch',
  mediumSlug: 'bajour',
  status: 'eingeladen',
  loginJti: null,
}

function makeRes() {
  let status = 200
  let body: unknown
  let gesendet: unknown
  let redirect: { status: number; url: string } | null = null
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
    redirect: jest.fn((s: number, u: string) => {
      redirect = { status: s, url: u }
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
    getRedirect: () => redirect as { status: number; url: string } | null,
    getHeaders: () => headers,
  }
}

function makeReq(opts: { method: string; body?: unknown; query?: Record<string, unknown>; cookie?: string }): NextApiRequest {
  return {
    method: opts.method,
    body: opts.body ?? {},
    query: opts.query ?? {},
    headers: opts.cookie ? { cookie: opts.cookie } : {},
  } as unknown as NextApiRequest
}

/** Lässt die fire-and-forget-Nachbearbeitung von login-anfordern durchlaufen. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  process.env.PORTAL_SESSION_SECRET = SECRET
  delete process.env.PORTAL_BASE_URL
  jest.clearAllMocks()
})

afterEach(() => {
  delete process.env.PORTAL_SESSION_SECRET
})

describe('/api/portal/login-anfordern', () => {
  it('GET → 405', async () => {
    const { res, getStatus } = makeRes()
    await loginAnfordern(makeReq({ method: 'GET' }), res)
    expect(getStatus()).toBe(405)
  })

  it('ohne PORTAL_SESSION_SECRET → 503', async () => {
    delete process.env.PORTAL_SESSION_SECRET
    const { res, getStatus, getJson } = makeRes()
    await loginAnfordern(makeReq({ method: 'POST', body: { email: 'a@b.ch' } }), res)
    expect(getStatus()).toBe(503)
    expect(getJson()).toEqual({ error: 'Portal nicht konfiguriert' })
  })

  it('unbekannte E-Mail → {status:ok}, keine Schreibzugriffe', async () => {
    findeMock.mockResolvedValue(null)
    const { res, getStatus, getJson } = makeRes()
    await loginAnfordern(makeReq({ method: 'POST', body: { email: 'unbekannt@x.ch' } }), res)
    await flush()
    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({ status: 'ok' })
    expect(erzeugeLinkMock).not.toHaveBeenCalled()
    expect(vorschlagMock).not.toHaveBeenCalled()
  })

  it('Treffer → sofort {status:ok}, danach erzeugeZugangsLink + Vorschlag (Link in Beschreibung, artefakt_link leer)', async () => {
    findeMock.mockResolvedValue(ZUGANG)
    dedupMock.mockResolvedValue(false)
    erzeugeLinkMock.mockResolvedValue('https://portal.example/api/portal/einloesen?token=abc.def')
    vorschlagMock.mockResolvedValue(undefined)

    const { res, getJson } = makeRes()
    await loginAnfordern(makeReq({ method: 'POST', body: { email: 'redaktion@bajour.ch' } }), res)
    expect(getJson()).toEqual({ status: 'ok' })

    await flush()
    expect(erzeugeLinkMock).toHaveBeenCalledTimes(1)
    expect(erzeugeLinkMock).toHaveBeenCalledWith('z-1', 'redaktion@bajour.ch', 'bajour', SECRET)

    expect(vorschlagMock).toHaveBeenCalledTimes(1)
    const [vorschlag] = vorschlagMock.mock.calls[0] as [Record<string, unknown>]
    expect(vorschlag.typ).toBe('portal')
    expect(vorschlag.artefakt_link).toBeNull()
    expect(String(vorschlag.beschreibung)).toContain('Login-Link')
    expect(String(vorschlag.beschreibung)).toContain('https://portal.example/api/portal/einloesen?token=abc.def')
  })

  it('Dedup greift: Vorschlag existiert schon → kein zweiter Vorschlag, Link trotzdem erzeugt', async () => {
    findeMock.mockResolvedValue(ZUGANG)
    dedupMock.mockResolvedValue(true)
    erzeugeLinkMock.mockResolvedValue('https://portal.example/api/portal/einloesen?token=abc.def')

    const { res, getJson } = makeRes()
    await loginAnfordern(makeReq({ method: 'POST', body: { email: 'redaktion@bajour.ch' } }), res)
    await flush()
    expect(getJson()).toEqual({ status: 'ok' })
    expect(erzeugeLinkMock).toHaveBeenCalledTimes(1)
    expect(vorschlagMock).not.toHaveBeenCalled()
  })

  it('Antwort bleibt {status:ok}, auch wenn die Nachbearbeitung scheitert', async () => {
    findeMock.mockResolvedValue(ZUGANG)
    erzeugeLinkMock.mockRejectedValue(new Error('Directus down'))

    const { res, getStatus, getJson } = makeRes()
    await loginAnfordern(makeReq({ method: 'POST', body: { email: 'redaktion@bajour.ch' } }), res)
    await flush()
    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({ status: 'ok' })
    expect(vorschlagMock).not.toHaveBeenCalled()
  })
})

describe('/api/portal/einloesen GET (Bestätigungsseite, löst NICHT ein)', () => {
  it('ohne token → Redirect auf die Fehlerseite', async () => {
    const { res, getRedirect } = makeRes()
    await einloesen(makeReq({ method: 'GET' }), res)
    expect(getRedirect()).toEqual({ status: 302, url: '/portal/login?fehler=1' })
  })

  it('kaputtes Token → Redirect auf die Fehlerseite', async () => {
    const { res, getRedirect } = makeRes()
    await einloesen(makeReq({ method: 'GET', query: { token: 'kaputt' } }), res)
    expect(getRedirect()).toEqual({ status: 302, url: '/portal/login?fehler=1' })
  })

  it('Session-Token (typ session) wird als Login-Link abgelehnt', async () => {
    const token = erzeugeSessionToken('redaktion@bajour.ch', 'bajour', SECRET)
    const { res, getRedirect } = makeRes()
    await einloesen(makeReq({ method: 'GET', query: { token } }), res)
    expect(getRedirect()).toEqual({ status: 302, url: '/portal/login?fehler=1' })
  })

  it('gültiges Token → HTML-Bestätigungsseite mit POST-Formular und Token als hidden field, KEINE Einlösung', async () => {
    ladeMock.mockResolvedValue({ id: '6', name: 'Bajour', slug: 'bajour', matchingFreigeschaltet: null, dnaFreigabe: null })
    const token = erzeugeLoginToken('redaktion@bajour.ch', 'bajour', 'jti-1', SECRET)

    const { res, getStatus, getSend, getHeaders, getRedirect } = makeRes()
    await einloesen(makeReq({ method: 'GET', query: { token } }), res)

    expect(getRedirect()).toBeNull()
    expect(getStatus()).toBe(200)
    expect(String(getHeaders()['content-type'])).toContain('text/html')
    const html = String(getSend())
    expect(html).toContain('Anmelden im FaaS-Portal')
    expect(html).toContain('Bajour')
    expect(html).toContain('method="post"')
    expect(html).toContain(`value="${token}"`)
    // GET darf den Link nicht verbrennen: keine Einlösung, kein Patch, kein Cookie.
    expect(loeseMock).not.toHaveBeenCalled()
    expect(patchMock).not.toHaveBeenCalled()
    expect(getHeaders()['set-cookie']).toBeUndefined()
  })

  it('Medium-Name nicht ladbar → Seite erscheint trotzdem (Slug als Fallback)', async () => {
    ladeMock.mockRejectedValue(new Error('Directus down'))
    const token = erzeugeLoginToken('redaktion@bajour.ch', 'bajour', 'jti-1', SECRET)

    const { res, getStatus, getSend } = makeRes()
    await einloesen(makeReq({ method: 'GET', query: { token } }), res)
    expect(getStatus()).toBe(200)
    expect(String(getSend())).toContain('bajour')
  })
})

describe('/api/portal/einloesen POST (eigentliche Einlösung)', () => {
  it('gültiges Token + atomare Einlösung → Session-Cookie + Redirect /portal', async () => {
    findeMock.mockResolvedValue(ZUGANG)
    loeseMock.mockResolvedValue(true)
    const token = erzeugeLoginToken('redaktion@bajour.ch', 'bajour', 'jti-1', SECRET)

    const { res, getRedirect, getHeaders } = makeRes()
    await einloesen(makeReq({ method: 'POST', body: { token } }), res)

    expect(loeseMock).toHaveBeenCalledWith('z-1', 'jti-1', expect.any(String))
    const cookie = String(getHeaders()['set-cookie'])
    expect(cookie).toContain(`${PORTAL_COOKIE}=`)
    expect(cookie).toContain('HttpOnly')
    const redirect = getRedirect()
    expect(redirect.status).toBe(302)
    // Ziel ist /portal mit eindeutigem Cache-Buster-Parameter (?e=<ts>), damit
    // der Login an einer evtl. noch gecachten /portal-Seite vorbei frisch startet.
    expect(redirect.url).toMatch(/^\/portal\?e=\d+$/)
    // Roadmap-Ereignis wurde protokolliert.
    expect(eventMock).toHaveBeenCalledWith(
      expect.objectContaining({ medium_id: 'bajour', typ: 'portal_login', actor: 'redaktion@bajour.ch' }),
    )
  })

  it('fehlgeschlagene Einlösung schreibt KEIN portal_login-Ereignis', async () => {
    findeMock.mockResolvedValue(ZUGANG)
    loeseMock.mockResolvedValue(false)
    const token = erzeugeLoginToken('redaktion@bajour.ch', 'bajour', 'jti-alt', SECRET)

    const { res } = makeRes()
    await einloesen(makeReq({ method: 'POST', body: { token } }), res)

    expect(eventMock).not.toHaveBeenCalled()
  })

  it('Einlösung schlägt fehl (jti schon verbraucht) → Fehler-Redirect, kein Cookie', async () => {
    findeMock.mockResolvedValue(ZUGANG)
    loeseMock.mockResolvedValue(false)
    const token = erzeugeLoginToken('redaktion@bajour.ch', 'bajour', 'jti-alt', SECRET)

    const { res, getRedirect, getHeaders } = makeRes()
    await einloesen(makeReq({ method: 'POST', body: { token } }), res)
    expect(getRedirect()).toEqual({ status: 302, url: '/portal/login?fehler=1' })
    expect(getHeaders()['set-cookie']).toBeUndefined()
  })

  it('kein Zugang gefunden → Fehler-Redirect', async () => {
    findeMock.mockResolvedValue(null)
    const token = erzeugeLoginToken('redaktion@bajour.ch', 'bajour', 'jti-1', SECRET)
    const { res, getRedirect } = makeRes()
    await einloesen(makeReq({ method: 'POST', body: { token } }), res)
    expect(getRedirect()).toEqual({ status: 302, url: '/portal/login?fehler=1' })
    expect(loeseMock).not.toHaveBeenCalled()
  })

  it('Medium-Slug im Zugang weicht vom Token ab → Fehler-Redirect', async () => {
    findeMock.mockResolvedValue({ ...ZUGANG, mediumSlug: 'ee-news' })
    const token = erzeugeLoginToken('redaktion@bajour.ch', 'bajour', 'jti-1', SECRET)
    const { res, getRedirect } = makeRes()
    await einloesen(makeReq({ method: 'POST', body: { token } }), res)
    expect(getRedirect()).toEqual({ status: 302, url: '/portal/login?fehler=1' })
    expect(loeseMock).not.toHaveBeenCalled()
  })

  it('POST ohne token → Fehler-Redirect', async () => {
    const { res, getRedirect } = makeRes()
    await einloesen(makeReq({ method: 'POST', body: {} }), res)
    expect(getRedirect()).toEqual({ status: 302, url: '/portal/login?fehler=1' })
  })
})

describe('/api/portal/logout', () => {
  it('POST → Lösch-Cookie + {status:ok}', async () => {
    const { res, getJson, getHeaders } = makeRes()
    await logout(makeReq({ method: 'POST' }), res)
    expect(getJson()).toEqual({ status: 'ok' })
    expect(String(getHeaders()['set-cookie'])).toContain('Max-Age=0')
  })

  it('ohne Secret → 503', async () => {
    delete process.env.PORTAL_SESSION_SECRET
    const { res, getStatus } = makeRes()
    await logout(makeReq({ method: 'POST' }), res)
    expect(getStatus()).toBe(503)
  })
})

describe('/api/portal/me', () => {
  const sessionCookie = () => `${PORTAL_COOKIE}=${erzeugeSessionToken('redaktion@bajour.ch', 'bajour', SECRET)}`

  it('ohne Session → 401', async () => {
    const { res, getStatus } = makeRes()
    await me(makeReq({ method: 'GET' }), res)
    expect(getStatus()).toBe(401)
  })

  it('gültige Session → Medium-Daten mit Freigabe-Booleans, hatDna und hatLogo', async () => {
    ladeMock.mockResolvedValue({
      id: '6',
      name: 'Bajour',
      slug: 'bajour',
      matchingFreigeschaltet: '2026-07-01T00:00:00Z',
      dnaFreigabe: null,
      logoUrl: 'file-abc',
      logoHochgeladen: true,
    })
    hatDnaMock.mockResolvedValue(true)
    const { res, getStatus, getJson } = makeRes()
    await me(makeReq({ method: 'GET', cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({
      email: 'redaktion@bajour.ch',
      medium: { slug: 'bajour', name: 'Bajour' },
      freigeschaltet: true,
      dnaFreigabe: false,
      hatDna: true,
      hatLogo: true,
    })
    expect(hatDnaMock).toHaveBeenCalledWith('bajour')
  })

  it('kein logo_hochgeladen → hatLogo false (Logo-Pflicht-Erststep bleibt gesperrt)', async () => {
    ladeMock.mockResolvedValue({
      id: '6',
      name: 'Bajour',
      slug: 'bajour',
      matchingFreigeschaltet: null,
      dnaFreigabe: null,
      logoUrl: null,
      logoHochgeladen: false,
    })
    hatDnaMock.mockResolvedValue(false)
    const { res, getStatus, getJson } = makeRes()
    await me(makeReq({ method: 'GET', cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(200)
    expect((getJson() as { hatLogo?: boolean }).hatLogo).toBe(false)
  })

  it('logo_url gesetzt (nur Favicon-Auto-Fetch), logo_hochgeladen false → hatLogo bleibt false (Fix-Runde 1, Critical)', async () => {
    ladeMock.mockResolvedValue({
      id: '6',
      name: 'Bajour',
      slug: 'bajour',
      matchingFreigeschaltet: null,
      dnaFreigabe: null,
      logoUrl: 'file-favicon-auto',
      logoHochgeladen: false,
    })
    hatDnaMock.mockResolvedValue(false)
    const { res, getStatus, getJson } = makeRes()
    await me(makeReq({ method: 'GET', cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(200)
    expect((getJson() as { hatLogo?: boolean }).hatLogo).toBe(false)
  })

  it('keine aktive medium_dna → hatDna false (DNA-Nav bleibt gesperrt)', async () => {
    ladeMock.mockResolvedValue({
      id: '9',
      name: 'VMZ',
      slug: 'vmz',
      matchingFreigeschaltet: null,
      dnaFreigabe: null,
    })
    hatDnaMock.mockResolvedValue(false)
    const { res, getStatus, getJson } = makeRes()
    await me(makeReq({ method: 'GET', cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(200)
    expect((getJson() as { hatDna?: boolean }).hatDna).toBe(false)
  })

  it('Directus nicht erreichbar (Rejection) → 502 statt Next-500', async () => {
    ladeMock.mockRejectedValue(new Error('Netz weg'))
    hatDnaMock.mockResolvedValue(false)
    const { res, getStatus, getJson } = makeRes()
    await me(makeReq({ method: 'GET', cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(502)
    expect(getJson()).toEqual({ error: 'Daten momentan nicht verfügbar' })
  })

  it('Medium existiert nicht (mehr) → 404', async () => {
    ladeMock.mockResolvedValue(null)
    hatDnaMock.mockResolvedValue(false)
    const { res, getStatus } = makeRes()
    await me(makeReq({ method: 'GET', cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(404)
  })
})

describe('/api/portal/wissen', () => {
  const sessionCookie = () => `${PORTAL_COOKIE}=${erzeugeSessionToken('redaktion@bajour.ch', 'bajour', SECRET)}`

  it('GET ohne Session → 401', async () => {
    const { res, getStatus } = makeRes()
    await wissen(makeReq({ method: 'GET' }), res)
    expect(getStatus()).toBe(401)
  })

  it('GET: Einträge des Session-Mediums, Zähler + Score korrekt abgeleitet', async () => {
    ladeWissenMock.mockResolvedValue([
      { id: 1, title: 'Artikel A', category: 'published_article', sourceUrl: 'https://bajour.ch/a', autoScraped: true, dateCreated: '2026-07-01T00:00:00Z' },
      { id: 2, title: 'Eigener Text', category: 'general_info', sourceUrl: null, autoScraped: false, dateCreated: '2026-07-02T00:00:00Z' },
    ])
    ladeFragebogenMock.mockResolvedValue(null)
    const { res, getStatus, getJson } = makeRes()
    await wissen(makeReq({ method: 'GET', cookie: sessionCookie() }), res)
    expect(ladeWissenMock).toHaveBeenCalledWith('bajour')
    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({
      eintraege: [
        { id: 1, title: 'Artikel A', category: 'published_article', quelle: 'We.Publish', datum: '2026-07-01T00:00:00Z' },
        { id: 2, title: 'Eigener Text', category: 'general_info', quelle: 'von euch', datum: '2026-07-02T00:00:00Z' },
      ],
      zaehler: { published_article: 1, newsletter: 0, previous_application: 0, general_info: 1 },
      score: 67,
      fragebogen: null,
    })
  })

  it('GET: gespeicherte Fragebogen-Antworten kommen zerlegt mit (Vorbefüllung, 29.07.2026)', async () => {
    ladeWissenMock.mockResolvedValue([])
    ladeFragebogenMock.mockResolvedValue({
      id: 7,
      content: 'Selbstbeschrieb\nWir sind ein Lokalmedium.\n\nNo-Gos\nKeine Werbung.',
      dateUpdated: '2026-07-29T09:00:00Z',
    })
    const { res, getStatus, getJson } = makeRes()
    await wissen(makeReq({ method: 'GET', cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(200)
    expect(getJson().fragebogen).toEqual({
      felder: { selbstbeschrieb: 'Wir sind ein Lokalmedium.', fokus: '', nogos: 'Keine Werbung.' },
      gespeichertAm: '2026-07-29T09:00:00Z',
    })
  })

  it('POST mit bestehendem Fragebogen → überschreibt ihn, legt KEINEN zweiten an', async () => {
    ladeFragebogenMock.mockResolvedValue({ id: 7, content: 'Selbstbeschrieb\nAlt.', dateUpdated: '2026-07-28T09:00:00Z' })
    patcheWissenMock.mockResolvedValue(undefined)
    const { res, getStatus, getJson } = makeRes()
    await wissen(
      makeReq({
        method: 'POST',
        body: { fragebogen: { selbstbeschrieb: 'Neu und besser.', fokus: '', nogos: '' } },
        cookie: sessionCookie(),
      }),
      res,
    )
    expect(getStatus()).toBe(200)
    expect(getJson().aktualisiert).toBe(true)
    expect(getJson().id).toBe(7)
    expect(patcheWissenMock).toHaveBeenCalledTimes(1)
    const [id, data] = patcheWissenMock.mock.calls[0] as [number, Record<string, unknown>]
    expect(id).toBe(7)
    expect(String(data.content)).toContain('Neu und besser.')
    expect(legeWissenMock).not.toHaveBeenCalled()
  })

  it('GET: Directus nicht erreichbar → 502 statt Next-500', async () => {
    ladeWissenMock.mockRejectedValue(new Error('Netz weg'))
    ladeFragebogenMock.mockResolvedValue(null)
    const { res, getStatus, getJson } = makeRes()
    await wissen(makeReq({ method: 'GET', cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(502)
    expect(getJson()).toEqual({ error: 'Daten momentan nicht verfügbar' })
  })

  it('POST ohne Session → 401, kein Schreibzugriff', async () => {
    const { res, getStatus } = makeRes()
    await wissen(makeReq({ method: 'POST', body: { fragebogen: { selbstbeschrieb: 'x', fokus: '', nogos: '' } } }), res)
    expect(getStatus()).toBe(401)
    expect(legeWissenMock).not.toHaveBeenCalled()
  })

  it('POST ohne fragebogen im Body → 422, kein Schreibzugriff', async () => {
    const { res, getStatus, getJson } = makeRes()
    await wissen(makeReq({ method: 'POST', body: {}, cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(422)
    expect(getJson().error).toBeTruthy()
    expect(legeWissenMock).not.toHaveBeenCalled()
  })

  it('POST mit drei leeren Feldern → 422, kein Schreibzugriff', async () => {
    const { res, getStatus } = makeRes()
    await wissen(
      makeReq({ method: 'POST', body: { fragebogen: { selbstbeschrieb: '', fokus: '  ', nogos: '' } }, cookie: sessionCookie() }),
      res,
    )
    expect(getStatus()).toBe(422)
    expect(legeWissenMock).not.toHaveBeenCalled()
  })

  it('POST mit gefülltem Fragebogen → legt medium_knowledge-Eintrag des Session-Mediums an (category general_info, auto_scraped false)', async () => {
    legeWissenMock.mockResolvedValue({ id: 42 })
    ladeFragebogenMock.mockResolvedValue(null)
    const { res, getStatus, getJson } = makeRes()
    await wissen(
      makeReq({
        method: 'POST',
        body: { fragebogen: { selbstbeschrieb: 'Wir sind ein Lokalmedium.', fokus: '', nogos: '' } },
        cookie: sessionCookie(),
      }),
      res,
    )
    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({
      id: 42,
      title: expect.stringMatching(/^Fragebogen \d{4}-\d{2}-\d{2}$/),
      aktualisiert: false,
    })
    expect(legeWissenMock).toHaveBeenCalledTimes(1)
    const [data] = legeWissenMock.mock.calls[0] as [Record<string, unknown>]
    expect(data.medium_id).toBe('bajour')
    expect(data.category).toBe('general_info')
    expect(data.auto_scraped).toBe(false)
    expect(String(data.content)).toContain('Wir sind ein Lokalmedium.')
  })

  it('POST: Directus-Schreibfehler → 502', async () => {
    legeWissenMock.mockRejectedValue(new Error('Directus down'))
    const { res, getStatus, getJson } = makeRes()
    await wissen(
      makeReq({ method: 'POST', body: { fragebogen: { selbstbeschrieb: 'x', fokus: '', nogos: '' } }, cookie: sessionCookie() }),
      res,
    )
    expect(getStatus()).toBe(502)
    expect(getJson()).toEqual({ error: 'Daten momentan nicht verfügbar' })
  })

  it('DELETE → 405', async () => {
    const { res, getStatus } = makeRes()
    await wissen(makeReq({ method: 'DELETE', cookie: sessionCookie() }), res)
    expect(getStatus()).toBe(405)
  })
})
