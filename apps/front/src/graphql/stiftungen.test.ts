/**
 * Unit-Tests für buildFilter (Stiftungsdatenbank-Seite).
 * Importiert die isolierte Hilfsfunktion aus einem eigenen Export.
 */
import { buildFilterForTest as buildFilter, clean } from './stiftungen.helpers'
import { ALLE_THEMEN_SLUGS } from '../lib/themen-facetten'

describe('buildFilter', () => {
  it('gibt undefined zurück wenn kein Filter aktiv', () => {
    expect(buildFilter('alle', 'alle', '')).toBeUndefined()
  })

  it('filtert nur nach Land CH', () => {
    const f = buildFilter('CH', 'alle', '')
    expect(f).toEqual({ land: { _eq: 'CH' } })
  })

  it('filtert nur nach Förderstiftungen', () => {
    const f = buildFilter('alle', 'nur_foerder', '')
    expect(f).toEqual({ ist_foerderstiftung: { _eq: true } })
  })

  it('kombiniert mehrere Bedingungen mit _and', () => {
    const f = buildFilter('CH', 'nur_foerder', 'Natur') as Record<string, unknown>
    expect(f).toHaveProperty('_and')
    const and = f._and as unknown[]
    expect(and).toHaveLength(3)
    expect(and).toContainEqual({ land: { _eq: 'CH' } })
    expect(and).toContainEqual({ ist_foerderstiftung: { _eq: true } })
    expect(and).toContainEqual({ Stiftungsname: { _icontains: 'Natur' } })
  })

  it('trimmt Leerzeichen bei der Suche', () => {
    const f = buildFilter('alle', 'alle', '  Klima  ')
    expect(f).toEqual({ Stiftungsname: { _icontains: 'Klima' } })
  })

  it('ignoriert leere Suche', () => {
    const f = buildFilter('alle', 'alle', '   ')
    expect(f).toBeUndefined()
  })
})

describe('buildFilter mit Themen-Facetten', () => {
  const T1 = 'medien_journalismus_lokaljournalismus'
  const T2 = 'kultur_kunst_lifestyle_theater_tanz'

  it('ein Thema -> direkte _eq-Bedingung', () => {
    expect(buildFilter('alle', 'alle', '', [T1])).toEqual({ [T1]: { _eq: true } })
  })

  it('mehrere Themen -> _or (Stiftung matcht IRGENDEIN Thema)', () => {
    const f = buildFilter('alle', 'alle', '', [T1, T2]) as Record<string, unknown>
    expect(f._or).toEqual([{ [T1]: { _eq: true } }, { [T2]: { _eq: true } }])
  })

  it('Themen kombiniert mit Land -> _and mit _or-Block', () => {
    const f = buildFilter('CH', 'alle', '', [T1, T2]) as Record<string, unknown>
    const and = f._and as unknown[]
    expect(and).toContainEqual({ land: { _eq: 'CH' } })
    expect(and).toContainEqual({ _or: [{ [T1]: { _eq: true } }, { [T2]: { _eq: true } }] })
  })

  it('unbekannte/erfundene Slugs werden verworfen (Whitelist)', () => {
    expect(buildFilter('alle', 'alle', '', ['drop_table_stiftungen'])).toBeUndefined()
    // gültiges Thema bleibt, ungültiges fliegt raus
    expect(buildFilter('alle', 'alle', '', ['boese', T1])).toEqual({ [T1]: { _eq: true } })
  })

  it('alle 98 echten Slugs sind gültig (kein versehentliches Verwerfen)', () => {
    const f = buildFilter('alle', 'alle', '', [...ALLE_THEMEN_SLUGS]) as Record<string, unknown>
    expect((f._or as unknown[]).length).toBe(98)
  })

  it('leere Themenliste ändert nichts', () => {
    expect(buildFilter('CH', 'alle', '', [])).toEqual({ land: { _eq: 'CH' } })
  })
})

describe('clean', () => {
  it('behält echte Werte', () => {
    expect(clean('Zürich')).toBe('Zürich')
    expect(clean('  CHF 20’000–80’000  ')).toBe('CHF 20’000–80’000')
  })

  it('behandelt bekannte Platzhalter wie leer', () => {
    expect(clean('Keine Angabe gefunden')).toBeNull()
    expect(clean('keine angaben')).toBeNull()
    expect(clean('nicht bekannt')).toBeNull()
    expect(clean('n/a')).toBeNull()
    expect(clean('k.A.')).toBeNull()
    expect(clean('—')).toBeNull()
    expect(clean('null')).toBeNull()
  })

  it('behandelt leer/null/undefined wie leer', () => {
    expect(clean('')).toBeNull()
    expect(clean('   ')).toBeNull()
    expect(clean(null)).toBeNull()
    expect(clean(undefined)).toBeNull()
  })
})
