/**
 * Tests für usage-log.ts — Kostenberechnung (reine Logik, kein HTTP).
 */

import { kostenChf, eintragKostenChf, RATEN, type Usage } from './usage-log'

// ─── kostenChf ──────────────────────────────────────────────────────────────

describe('kostenChf', () => {
  it('rechnet Input + Output mit gegebenen Raten und Wechselkurs', () => {
    // (40000/1e6*3 + 8000/1e6*15) USD * 0.9 = (0.12 + 0.12)*0.9 = 0.216
    const chf = kostenChf({ input: 40000, output: 8000 }, { inProMio: 3, outProMio: 15 }, 0.9)
    expect(chf).toBeCloseTo(0.216, 4)
  })

  it('verrechnet Cache-Tokens mit ihren günstigeren Raten', () => {
    const u: Usage = { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 }
    // (1*0.3 + 1*3.75) USD * 1.0 = 4.05
    const chf = kostenChf(u, { inProMio: 3, outProMio: 15, cacheReadProMio: 0.3, cacheWriteProMio: 3.75 }, 1.0)
    expect(chf).toBeCloseTo(4.05, 4)
  })

  it('ignoriert Cache-Raten, wenn keine Cache-Tokens angegeben sind', () => {
    const chf = kostenChf({ input: 1_000_000, output: 0 }, { inProMio: 3, outProMio: 15 }, 1.0)
    expect(chf).toBeCloseTo(3, 4)
  })

  it('nutzt den USD_CHF-Default, wenn kein Kurs übergeben wird', () => {
    const chf = kostenChf({ input: 1_000_000, output: 0 }, { inProMio: 10, outProMio: 0 })
    // 10 USD * 0.9 Default
    expect(chf).toBeCloseTo(9, 4)
  })
})

// ─── eintragKostenChf ─────────────────────────────────────────────────────────

describe('eintragKostenChf', () => {
  it('api-Call mit bekanntem Modell: rechnet CHF', () => {
    const chf = eintragKostenChf(
      { modell: 'claude-sonnet-4-6', quelle: 'api', input_tokens: 40000, output_tokens: 8000 },
      0.9,
    )
    expect(chf).toBeCloseTo(0.216, 4)
  })

  it('abo-Call (Copy-paste-Opus): 0 CHF, nicht gemessen', () => {
    const chf = eintragKostenChf({ modell: 'claude-opus-4-8', quelle: 'abo', input_tokens: 99999, output_tokens: 99999 })
    expect(chf).toBe(0)
  })

  it('lokaler Spark-Call: 0 CHF', () => {
    const chf = eintragKostenChf({ modell: 'spark-qwen', quelle: 'lokal', input_tokens: 99999, output_tokens: 99999 })
    expect(chf).toBe(0)
  })

  it('api-Call mit unbekanntem Modell: null (Tarif unbekannt)', () => {
    const chf = eintragKostenChf({ modell: 'unbekanntes-modell', quelle: 'api', input_tokens: 1000, output_tokens: 1000 })
    expect(chf).toBeNull()
  })

  it('berücksichtigt Cache-Tokens eines api-Calls', () => {
    const chf = eintragKostenChf(
      { modell: 'claude-sonnet-4-6', quelle: 'api', input_tokens: 0, output_tokens: 0, cache_read_tokens: 1_000_000 },
      1.0,
    )
    // 1 Mio cacheRead * 0.3 USD = 0.3
    expect(chf).toBeCloseTo(0.3, 4)
  })
})

// ─── RATEN-Tabelle ────────────────────────────────────────────────────────────

describe('RATEN', () => {
  it('enthält die drei verwendeten Modelle', () => {
    expect(RATEN['claude-sonnet-4-6']).toBeDefined()
    expect(RATEN['claude-opus-4-8']).toBeDefined()
    expect(RATEN['claude-haiku-4-5-20251001']).toBeDefined()
  })

  it('Opus ist teurer als Sonnet (Plausibilität)', () => {
    expect(RATEN['claude-opus-4-8'].outProMio).toBeGreaterThan(RATEN['claude-sonnet-4-6'].outProMio)
  })
})
