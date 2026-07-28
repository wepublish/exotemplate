/**
 * Tests für legeZugangAnMitLink (portal-guard): die geteilte Anlegen-Logik
 * von /api/zugangsverwaltung und /api/medium-aufnehmen. Directus komplett
 * über global.fetch gemockt; erzeugeZugangsLink läuft ECHT mit (Modul-lokale
 * Bindung), darum gehört zum Ablauf immer auch der PATCH auf den Zugang
 * (login_jti + letzter_link).
 */
import { legeZugangAnMitLink, loeseZugangEin } from './portal-guard'

const SECRET = 'zugang-helfer-test-geheimnis-4711'

describe('legeZugangAnMitLink', () => {
  const fetchMock = jest.fn()
  const originalFetch = global.fetch

  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
    process.env.PORTAL_BASE_URL = 'https://portal.example'
  })

  afterAll(() => {
    global.fetch = originalFetch
    delete process.env.PORTAL_BASE_URL
  })

  it('kein bestehender Zugang: Lookup → Create → Link-PATCH, bestehend:false', async () => {
    fetchMock
      // 1. Dedup-Lookup: leer.
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) })
      // 2. Create.
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: { id: 'z-neu' } }) })
      // 3. PATCH aus erzeugeZugangsLink (login_jti + letzter_link).
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: {} }) })

    const ergebnis = await legeZugangAnMitLink('neu@bajour.ch', 'bajour', 'wepublish', 'ops@wepublish.ch', SECRET)

    expect(ergebnis.bestehend).toBe(false)
    expect(ergebnis.link).toMatch(/^https:\/\/portal\.example\/api\/portal\/einloesen\?token=/)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [, createOpts] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(createOpts.method).toBe('POST')
    const createBody = JSON.parse(createOpts.body as string)
    expect(createBody.email).toBe('neu@bajour.ch')
    expect(createBody.medium_slug).toBe('bajour')
    expect(createBody.mandant).toBe('wepublish')
    expect(createBody.status).toBe('eingeladen')
    expect(createBody.erstellt_von).toBe('ops@wepublish.ch')

    const [patchUrl, patchOpts] = fetchMock.mock.calls[2] as [string, RequestInit]
    expect(patchUrl).toContain('/items/portal_zugaenge/z-neu')
    expect(patchOpts.method).toBe('PATCH')
    const patchBody = JSON.parse(patchOpts.body as string)
    expect(patchBody.login_jti).toBeTruthy()
    expect(patchBody.letzter_link).toBe(ergebnis.link)
  })

  it('bestehender Zugang: KEIN Create, nur neuer Link für die bestehende id, bestehend:true', async () => {
    fetchMock
      // 1. Dedup-Lookup: Treffer.
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'z-alt', email: 'redaktion@bajour.ch', medium_slug: 'bajour' }] }),
      })
      // 2. PATCH aus erzeugeZugangsLink.
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: {} }) })

    const ergebnis = await legeZugangAnMitLink('redaktion@bajour.ch', 'bajour', 'wepublish', 'team', SECRET)

    expect(ergebnis.bestehend).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [lookupUrl] = fetchMock.mock.calls[0] as [string]
    const decoded = decodeURIComponent(lookupUrl)
    expect(decoded).toContain('redaktion@bajour.ch')
    expect(decoded).toContain('bajour')
    const [patchUrl] = fetchMock.mock.calls[1] as [string]
    expect(patchUrl).toContain('/items/portal_zugaenge/z-alt')
  })

  it('Lookup schlägt fehl → wirft (Route antwortet 502)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })

    await expect(legeZugangAnMitLink('x@y.ch', 'bajour', 'wepublish', 'team', SECRET)).rejects.toThrow('500')
  })

  it('Create ohne id in der Antwort → wirft', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: {} }) })

    await expect(legeZugangAnMitLink('x@y.ch', 'bajour', 'wepublish', 'team', SECRET)).rejects.toThrow('keine id')
  })
})

describe('loeseZugangEin (dauerhafter Link, Entscheid 28.07.2026)', () => {
  const fetchMock = jest.fn()
  const originalFetch = global.fetch

  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  it('löscht das login_jti beim Einlösen NICHT (Link bleibt mehrfach verwendbar), stempelt letzter_login', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [{ id: 'z-1' }] }) })

    const ok = await loeseZugangEin('z-1', 'jti-123', '2026-07-28T12:00:00.000Z')

    expect(ok).toBe(true)
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.query.filter).toEqual({ id: { _eq: 'z-1' }, login_jti: { _eq: 'jti-123' } })
    expect(body.data).toEqual({ letzter_login: '2026-07-28T12:00:00.000Z', status: 'aktiv' })
    expect('login_jti' in body.data).toBe(false)
  })

  it('0 getroffene Zeilen (jti durch neueren Link ersetzt) → false', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) })

    expect(await loeseZugangEin('z-1', 'jti-alt', '2026-07-28T12:00:00.000Z')).toBe(false)
  })
})
