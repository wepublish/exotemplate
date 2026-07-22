/**
 * knowledge-score.test.ts — Tests für die Knowledge-Score-Berechnung
 */

import { berechneKnowledgeScore, kategorieLabelFromKey } from './knowledge-score'

describe('berechneKnowledgeScore', () => {
  it('gibt 0/5 zurück bei leerer Liste', () => {
    const result = berechneKnowledgeScore([])
    expect(result.punkte).toBe(0)
    expect(result.maxPunkte).toBe(5)
    expect(result.prozent).toBe(0)
    expect(result.abgedeckt).toHaveLength(0)
    expect(result.fehlend).toHaveLength(5)
  })

  it('zählt jede Kern-Kategorie einmal, unabhängig von der Häufigkeit', () => {
    const items = [
      { category: 'budget' },
      { category: 'budget' },
      { category: 'budget' },
    ]
    const result = berechneKnowledgeScore(items)
    expect(result.punkte).toBe(1)
    expect(result.abgedeckt).toContain('Budget')
  })

  it('gibt 5/5 bei allen Kern-Kategorien', () => {
    const items = [
      { category: 'budget' },
      { category: 'previous_application' },
      { category: 'published_article' },
      { category: 'general_info' },
      { category: 'tax_exemption' },
    ]
    const result = berechneKnowledgeScore(items)
    expect(result.punkte).toBe(5)
    expect(result.prozent).toBe(100)
    expect(result.fehlend).toHaveLength(0)
  })

  it('behandelt newsletter als Ersatz für published_article', () => {
    const items = [{ category: 'newsletter' }]
    const result = berechneKnowledgeScore(items)
    // newsletter deckt die «Artikel / Newsletter»-Dimension (extraKey) ab
    expect(result.punkte).toBe(1)
    // Label kommt aus SCORE_KATEGORIEN[2].label = 'Artikel / Newsletter'
    expect(result.abgedeckt[0]).toContain('Artikel')
  })

  it('ignoriert Kategorien, die keine Score-Dimension decken (testimonial)', () => {
    const items = [{ category: 'testimonial' }]
    const result = berechneKnowledgeScore(items)
    expect(result.punkte).toBe(0)
  })

  it('behandelt defensiv undefined/null in category', () => {
    const items = [
      { category: null as unknown as string },
      { category: undefined as unknown as string },
      { category: 'budget' },
    ]
    const result = berechneKnowledgeScore(items)
    expect(result.punkte).toBe(1)
  })

  it('berechnet Prozent korrekt bei 3/5', () => {
    const items = [
      { category: 'budget' },
      { category: 'previous_application' },
      { category: 'general_info' },
    ]
    const result = berechneKnowledgeScore(items)
    expect(result.punkte).toBe(3)
    expect(result.prozent).toBe(60)
  })
})

describe('kategorieLabelFromKey', () => {
  it('gibt das Label für bekannte Kategorien zurück', () => {
    expect(kategorieLabelFromKey('budget')).toBe('Budget')
    expect(kategorieLabelFromKey('newsletter')).toBe('Newsletter')
    expect(kategorieLabelFromKey('general_info')).toBe('Allgemeine Infos')
  })

  it('gibt den Rohwert für unbekannte Schlüssel zurück', () => {
    expect(kategorieLabelFromKey('unbekannte_kategorie')).toBe('unbekannte_kategorie')
  })
})
