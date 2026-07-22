/**
 * Tests für berechneArbeitsDnaScore aus working-dna.ts.
 * Importiert die exportierte Funktion direkt.
 */

import { berechneArbeitsDnaScore } from '@/pages/api/medium-knowledge/working-dna'

// ─── Basis-Fälle ──────────────────────────────────────────────────────────────

describe('berechneArbeitsDnaScore', () => {
  it('ergibt 0 wenn alle Parameter false/0 sind', () => {
    expect(
      berechneArbeitsDnaScore({
        hatArtikelOderNewsletter: false,
        hatManuelles: false,
        hatPreviousApplication: false,
        hatWebsite: false,
        fundingKeywordsAnzahl: 0,
      })
    ).toBe(0)
  })

  it('ergibt 35 wenn nur Artikel/Newsletter vorhanden', () => {
    expect(
      berechneArbeitsDnaScore({
        hatArtikelOderNewsletter: true,
        hatManuelles: false,
        hatPreviousApplication: false,
        hatWebsite: false,
        fundingKeywordsAnzahl: 0,
      })
    ).toBe(35)
  })

  it('ergibt 100 bei vollem Korpus (alle Punkte)', () => {
    expect(
      berechneArbeitsDnaScore({
        hatArtikelOderNewsletter: true,  // +35
        hatManuelles: true,              // +20
        hatPreviousApplication: true,    // +20
        hatWebsite: true,                // +10
        fundingKeywordsAnzahl: 10,       // +15
      })
    ).toBe(100)
  })

  it('zählt fundingKeywords-Bonus erst ab 8', () => {
    const ohne = berechneArbeitsDnaScore({
      hatArtikelOderNewsletter: false,
      hatManuelles: false,
      hatPreviousApplication: false,
      hatWebsite: false,
      fundingKeywordsAnzahl: 7,
    })
    const mit = berechneArbeitsDnaScore({
      hatArtikelOderNewsletter: false,
      hatManuelles: false,
      hatPreviousApplication: false,
      hatWebsite: false,
      fundingKeywordsAnzahl: 8,
    })
    expect(ohne).toBe(0)
    expect(mit).toBe(15)
  })

  it('überschreitet nie 100', () => {
    // Alle Punkte + überhöhte Keywords — trotzdem max 100
    expect(
      berechneArbeitsDnaScore({
        hatArtikelOderNewsletter: true,
        hatManuelles: true,
        hatPreviousApplication: true,
        hatWebsite: true,
        fundingKeywordsAnzahl: 50,
      })
    ).toBe(100)
  })

  it('ergibt 45 bei nur Website + manuell + keywords', () => {
    expect(
      berechneArbeitsDnaScore({
        hatArtikelOderNewsletter: false,
        hatManuelles: true,    // +20
        hatPreviousApplication: false,
        hatWebsite: true,      // +10
        fundingKeywordsAnzahl: 9, // +15
      })
    ).toBe(45)
  })
})
