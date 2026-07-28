import type { NextApiRequest, NextApiResponse } from 'next'
import {
  getPortalSession,
  requirePortalSession,
  holeSecretOderAntworte503,
  istPortalZugriffAufProxy,
  ladePortalMedium,
  hatAktiveMediumDna,
  findePortalZugang,
  patchePortalZugang,
  loeseZugangEin,
  legeAgentVorschlagAn,
  existiertVorschlagMitDedupKey,
  baueLoginDedupKey,
  baueLoginVorschlag,
  erzeugeZugangsLink,
} from './portal-guard'
import { erzeugeSessionToken, verifyToken, PORTAL_COOKIE } from './portal-session'

const SECRET = 'guard-test-geheimnis-9999'

type ResJson = Record<string, unknown>

function makeRes(): { res: NextApiResponse; getStatus: () => number; getJson: () => ResJson } {
  let status = 200
  let body: ResJson = {}
  const res = {
    status: jest.fn((s: number) => {
      status = s
      return res
    }),
    json: jest.fn((j: ResJson) => {
      body = j
      return res
    }),
  } as unknown as NextApiResponse
  return { res, getStatus: () => status, getJson: () => body }
}

function makeReq(cookie?: string): NextApiRequest {
  return { headers: cookie ? { cookie } : {} } as unknown as NextApiRequest
}

beforeEach(() => {
  delete process.env.PORTAL_SESSION_SECRET
  delete process.env.DIRECTUS_URL
  delete process.env.DIRECTUS_TOKEN
  jest.resetAllMocks()
})

describe('getPortalSession', () => {
  it('fehlendes PORTAL_SESSION_SECRET liefert null, auch mit gültigem Cookie', () => {
    const token = erzeugeSessionToken('redaktion@bajour.ch', 'bajour', SECRET)
    const req = makeReq(`${PORTAL_COOKIE}=${token}`)
    expect(getPortalSession(req)).toBeNull()
  })

  it('gültiger Cookie mit gesetztem Secret liefert die PortalSession', () => {
    process.env.PORTAL_SESSION_SECRET = SECRET
    const token = erzeugeSessionToken('redaktion@bajour.ch', 'bajour', SECRET)
    const req = makeReq(`${PORTAL_COOKIE}=${token}`)
    expect(getPortalSession(req)).toEqual({
      email: 'redaktion@bajour.ch',
      mediumSlug: 'bajour',
      rolle: 'medium',
    })
  })

  it('kein Cookie liefert null', () => {
    process.env.PORTAL_SESSION_SECRET = SECRET
    expect(getPortalSession(makeReq())).toBeNull()
  })
})

describe('requirePortalSession', () => {
  it('fehlendes Secret → 503 + null', () => {
    const { res, getStatus, getJson } = makeRes()
    const ergebnis = requirePortalSession(makeReq(), res)
    expect(ergebnis).toBeNull()
    expect(getStatus()).toBe(503)
    expect(getJson()).toEqual({ error: 'Portal nicht konfiguriert' })
  })

  it('gesetztes Secret, aber kein/ungültiger Cookie → 401 + null', () => {
    process.env.PORTAL_SESSION_SECRET = SECRET
    const { res, getStatus, getJson } = makeRes()
    const ergebnis = requirePortalSession(makeReq(), res)
    expect(ergebnis).toBeNull()
    expect(getStatus()).toBe(401)
    expect(typeof getJson().error).toBe('string')
  })

  it('gültige Session → Session, keine Antwort geschrieben', () => {
    process.env.PORTAL_SESSION_SECRET = SECRET
    const token = erzeugeSessionToken('redaktion@bajour.ch', 'bajour', SECRET)
    const { res } = makeRes()
    const req = makeReq(`${PORTAL_COOKIE}=${token}`)
    const ergebnis = requirePortalSession(req, res)
    expect(ergebnis).toEqual({ email: 'redaktion@bajour.ch', mediumSlug: 'bajour', rolle: 'medium' })
    expect(res.status).not.toHaveBeenCalled()
  })
})

describe('holeSecretOderAntworte503', () => {
  it('ohne Secret → 503 + null', () => {
    const { res, getStatus, getJson } = makeRes()
    expect(holeSecretOderAntworte503(res)).toBeNull()
    expect(getStatus()).toBe(503)
    expect(getJson()).toEqual({ error: 'Portal nicht konfiguriert' })
  })

  it('mit Secret → liefert das Secret, keine Antwort geschrieben', () => {
    process.env.PORTAL_SESSION_SECRET = SECRET
    const { res } = makeRes()
    expect(holeSecretOderAntworte503(res)).toBe(SECRET)
    expect(res.status).not.toHaveBeenCalled()
  })
})

describe('istPortalZugriffAufProxy (Proxy-Guard für /api/directus)', () => {
  it('gültiger Portal-Cookie + kein CF-Access-Header ⇒ true (sperren)', () => {
    const token = erzeugeSessionToken('redaktion@bajour.ch', 'bajour', SECRET)
    expect(istPortalZugriffAufProxy(`${PORTAL_COOKIE}=${token}`, undefined, SECRET)).toBe(true)
  })

  it('gültiger Portal-Cookie + CF-Access-Header vorhanden ⇒ false (Operator, durchlassen)', () => {
    const token = erzeugeSessionToken('redaktion@bajour.ch', 'bajour', SECRET)
    expect(istPortalZugriffAufProxy(`${PORTAL_COOKIE}=${token}`, 'ramona@wepublish.ch', SECRET)).toBe(false)
  })

  it('kein Secret ⇒ false (Session nicht prüfbar, kein Sperrgrund)', () => {
    const token = erzeugeSessionToken('redaktion@bajour.ch', 'bajour', SECRET)
    expect(istPortalZugriffAufProxy(`${PORTAL_COOKIE}=${token}`, undefined, undefined)).toBe(false)
  })

  it('kein Portal-Cookie ⇒ false', () => {
    expect(istPortalZugriffAufProxy(undefined, undefined, SECRET)).toBe(false)
  })

  it('fremder/kaputter Cookie ⇒ false', () => {
    expect(istPortalZugriffAufProxy('andererCookie=xyz', undefined, SECRET)).toBe(false)
  })
})

describe('baueLoginDedupKey', () => {
  it('gleicher Tag (UTC) → gleicher Key', () => {
    const t1 = new Date('2026-07-09T08:00:00Z')
    const t2 = new Date('2026-07-09T22:00:00Z')
    expect(baueLoginDedupKey('redaktion@bajour.ch', t1)).toBe(baueLoginDedupKey('redaktion@bajour.ch', t2))
  })

  it('anderer Tag → anderer Key', () => {
    const t1 = new Date('2026-07-09T08:00:00Z')
    const t2 = new Date('2026-07-10T08:00:00Z')
    expect(baueLoginDedupKey('redaktion@bajour.ch', t1)).not.toBe(baueLoginDedupKey('redaktion@bajour.ch', t2))
  })

  it('enthält Präfix, E-Mail und Datum', () => {
    const key = baueLoginDedupKey('redaktion@bajour.ch', new Date('2026-07-09T08:00:00Z'))
    expect(key).toBe('portal|login|redaktion@bajour.ch|2026-07-09')
  })
})

describe('baueLoginVorschlag', () => {
  it('baut die Felder für agent_vorschlaege korrekt: Link als Text in der Beschreibung, artefakt_link leer', () => {
    const v = baueLoginVorschlag({
      email: 'redaktion@bajour.ch',
      mediumSlug: 'bajour',
      mandant: 'wepublish',
      link: 'https://portal.example/api/portal/einloesen?token=abc.def',
      dedupKey: 'portal|login|redaktion@bajour.ch|2026-07-09',
    })
    expect(v).toMatchObject({
      typ: 'portal',
      status: 'offen',
      medium_id: 'bajour',
      mandant: 'wepublish',
      titel: 'Login-Link angefordert: redaktion@bajour.ch',
      // Der Einmal-Link darf NICHT in artefakt_link liegen: die VorschlagCard
      // rendert artefakt_link als klickbaren Anker, und ein Operator-Klick
      // (oder ein Link-Prefetcher) würde den Link fälschlich selbst öffnen.
      artefakt_link: null,
      dedup_key: 'portal|login|redaktion@bajour.ch|2026-07-09',
    })
    expect(String(v.beschreibung)).toContain('https://portal.example/api/portal/einloesen?token=abc.def')
    expect(String(v.beschreibung)).toContain('Login-Link')
    expect(String(v.beschreibung)).toContain('nur ans Medium weitergeben')
  })
})

describe('ladePortalMedium', () => {
  it('gefundenes Medium liefert normalisierte Felder', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              id: 12,
              name: 'Bajour',
              slug: 'bajour',
              matching_freigeschaltet: '2026-07-01T00:00:00Z',
              dna_medium_freigabe: null,
              logo_url: 'file-abc',
              logo_hochgeladen: true,
              slack_channel: 'C0BFYRBKL9F',
            },
          ],
        }),
    })
    global.fetch = mockFetch as unknown as typeof fetch

    const medium = await ladePortalMedium('bajour')
    expect(medium).toEqual({
      id: '12',
      name: 'Bajour',
      slug: 'bajour',
      matchingFreigeschaltet: '2026-07-01T00:00:00Z',
      dnaFreigabe: null,
      logoUrl: 'file-abc',
      logoHochgeladen: true,
      // Kontaktblock des Portals verweist auf den Slack-Kanal statt auf eine
      // Mailadresse (Wunsch Michael Scheurer, 28.07.2026).
      slackKanal: 'C0BFYRBKL9F',
    })
  })

  it('logo_url fehlt in der Directus-Antwort → logoUrl null', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ id: 12, name: 'Bajour', slug: 'bajour', matching_freigeschaltet: null, dna_medium_freigabe: null }],
        }),
    })
    global.fetch = mockFetch as unknown as typeof fetch
    const medium = await ladePortalMedium('bajour')
    expect(medium?.logoUrl).toBeNull()
  })

  it('logo_url gesetzt (Favicon-Auto-Fetch), aber logo_hochgeladen fehlt → logoHochgeladen false (Fix-Runde 1: Provenienz, nicht blosse Anwesenheit)', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            {
              id: 12,
              name: 'Bajour',
              slug: 'bajour',
              matching_freigeschaltet: null,
              dna_medium_freigabe: null,
              logo_url: 'file-favicon',
            },
          ],
        }),
    })
    global.fetch = mockFetch as unknown as typeof fetch
    const medium = await ladePortalMedium('bajour')
    expect(medium?.logoUrl).toBe('file-favicon')
    expect(medium?.logoHochgeladen).toBe(false)
  })

  it('kein Treffer liefert null', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) })
    global.fetch = mockFetch as unknown as typeof fetch
    expect(await ladePortalMedium('unbekannt')).toBeNull()
  })

  it('Directus-Fehlerstatus wirft (Aufrufer unterscheidet 404 von 502)', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })
    global.fetch = mockFetch as unknown as typeof fetch
    await expect(ladePortalMedium('bajour')).rejects.toThrow()
  })

  it('fetch-Rejection wird durchgereicht (me.ts fängt sie und antwortet 502)', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('Netz weg'))
    global.fetch = mockFetch as unknown as typeof fetch
    await expect(ladePortalMedium('bajour')).rejects.toThrow('Netz weg')
  })
})

describe('hatAktiveMediumDna (Grundlage des DNA-Nav-Schlosses)', () => {
  it('aktive medium_dna vorhanden liefert true; Filter trägt Slug und is_active', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [{ id: 25 }] }) })
    global.fetch = mockFetch as unknown as typeof fetch

    expect(await hatAktiveMediumDna('bajour')).toBe(true)

    const [calledUrl] = mockFetch.mock.calls[0] as [string]
    const decoded = decodeURIComponent(calledUrl)
    expect(decoded).toContain('/items/medium_dna')
    expect(decoded).toContain('bajour')
    expect(decoded).toContain('is_active')
  })

  it('keine aktive DNA liefert false', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) })
    global.fetch = mockFetch as unknown as typeof fetch
    expect(await hatAktiveMediumDna('vmz')).toBe(false)
  })

  it('Directus-Fehlerstatus wirft (me.ts antwortet dann 502)', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })
    global.fetch = mockFetch as unknown as typeof fetch
    await expect(hatAktiveMediumDna('bajour')).rejects.toThrow()
  })
})

describe('findePortalZugang', () => {
  it('liefert den normalisierten Zugang; Filter enthält E-Mail, Mandant und Nicht-gesperrt', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ id: 'uuid-1', email: 'redaktion@bajour.ch', medium_slug: 'bajour', status: 'aktiv', login_jti: null }],
        }),
    })
    global.fetch = mockFetch as unknown as typeof fetch

    const zugang = await findePortalZugang('redaktion@bajour.ch', 'wepublish')
    expect(zugang).toEqual({ id: 'uuid-1', email: 'redaktion@bajour.ch', mediumSlug: 'bajour', status: 'aktiv', loginJti: null })

    const [calledUrl] = mockFetch.mock.calls[0] as [string]
    const decoded = decodeURIComponent(calledUrl)
    expect(decoded).toContain('redaktion@bajour.ch')
    expect(decoded).toContain('wepublish')
    expect(decoded).toContain('gesperrt')
  })

  it('kein Treffer liefert null', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) })
    global.fetch = mockFetch as unknown as typeof fetch
    expect(await findePortalZugang('unbekannt@x.ch', 'wepublish')).toBeNull()
  })

  it('normalisiert die E-Mail vor dem Lookup (trim + lowercase)', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) })
    global.fetch = mockFetch as unknown as typeof fetch

    await findePortalZugang('  Redaktion@Bajour.CH ', 'wepublish')

    const [calledUrl] = mockFetch.mock.calls[0] as [string]
    const decoded = decodeURIComponent(calledUrl)
    expect(decoded).toContain('redaktion@bajour.ch')
    expect(decoded).not.toContain('Redaktion@Bajour.CH')
  })

  it('leere E-Mail (auch nach Trim) fragt Directus gar nicht an', async () => {
    const mockFetch = jest.fn()
    global.fetch = mockFetch as unknown as typeof fetch
    expect(await findePortalZugang('   ', 'wepublish')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('fetch-Rejection liefert null (kein Crash der Route)', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('Netz weg'))
    global.fetch = mockFetch as unknown as typeof fetch
    expect(await findePortalZugang('a@b.ch', 'wepublish')).toBeNull()
  })
})

describe('patchePortalZugang', () => {
  it('ruft PATCH auf die richtige Item-URL mit dem Patch-Body auf', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    global.fetch = mockFetch as unknown as typeof fetch

    await patchePortalZugang('uuid-1', { login_jti: null, status: 'aktiv' })

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/items/portal_zugaenge/uuid-1')
    expect(opts.method).toBe('PATCH')
    expect(JSON.parse(opts.body as string)).toEqual({ login_jti: null, status: 'aktiv' })
  })
})

describe('erzeugeZugangsLink', () => {
  it('baut den Link im richtigen Format und schreibt jti + Link + Zeitstempel per Patch auf den Zugang', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    global.fetch = mockFetch as unknown as typeof fetch
    process.env.PORTAL_BASE_URL = 'https://portal.example'

    const link = await erzeugeZugangsLink('uuid-1', 'redaktion@bajour.ch', 'bajour', SECRET)

    expect(link).toMatch(/^https:\/\/portal\.example\/api\/portal\/einloesen\?token=/)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/items/portal_zugaenge/uuid-1')
    expect(opts.method).toBe('PATCH')
    const body = JSON.parse(opts.body as string)
    expect(typeof body.login_jti).toBe('string')
    expect(body.letzter_link).toBe(link)
    expect(typeof body.letzter_link_ts).toBe('string')

    // Der Token im Link ist ein gültiges Login-Token mit genau diesen Feldern,
    // und das jti darin stimmt mit dem gepatchten login_jti überein. Genau
    // das prüft loeseZugangEin beim Einlösen atomar gegeneinander.
    const tokenRoh = decodeURIComponent(link.split('token=')[1])
    const payload = verifyToken<{ email: string; mediumSlug: string; jti: string; typ: string }>(tokenRoh, SECRET)
    expect(payload).toMatchObject({ email: 'redaktion@bajour.ch', mediumSlug: 'bajour', typ: 'login' })
    expect(payload?.jti).toBe(body.login_jti)
  })

  it('ohne PORTAL_BASE_URL: Link beginnt direkt mit dem relativen Pfad', async () => {
    delete process.env.PORTAL_BASE_URL
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    global.fetch = mockFetch as unknown as typeof fetch

    const link = await erzeugeZugangsLink('uuid-1', 'a@b.ch', 'bajour', SECRET)
    expect(link.startsWith('/api/portal/einloesen?token=')).toBe(true)
  })

  it('zwei Aufrufe erzeugen unterschiedliche jti (kein wiederverwendetes Token)', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    global.fetch = mockFetch as unknown as typeof fetch

    const link1 = await erzeugeZugangsLink('uuid-1', 'a@b.ch', 'bajour', SECRET)
    const link2 = await erzeugeZugangsLink('uuid-1', 'a@b.ch', 'bajour', SECRET)
    expect(link1).not.toBe(link2)
  })
})

describe('legeAgentVorschlagAn', () => {
  it('ruft POST auf agent_vorschlaege mit dem übergebenen Payload auf', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    global.fetch = mockFetch as unknown as typeof fetch

    await legeAgentVorschlagAn({ typ: 'portal', titel: 'x' })

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/items/agent_vorschlaege')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body as string)).toEqual({ typ: 'portal', titel: 'x' })
  })
})

describe('existiertVorschlagMitDedupKey', () => {
  it('Treffer → true', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [{ id: 'v1' }] }) })
    global.fetch = mockFetch as unknown as typeof fetch
    expect(await existiertVorschlagMitDedupKey('portal|login|a@b.ch|2026-07-09')).toBe(true)
  })

  it('kein Treffer → false', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) })
    global.fetch = mockFetch as unknown as typeof fetch
    expect(await existiertVorschlagMitDedupKey('portal|login|a@b.ch|2026-07-09')).toBe(false)
  })

  it('fetch-Rejection → false (lieber doppelt benachrichtigen als gar nicht)', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('Netz weg'))
    global.fetch = mockFetch as unknown as typeof fetch
    expect(await existiertVorschlagMitDedupKey('portal|login|a@b.ch|2026-07-09')).toBe(false)
  })
})

describe('loeseZugangEin (atomare jti-Einlösung)', () => {
  it('bedingter PATCH: Filter auf id UND login_jti im Body, nicht in der URL', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [{ id: 'uuid-1' }] }) })
    global.fetch = mockFetch as unknown as typeof fetch

    const ok = await loeseZugangEin('uuid-1', 'jti-1', '2026-07-09T10:00:00.000Z')
    expect(ok).toBe(true)

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/items\/portal_zugaenge$/)
    expect(opts.method).toBe('PATCH')
    const body = JSON.parse(opts.body as string)
    expect(body.query.filter).toEqual({ id: { _eq: 'uuid-1' }, login_jti: { _eq: 'jti-1' } })
    // login_jti bleibt STEHEN (Entscheid 28.07.2026: der Link verfällt nicht
    // und ist mehrfach verwendbar; Widerruf über neuen Link oder Sperren).
    expect(body.data).toEqual({ letzter_login: '2026-07-09T10:00:00.000Z', status: 'aktiv' })
  })

  it('0 aktualisierte Zeilen (jti durch neueren Link ersetzt) → false', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) })
    global.fetch = mockFetch as unknown as typeof fetch
    expect(await loeseZugangEin('uuid-1', 'jti-alt', '2026-07-09T10:00:00.000Z')).toBe(false)
  })

  it('Directus-Fehlerstatus → false', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })
    global.fetch = mockFetch as unknown as typeof fetch
    expect(await loeseZugangEin('uuid-1', 'jti-1', '2026-07-09T10:00:00.000Z')).toBe(false)
  })

  it('fetch-Rejection → false (Route redirected auf die Fehlerseite)', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('Netz weg'))
    global.fetch = mockFetch as unknown as typeof fetch
    expect(await loeseZugangEin('uuid-1', 'jti-1', '2026-07-09T10:00:00.000Z')).toBe(false)
  })
})
