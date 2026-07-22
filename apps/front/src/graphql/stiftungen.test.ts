/**
 * Unit-Tests für buildFilter (Stiftungsdatenbank-Seite).
 * Importiert die isolierte Hilfsfunktion aus einem eigenen Export.
 */
import { buildFilterForTest as buildFilter, clean } from './stiftungen.helpers'

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
