/**
 * Tests für llm.ts (Claude-API via @anthropic-ai/sdk).
 * Reine Logik (parseJsonLoose) + callLLM gegen einen gemockten SDK-Client.
 * Kein echter Netzwerk-Call.
 */

const mockFinalMessage = jest.fn()
const mockStream = jest.fn(() => ({ finalMessage: mockFinalMessage }))

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { stream: mockStream }
  }))
}))

import { parseJsonLoose, callLLM } from './llm'

function textMessage(text: string) {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn' }
}

// ─── callLLM ────────────────────────────────────────────────────────────────

describe('callLLM (Claude)', () => {
  const origModel = process.env.ANTHROPIC_MODEL

  beforeEach(() => {
    delete process.env.ANTHROPIC_MODEL
    mockStream.mockClear()
    mockFinalMessage.mockReset()
  })

  afterAll(() => {
    if (origModel === undefined) delete process.env.ANTHROPIC_MODEL
    else process.env.ANTHROPIC_MODEL = origModel
  })

  it('gibt den zusammengesetzten Text der Antwort zurück (nur text-Blöcke)', async () => {
    mockFinalMessage.mockResolvedValue({
      content: [
        { type: 'text', text: 'hallo' },
        { type: 'thinking', thinking: '…' },
        { type: 'text', text: ' welt' }
      ],
      stop_reason: 'end_turn'
    })
    const ergebnis = await callLLM({ user: 'test', temperature: 0, max_tokens: 10 })
    expect(ergebnis).toBe('hallo welt')
  })

  it('reicht temperature NICHT an die API weiter und nutzt das Default-Modell', async () => {
    mockFinalMessage.mockResolvedValue(textMessage('ok'))
    await callLLM({ user: 'test', temperature: 0.7, max_tokens: 42 })
    const req = mockStream.mock.calls[0][0]
    expect(req).not.toHaveProperty('temperature')
    expect(req.model).toBe('claude-opus-4-8')
    expect(req.max_tokens).toBe(42)
    expect(req.messages).toEqual([{ role: 'user', content: 'test' }])
  })

  it('respektiert ANTHROPIC_MODEL aus der Umgebung', async () => {
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-5'
    mockFinalMessage.mockResolvedValue(textMessage('ok'))
    await callLLM({ user: 'test', temperature: 0, max_tokens: 10 })
    expect(mockStream.mock.calls[0][0].model).toBe('claude-sonnet-5')
  })

  it('übergibt den System-Prompt als Top-Level-Feld', async () => {
    mockFinalMessage.mockResolvedValue(textMessage('ok'))
    await callLLM({ system: 'sei knapp', user: 'test', temperature: 0, max_tokens: 10 })
    expect(mockStream.mock.calls[0][0].system).toBe('sei knapp')
  })

  it('lässt system weg, wenn nicht gesetzt', async () => {
    mockFinalMessage.mockResolvedValue(textMessage('ok'))
    await callLLM({ user: 'test', temperature: 0, max_tokens: 10 })
    expect(mockStream.mock.calls[0][0]).not.toHaveProperty('system')
  })

  it('wirft bei leerer Antwort (kein text-Block)', async () => {
    mockFinalMessage.mockResolvedValue({
      content: [{ type: 'thinking', thinking: '…' }],
      stop_reason: 'end_turn'
    })
    await expect(callLLM({ user: 'test', temperature: 0, max_tokens: 10 })).rejects.toThrow()
  })

  it('propagiert einen API-Fehler (SDK-Retries erschöpft)', async () => {
    mockFinalMessage.mockRejectedValue(new Error('rate limited'))
    await expect(
      callLLM({ user: 'test', temperature: 0, max_tokens: 10 })
    ).rejects.toThrow(/rate limited/)
  })
})

// ─── parseJsonLoose ───────────────────────────────────────────────────────────

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
    const result = parseJsonLoose(input)
    expect(result).toEqual({ suggested_amount: 5000, reasoning: 'klein' })
  })
})
