/**
 * Tests fuer /api/outbox-send — Route-Handler direkt aufgerufen,
 * global.fetch gemockt, Env-Variablen vor jedem Fall zurueckgesetzt.
 */

// Mocking des Handler-Moduls: next-Typen stub
import type { NextApiRequest, NextApiResponse } from 'next'

// Handler direkt importieren
import handler from '../pages/api/outbox-send'

// Hilfstypen fuer Spy-Response
type ResJson = Record<string, unknown>

function makeRes(): { res: NextApiResponse; getJson: () => ResJson; getStatus: () => number } {
  let status = 200
  let body: ResJson = {}
  const res = {
    setHeader: jest.fn(),
    status: jest.fn((s: number) => { status = s; return res }),
    json: jest.fn((j: ResJson) => { body = j; return res }),
  } as unknown as NextApiResponse
  return { res, getJson: () => body, getStatus: () => status }
}

function makeReq(method: string, body?: unknown): NextApiRequest {
  return { method, body: body ?? {} } as NextApiRequest
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  // Env auf Ausgangszustand zuruecksetzen
  delete process.env.FAAS_AGENT_ENABLED
  delete process.env.HERMES_API_URL
  jest.resetAllMocks()
})

afterEach(() => {
  // Sicherheitshalber wiederherstellen
  delete process.env.FAAS_AGENT_ENABLED
  delete process.env.HERMES_API_URL
})

describe('/api/outbox-send', () => {
  test('GET → 405', async () => {
    const { res, getStatus, getJson } = makeRes()
    await handler(makeReq('GET'), res)
    expect(getStatus()).toBe(405)
    expect(getJson().ok).toBe(false)
  })

  test('POST ohne id → 400', async () => {
    const { res, getStatus, getJson } = makeRes()
    await handler(makeReq('POST', {}), res)
    expect(getStatus()).toBe(400)
    expect(getJson().ok).toBe(false)
    expect(typeof getJson().fehler).toBe('string')
  })

  test('FAAS_AGENT_ENABLED nicht gesetzt → {ok:false, fehler: Dienst nicht aktiv}', async () => {
    const { res, getStatus, getJson } = makeRes()
    await handler(makeReq('POST', { id: 'abc' }), res)
    expect(getStatus()).toBe(200)
    expect(getJson().ok).toBe(false)
    expect(String(getJson().fehler)).toContain('nicht aktiv')
  })

  test('Env gesetzt + fetch-Mock liefert {ok:true} → Antwort durchgereicht, korrekte URL und Body', async () => {
    process.env.FAAS_AGENT_ENABLED = 'true'
    process.env.HERMES_API_URL = 'http://127.0.0.1:9200'

    const mockFetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, status: 'versendet' }),
    })
    global.fetch = mockFetch as unknown as typeof fetch

    const req = {
      ...makeReq('POST', { id: 'abc' }),
      headers: {},
    } as unknown as NextApiRequest

    const { res, getJson } = makeRes()
    await handler(req, res)

    expect(getJson()).toEqual({ ok: true, status: 'versendet' })
    expect(mockFetch).toHaveBeenCalledTimes(1)

    const [calledUrl, calledOptions] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toContain('/outbox-senden')
    const sentBody = JSON.parse(calledOptions.body as string)
    expect(sentBody).toEqual({ id: 'abc', user: 'team' })
  })
})
