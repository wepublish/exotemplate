/**
 * Tests für flattenRichText (wepublish-ingest.ts)
 * Nur reine Logik — kein HTTP.
 */

import { flattenRichText } from '../pages/api/medium-knowledge/wepublish-ingest'

describe('flattenRichText', () => {
  it('gibt leeren String für null zurück', () => {
    expect(flattenRichText(null)).toBe('')
  })

  it('gibt leeren String für undefined zurück', () => {
    expect(flattenRichText(undefined)).toBe('')
  })

  it('gibt String-Input direkt zurück', () => {
    expect(flattenRichText('hallo')).toBe('hallo')
  })

  it('sammelt text-Felder aus Blatt-Knoten', () => {
    const node = { type: 'paragraph', children: [{ text: 'Hallo ' }, { text: 'Welt' }] }
    // Whitespace wird normalisiert → einzelner Space zwischen den Tokens
    expect(flattenRichText(node)).toBe('Hallo Welt')
  })

  it('verarbeitet verschachtelte children', () => {
    const node = {
      type: 'document',
      children: [
        { type: 'paragraph', children: [{ text: 'Erster Satz.' }] },
        { type: 'paragraph', children: [{ text: 'Zweiter Satz.' }] },
      ],
    }
    const result = flattenRichText(node)
    expect(result).toContain('Erster Satz.')
    expect(result).toContain('Zweiter Satz.')
  })

  it('verarbeitet Arrays', () => {
    const nodes = [{ text: 'Teil 1' }, { text: 'Teil 2' }]
    const result = flattenRichText(nodes)
    expect(result).toContain('Teil 1')
    expect(result).toContain('Teil 2')
  })

  it('überspringt Knoten ohne text und ohne children', () => {
    const node = { type: 'image', url: 'http://example.com/img.png' }
    expect(flattenRichText(node)).toBe('')
  })

  it('verarbeitet reales Slate-JSON', () => {
    const richText = [
      {
        type: 'paragraph',
        children: [
          { text: 'We.Publish ist eine ' },
          { text: 'Open-Source', bold: true },
          { text: '-Plattform.' },
        ],
      },
    ]
    const result = flattenRichText(richText)
    expect(result).toContain('We.Publish ist eine')
    expect(result).toContain('Open-Source')
    expect(result).toContain('Plattform.')
  })

  it('normalisiert Whitespace auf einzelne Spaces', () => {
    const nodes = [{ text: 'a' }, { text: '' }, { text: 'b' }]
    const result = flattenRichText(nodes)
    // Sollte nicht mehrfache Spaces enthalten
    expect(result.trim()).not.toMatch(/\s{3,}/)
  })
})
