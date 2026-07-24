/**
 * Regressionstest W1.2 Lösch-Guard: der «Medium zurücksetzen»-Reset darf die
 * teuer LLM-veredelte medium_dna NICHT hart löschen (historische Ursache des
 * We.Publish-DNA-Verlusts, STATUS.md: «Lösch-Ursache geklärt: Reset-Knopf»),
 * sondern nur deaktivieren (is_active=false) — so bleibt sie wiederherstellbar.
 * match_results dürfen weiterhin gelöscht werden (aus der Engine recomputebar).
 */
import { deaktiviereDnaNachMedium } from './medium-zuruecksetzen'

describe('deaktiviereDnaNachMedium (W1.2 Lösch-Guard)', () => {
  const OLD_ENV = process.env
  beforeEach(() => {
    process.env = { ...OLD_ENV, DIRECTUS_URL: 'http://directus.test', DIRECTUS_TOKEN: 'tok' }
  })
  afterEach(() => {
    process.env = OLD_ENV
    jest.restoreAllMocks()
  })

  it('deaktiviert alle DNA-Versionen per PATCH statt sie zu löschen', async () => {
    const calls: { url: string; method: string; body?: string }[] = []
    global.fetch = jest.fn(async (url: unknown, init: unknown) => {
      const i = (init ?? {}) as { method?: string; body?: string }
      calls.push({ url: String(url), method: (i.method ?? 'GET').toUpperCase(), body: i.body })
      if (String(url).includes('fields=id')) {
        return { ok: true, json: async () => ({ data: [{ id: 11 }, { id: 12 }] }) } as unknown as Response
      }
      return { ok: true, json: async () => ({ data: {} }) } as unknown as Response
    }) as unknown as typeof fetch

    const n = await deaktiviereDnaNachMedium('cueltuer')

    expect(n).toBe(2)
    const patch = calls.find((c) => c.method === 'PATCH')
    expect(patch).toBeDefined()
    expect(patch!.url).toContain('/items/medium_dna')
    const body = JSON.parse(patch!.body as string)
    expect(body.data.is_active).toBe(false)
    expect(body.keys).toEqual([11, 12])
    // Kein hartes DELETE auf medium_dna:
    expect(calls.find((c) => c.method === 'DELETE' && c.url.includes('/items/medium_dna'))).toBeUndefined()
  })

  it('macht nichts (0) bei keiner DNA-Version', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: [] }) }) as unknown as Response) as unknown as typeof fetch
    expect(await deaktiviereDnaNachMedium('leer')).toBe(0)
  })
})
