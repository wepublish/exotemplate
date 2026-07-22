import {
  zielLabel, zielBadgeClass, scoreFarbe, normTags, normBetrag, SONDER_GRUPPEN,
  sonderRefVonMatch, bauSonderApplicationDaten,
} from './sonder.helpers'

describe('sonder.helpers', () => {
  test('zielLabel mappt Collections auf Labels', () => {
    expect(zielLabel('kirchen')).toBe('Kirche')
    expect(zielLabel('foerderer')).toBe('Förderer')
    expect(zielLabel('lotteriefonds')).toBe('Lotteriefonds')
    expect(zielLabel('sponsoren')).toBe('Sponsor')
    expect(zielLabel(null)).toBe('—')
    expect(zielLabel('sonstiges')).toBe('sonstiges')
  })

  test('zielBadgeClass unterscheidet alle vier Ziel-Typen', () => {
    expect(zielBadgeClass('kirchen')).toContain('violet')
    expect(zielBadgeClass('foerderer')).toContain('sky')
    expect(zielBadgeClass('lotteriefonds')).toContain('amber')
    expect(zielBadgeClass('sponsoren')).toContain('rose')
    expect(zielBadgeClass(null)).toContain('slate')
  })

  test('SONDER_GRUPPEN deckt alle vier Pools in fester Reihenfolge', () => {
    expect(SONDER_GRUPPEN.map(g => g.coll)).toEqual(['kirchen', 'foerderer', 'lotteriefonds', 'sponsoren'])
  })

  test('scoreFarbe stuft nach Höhe', () => {
    expect(scoreFarbe(20)).toContain('emerald')
    expect(scoreFarbe(15)).toContain('amber')
    expect(scoreFarbe(10)).toContain('slate')
    expect(scoreFarbe(null)).toContain('slate')
  })

  test('normTags filtert nicht-Strings und behandelt Nicht-Arrays', () => {
    expect(normTags(['a', 'b'])).toEqual(['a', 'b'])
    expect(normTags(['a', 3, null, 'c'])).toEqual(['a', 'c'])
    expect(normTags(null)).toEqual([])
    expect(normTags('x')).toEqual([])
  })

  test('normBetrag akzeptiert gültige Ergebnisse, weist Müll ab', () => {
    expect(normBetrag({ suggested_amount: 12000, reasoning: 'passt', currency: 'CHF' }))
      .toMatchObject({ suggested_amount: 12000, reasoning: 'passt', currency: 'CHF' })
    // 0 ist gültig («kein Betrag empfehlbar»)
    expect(normBetrag({ suggested_amount: 0, reasoning: 'x' })?.suggested_amount).toBe(0)
    expect(normBetrag(null)).toBeNull()
    expect(normBetrag('CHF 5000')).toBeNull()
    expect(normBetrag({ reasoning: 'ohne Betrag' })).toBeNull()
    expect(normBetrag({ suggested_amount: -5 })).toBeNull()
  })

  test('sonderRefVonMatch baut den Schlüssel, null bei fehlenden Teilen', () => {
    expect(sonderRefVonMatch({ ziel_collection: 'kirchen', ziel_id: 1 })).toBe('kirchen:1')
    expect(sonderRefVonMatch({ ziel_collection: null, ziel_id: 1 })).toBeNull()
    expect(sonderRefVonMatch({ ziel_collection: 'kirchen', ziel_id: null })).toBeNull()
  })

  test('bauSonderApplicationDaten: identifiziert ohne stiftung_id, mit sonder_ref', () => {
    const d = bauSonderApplicationDaten(
      { ziel_collection: 'kirchen', ziel_id: 1, ziel_name: 'Erprobungsfonds' },
      'neue_wege',
    )
    expect(d).toMatchObject({
      medium_id: 'neue_wege',
      sonder_ref: 'kirchen:1',
      stiftung_name: 'Erprobungsfonds',
      status: 'identifiziert',
      station: 1,
      verantwortung: 'offen',
      zuletzt_geaendert_quelle: 'sonder-matching',
    })
    expect('stiftung_id' in d).toBe(false)
    expect('bemerkung' in d).toBe(false)
  })

  test('bauSonderApplicationDaten: ausgeblendet mit Bemerkung und Station 7', () => {
    const d = bauSonderApplicationDaten(
      { ziel_collection: 'foerderer', ziel_id: 9, ziel_name: 'männer.ch' },
      'neue_wege',
      'ausgeblendet',
      'Ausgeblendet: männer.ch. Grund: Passt inhaltlich nicht.',
    )
    expect(d.status).toBe('ausgeblendet')
    expect(d.station).toBe(7)
    expect(d.sonder_ref).toBe('foerderer:9')
    expect(d.bemerkung).toContain('Passt inhaltlich nicht')
  })
})
