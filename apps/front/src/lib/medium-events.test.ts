/**
 * Tests für medium-events.ts: der Protokoll-Schreiber schreibt den korrekten
 * Body (inkl. mandant) nach /items/medium_events und darf NIE werfen — ein
 * fehlgeschlagener Protokoll-Schreiber darf die eigentliche Aktion
 * (Freischalten, Freigeben, Upload) nicht scheitern lassen.
 */
import { schreibeMediumEvent } from './medium-events'
import { tenant } from '../../config/tenant'

describe('schreibeMediumEvent', () => {
  const fetchMock = jest.fn()
  const originalFetch = global.fetch
  const originalToken = process.env.DIRECTUS_TOKEN
  const originalUrl = process.env.DIRECTUS_URL
  let consoleSpy: jest.SpyInstance

  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
    process.env.DIRECTUS_TOKEN = 'test-token'
    process.env.DIRECTUS_URL = 'http://directus.test'
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  afterAll(() => {
    global.fetch = originalFetch
    if (originalToken === undefined) delete process.env.DIRECTUS_TOKEN
    else process.env.DIRECTUS_TOKEN = originalToken
    if (originalUrl === undefined) delete process.env.DIRECTUS_URL
    else process.env.DIRECTUS_URL = originalUrl
  })

  it('schreibt medium_id, mandant, typ, titel, detail und actor nach /items/medium_events', async () => {
    fetchMock.mockResolvedValue({ ok: true })

    await schreibeMediumEvent({
      medium_id: 'zwoelf',
      typ: 'zusage',
      titel: 'Zusage: Stiftung Beispielhaft',
      detail: "CHF 20'000",
      actor: 'redaktion@zwoelf.ch',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://directus.test/items/medium_events')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer test-token')
    expect(JSON.parse(init.body)).toEqual({
      medium_id: 'zwoelf',
      mandant: tenant.key,
      typ: 'zusage',
      titel: 'Zusage: Stiftung Beispielhaft',
      detail: "CHF 20'000",
      actor: 'redaktion@zwoelf.ch',
    })
  })

  it('füllt fehlendes detail und actor mit null auf', async () => {
    fetchMock.mockResolvedValue({ ok: true })

    await schreibeMediumEvent({ medium_id: 'zwoelf', typ: 'portal_login', titel: 'Im Portal angemeldet' })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.detail).toBeNull()
    expect(body.actor).toBeNull()
  })

  it('wirft nicht, wenn fetch scheitert (fire-and-forget)', async () => {
    fetchMock.mockRejectedValue(new Error('Netz weg'))

    await expect(
      schreibeMediumEvent({ medium_id: 'zwoelf', typ: 'dna_aktiv', titel: 'DNA aktiv' }),
    ).resolves.toBeUndefined()
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('wirft nicht bei Nicht-OK-Antwort von Directus', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 })

    await expect(
      schreibeMediumEvent({ medium_id: 'zwoelf', typ: 'dna_aktiv', titel: 'DNA aktiv' }),
    ).resolves.toBeUndefined()
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('macht ohne DIRECTUS_TOKEN gar keinen fetch', async () => {
    delete process.env.DIRECTUS_TOKEN

    await schreibeMediumEvent({ medium_id: 'zwoelf', typ: 'absage', titel: 'Absage' })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
