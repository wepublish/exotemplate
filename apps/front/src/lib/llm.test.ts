/**
 * Tests für llm.ts
 * Nur reine Logik (parseJsonLoose).
 * Kein HTTP, kein vLLM.
 */

import { parseJsonLoose, callLLM } from './llm'

// ─── callLLM Fallback-Logik (Spark → Studio) ───────────────────────────────────

describe('callLLM Fallback', () => {
  const origFetch = global.fetch
  const origUrl = process.env.LLM_URL
  const origFallback = process.env.LLM_URL_FALLBACK
  const origFallbackModel = process.env.LLM_MODEL_FALLBACK

  afterEach(() => {
    global.fetch = origFetch
    process.env.LLM_URL = origUrl
    if (origFallback === undefined) delete process.env.LLM_URL_FALLBACK
    else process.env.LLM_URL_FALLBACK = origFallback
    if (origFallbackModel === undefined) delete process.env.LLM_MODEL_FALLBACK
    else process.env.LLM_MODEL_FALLBACK = origFallbackModel
  })

  /** Erzeugt einen Timeout-artigen Fehler (umgeht den 5s-Retry-Backoff). */
  function timeoutFehler(): Error {
    const e = new Error('The operation timed out')
    e.name = 'TimeoutError'
    return e
  }

  function okResponse(content: string): Response {
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content } }] }),
    } as unknown as Response
  }

  it('nutzt den Fallback-Endpoint, wenn der primäre scheitert', async () => {
    process.env.LLM_URL = 'http://primaer:8001'
    process.env.LLM_URL_FALLBACK = 'http://studio:8002'
    const aufgerufen: string[] = []
    global.fetch = (async (url: string) => {
      aufgerufen.push(String(url))
      if (String(url).includes('primaer')) throw timeoutFehler()
      return okResponse('aus-fallback')
    }) as unknown as typeof fetch

    const ergebnis = await callLLM({ user: 'test', temperature: 0, max_tokens: 10 })
    expect(ergebnis).toBe('aus-fallback')
    expect(aufgerufen.some(u => u.includes('primaer'))).toBe(true)
    expect(aufgerufen.some(u => u.includes('studio'))).toBe(true)
  })

  it('nutzt den Fallback NICHT, wenn der primäre liefert', async () => {
    process.env.LLM_URL = 'http://primaer:8001'
    process.env.LLM_URL_FALLBACK = 'http://studio:8002'
    const aufgerufen: string[] = []
    global.fetch = (async (url: string) => {
      aufgerufen.push(String(url))
      return okResponse('aus-primaer')
    }) as unknown as typeof fetch

    const ergebnis = await callLLM({ user: 'test', temperature: 0, max_tokens: 10 })
    expect(ergebnis).toBe('aus-primaer')
    expect(aufgerufen.some(u => u.includes('studio'))).toBe(false)
  })

  it('wirft, wenn kein Fallback konfiguriert ist und der primäre scheitert', async () => {
    process.env.LLM_URL = 'http://primaer:8001'
    delete process.env.LLM_URL_FALLBACK
    global.fetch = (async () => { throw timeoutFehler() }) as unknown as typeof fetch
    await expect(callLLM({ user: 'test', temperature: 0, max_tokens: 10 })).rejects.toThrow()
  })

  it('wirft mit kombinierter Meldung, wenn primär UND Fallback scheitern', async () => {
    process.env.LLM_URL = 'http://primaer:8001'
    process.env.LLM_URL_FALLBACK = 'http://studio:8002'
    global.fetch = (async () => { throw timeoutFehler() }) as unknown as typeof fetch
    await expect(callLLM({ user: 'test', temperature: 0, max_tokens: 10 })).rejects.toThrow(/primär UND Fallback/)
  })
})

describe('parseJsonLoose', () => {
  it('parst direktes JSON-Objekt', () => {
    const result = parseJsonLoose('{"suggested_amount": 12000, "reasoning": "passt"}')
    expect(result).toEqual({ suggested_amount: 12000, reasoning: 'passt' })
  })

  it('parst JSON-Objekt mit vorangehendem Text', () => {
    const result = parseJsonLoose('Hier die Antwort:\n{"key": "value"}\nDanke.')
    expect(result).toEqual({ key: 'value' })
  })

  it('parst verschachteltes JSON', () => {
    const obj = { a: { b: [1, 2, 3], c: 'test' }, d: true }
    const result = parseJsonLoose(JSON.stringify(obj))
    expect(result).toEqual(obj)
  })

  it('trimmt Whitespace vor dem Parse', () => {
    const result = parseJsonLoose('  \n  {"x": 1}  \n  ')
    expect(result).toEqual({ x: 1 })
  })

  it('wirft bei leerem Input', () => {
    expect(() => parseJsonLoose('')).toThrow()
  })

  it('wirft bei reinem Text ohne JSON', () => {
    expect(() => parseJsonLoose('Das ist kein JSON')).toThrow()
  })

  it('wirft bei ungültigem JSON', () => {
    expect(() => parseJsonLoose('{kaputt: true}')).toThrow()
  })

  it('parst JSON nach think-Block (realer LLM-Output)', () => {
    const input = '<think>Ich überlege…</think>\n{"suggested_amount": 5000, "reasoning": "klein"}'
    // parseJsonLoose selbst entfernt keinen think-Block —
    // das macht parseOllamaAntwort in dna-mess-kern.ts.
    // Hier testen wir nur, dass ein Objekt irgendwo im String gefunden wird.
    const result = parseJsonLoose(input)
    expect(result).toEqual({ suggested_amount: 5000, reasoning: 'klein' })
  })
})
