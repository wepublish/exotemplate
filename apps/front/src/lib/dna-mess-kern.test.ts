/**
 * Tests für dna-mess-kern.ts
 * Nur reine Logik: calcSchaerfe, filterVokabular, parseOllamaAntwort
 * Kein HTTP, kein Ollama, kein Firecrawl.
 */

import { calcSchaerfe, filterVokabular, parseOllamaAntwort, labelFuerSlug, type DnaTag, type ExclusionTag, type OllamaRohAntwort } from './dna-mess-kern'

// ─── labelFuerSlug ────────────────────────────────────────────────────────────

describe('labelFuerSlug', () => {
  it('liefert das Label eines bekannten Slugs', () => {
    expect(labelFuerSlug('geo_luzern')).toBe('Luzern')
  })

  it('unbekannter Slug: Fallback auf den Slug selbst', () => {
    expect(labelFuerSlug('kein_slug_im_vokabular')).toBe('kein_slug_im_vokabular')
  })
})

// ─── calcSchaerfe ─────────────────────────────────────────────────────────────

describe('calcSchaerfe', () => {
  const keineTags: DnaTag[] = []
  const keineExcl: ExclusionTag[] = []

  it('gibt 0 zurück wenn kein Korpus, keine Tags, keine Exclusions', () => {
    expect(calcSchaerfe({
      hatteWebKorpus: false,
      hatteBestehendesProfil: false,
      tags: keineTags,
      exclusion_tags: keineExcl,
    })).toBe(0)
  })

  it('Web-Korpus allein: +25', () => {
    expect(calcSchaerfe({
      hatteWebKorpus: true,
      hatteBestehendesProfil: false,
      tags: keineTags,
      exclusion_tags: keineExcl,
    })).toBe(25)
  })

  it('Web + langes Profil: 40 (capped)', () => {
    expect(calcSchaerfe({
      hatteWebKorpus: true,
      hatteBestehendesProfil: true,
      tags: keineTags,
      exclusion_tags: keineExcl,
    })).toBe(40)
  })

  it('Kurzes Profil ohne Web: 8', () => {
    expect(calcSchaerfe({
      hatteWebKorpus: false,
      hatteBestehendesProfil: 'kurz',
      tags: keineTags,
      exclusion_tags: keineExcl,
    })).toBe(8)
  })

  it('Ein Tag mit gewicht 3 + 2 evidenz: +6', () => {
    const tags: DnaTag[] = [
      { tag_slug: 'medien_pressefreiheit', gewicht: 3, begruendung: 'b', evidenz: ['url1', 'url2'] },
    ]
    expect(calcSchaerfe({
      hatteWebKorpus: false,
      hatteBestehendesProfil: false,
      tags,
      exclusion_tags: keineExcl,
    })).toBe(6)
  })

  it('Tag mit gewicht 3 aber nur 1 evidenz zählt NICHT (+0)', () => {
    const tags: DnaTag[] = [
      { tag_slug: 'medien_pressefreiheit', gewicht: 3, begruendung: 'b', evidenz: ['url1'] },
    ]
    expect(calcSchaerfe({
      hatteWebKorpus: false,
      hatteBestehendesProfil: false,
      tags,
      exclusion_tags: keineExcl,
    })).toBe(0)
  })

  it('Tag mit gewicht 2 + 2 evidenz zählt NICHT für Tag-Anteil', () => {
    const tags: DnaTag[] = [
      { tag_slug: 'medien_pressefreiheit', gewicht: 2, begruendung: 'b', evidenz: ['url1', 'url2'] },
    ]
    expect(calcSchaerfe({
      hatteWebKorpus: false,
      hatteBestehendesProfil: false,
      tags,
      exclusion_tags: keineExcl,
    })).toBe(0)
  })

  it('Tag-Anteil ist auf 30 gecapped (max 5 belegte Gewicht-3-Tags)', () => {
    const tags: DnaTag[] = Array.from({ length: 8 }, (_, i) => ({
      tag_slug: `slug_${i}`,
      gewicht: 3 as const,
      begruendung: 'b',
      evidenz: ['u1', 'u2'],
    }))
    expect(calcSchaerfe({
      hatteWebKorpus: false,
      hatteBestehendesProfil: false,
      tags,
      exclusion_tags: keineExcl,
    })).toBe(30)
  })

  it('Exclusion-Tags geben +10', () => {
    const excl: ExclusionTag[] = [{ tag_slug: 'geo_international', begruendung: 'kein Fokus' }]
    expect(calcSchaerfe({
      hatteWebKorpus: false,
      hatteBestehendesProfil: false,
      tags: keineTags,
      exclusion_tags: excl,
    })).toBe(10)
  })

  it('Maximum-Szenario: Web + langes Profil + 5 belegte Tags + Exclusion = 80', () => {
    const tags: DnaTag[] = Array.from({ length: 5 }, (_, i) => ({
      tag_slug: `slug_${i}`,
      gewicht: 3 as const,
      begruendung: 'b',
      evidenz: ['u1', 'u2'],
    }))
    const excl: ExclusionTag[] = [{ tag_slug: 'geo_international', begruendung: 'k' }]
    expect(calcSchaerfe({
      hatteWebKorpus: true,
      hatteBestehendesProfil: true,
      tags,
      exclusion_tags: excl,
    })).toBe(80)
  })

  it('foerderpraxis-Anteil ist immer 0 (Medien haben keine Förderpraxis)', () => {
    // Auch bei maximal belegten Tags überschreitet das Ergebnis nie 80
    const tags: DnaTag[] = Array.from({ length: 10 }, (_, i) => ({
      tag_slug: `slug_${i}`,
      gewicht: 3 as const,
      begruendung: 'b',
      evidenz: ['u1', 'u2', 'u3'],
    }))
    const result = calcSchaerfe({
      hatteWebKorpus: true,
      hatteBestehendesProfil: true,
      tags,
      exclusion_tags: [{ tag_slug: 'x', begruendung: 'y' }],
    })
    expect(result).toBe(80) // 40 + 30 + 0 (fp) + 10 = 80
  })
})

// ─── filterVokabular ──────────────────────────────────────────────────────────

describe('filterVokabular', () => {
  it('behält valide Slugs aus dem v3-Vokabular', () => {
    const roh: OllamaRohAntwort = {
      sound_feeling: 'sf',
      tags: [
        { tag_slug: 'geo_international', gewicht: 2, begruendung: 'b', evidenz: [] },
        { tag_slug: 'geo_luzern', gewicht: 1, begruendung: 'b', evidenz: [] },
      ],
      exclusion_tags: [],
    }
    const { tags, gefilterteTags } = filterVokabular(roh)
    expect(tags).toHaveLength(2)
    expect(gefilterteTags).toBe(0)
  })

  it('entfernt halluzinierte Slugs', () => {
    const roh: OllamaRohAntwort = {
      sound_feeling: 'sf',
      tags: [
        { tag_slug: 'geo_international', gewicht: 2, begruendung: 'b', evidenz: [] },
        { tag_slug: 'kultur_kunst_lifestyle_tradition', gewicht: 3, begruendung: 'b', evidenz: [] }, // halluziniert
        { tag_slug: 'EXISTIERT_NICHT', gewicht: 1, begruendung: 'b', evidenz: [] }, // halluziniert
      ],
      exclusion_tags: [],
    }
    const { tags, gefilterteTags } = filterVokabular(roh)
    expect(tags).toHaveLength(1)
    expect(tags[0].tag_slug).toBe('geo_international')
    expect(gefilterteTags).toBe(2)
  })

  it('filtert auch halluzinierte exclusion_tags', () => {
    const roh: OllamaRohAntwort = {
      sound_feeling: 'sf',
      tags: [],
      exclusion_tags: [
        { tag_slug: 'geo_international', begruendung: 'passt nicht' },
        { tag_slug: 'HALLUZINIERT', begruendung: 'x' },
      ],
    }
    const { exclusion_tags, gefilterte_exclusion } = filterVokabular(roh)
    expect(exclusion_tags).toHaveLength(1)
    expect(gefilterte_exclusion).toBe(1)
  })

  it('übersteht Array.isArray-Guard bei fehlenden Feldern', () => {
    const roh = { sound_feeling: 'sf' } as unknown as OllamaRohAntwort
    const { tags, exclusion_tags } = filterVokabular(roh)
    expect(tags).toEqual([])
    expect(exclusion_tags).toEqual([])
  })
})

// ─── parseOllamaAntwort ───────────────────────────────────────────────────────

describe('parseOllamaAntwort', () => {
  it('parst direktes JSON-Objekt', () => {
    const input = JSON.stringify({
      sound_feeling: 'sf',
      tags: [{ tag_slug: 'geo_international', gewicht: 2, begruendung: 'b', evidenz: [] }],
      exclusion_tags: [],
    })
    const result = parseOllamaAntwort(input)
    expect(result.sound_feeling).toBe('sf')
    expect(result.tags).toHaveLength(1)
  })

  it('entfernt think-Block vor dem JSON', () => {
    const json = JSON.stringify({ sound_feeling: 'sf', tags: [], exclusion_tags: [] })
    const input = `<think>Das ist Reasoning...</think>\n${json}`
    const result = parseOllamaAntwort(input)
    expect(result.sound_feeling).toBe('sf')
  })

  it('extrahiert JSON aus umgebendem Text', () => {
    const json = { sound_feeling: 'sf', tags: [], exclusion_tags: [] }
    const input = `Hier ist die Analyse:\n${JSON.stringify(json)}\nEnde.`
    const result = parseOllamaAntwort(input)
    expect(result.sound_feeling).toBe('sf')
  })

  it('wirft bei leerem Input', () => {
    expect(() => parseOllamaAntwort('')).toThrow()
  })

  it('wirft bei komplett ungültigem Input', () => {
    expect(() => parseOllamaAntwort('Das ist kein JSON.')).toThrow()
  })
})
