import {
  normalisiereWebseite,
  validiereStiftungEingabe,
  baueStiftungDaten,
} from './stiftung-anlegen'

describe('normalisiereWebseite', () => {
  it('gibt leer bei leerer Eingabe', () => {
    expect(normalisiereWebseite('')).toBe('')
    expect(normalisiereWebseite('   ')).toBe('')
  })
  it('ergänzt https:// wenn kein Schema da ist', () => {
    expect(normalisiereWebseite('porticus.com')).toBe('https://porticus.com')
    expect(normalisiereWebseite('www.porticus.com')).toBe('https://www.porticus.com')
  })
  it('behält bestehendes Schema', () => {
    expect(normalisiereWebseite('http://x.org')).toBe('http://x.org')
    expect(normalisiereWebseite('https://x.org/')).toBe('https://x.org/')
  })
  it('trimmt und entfernt führende Slashes vor dem Host', () => {
    expect(normalisiereWebseite('  porticus.com ')).toBe('https://porticus.com')
    expect(normalisiereWebseite('//porticus.com')).toBe('https://porticus.com')
  })
})

describe('validiereStiftungEingabe', () => {
  it('akzeptiert gültige Eingabe', () => {
    expect(validiereStiftungEingabe({ name: 'Porticus', webseite: 'porticus.com' })).toEqual([])
  })
  it('meldet fehlenden/zu kurzen Namen', () => {
    const f = validiereStiftungEingabe({ name: 'A', webseite: 'porticus.com' })
    expect(f).toHaveLength(1)
    expect(f[0].feld).toBe('name')
  })
  it('meldet fehlende Webseite', () => {
    const f = validiereStiftungEingabe({ name: 'Porticus', webseite: '' })
    expect(f.map(x => x.feld)).toContain('webseite')
  })
  it('meldet unplausible Webseite (keine Domain)', () => {
    const f = validiereStiftungEingabe({ name: 'Porticus', webseite: 'porticus' })
    expect(f.map(x => x.feld)).toContain('webseite')
  })
})

describe('baueStiftungDaten', () => {
  it('setzt ist_foerderstiftung=true und datenqualitaet=manuell', () => {
    const d = baueStiftungDaten({ name: '  Porticus ', webseite: 'porticus.com', land: 'INT' })
    expect(d).toMatchObject({
      Stiftungsname: 'Porticus',
      webseite: 'https://porticus.com',
      land: 'INT',
      ist_foerderstiftung: true,
      datenqualitaet: 'manuell',
      verifiziert: false,
    })
  })
  it('setzt sitz auf null wenn leer', () => {
    const d = baueStiftungDaten({ name: 'X Stiftung', webseite: 'x.org', land: 'CH' })
    expect(d.sitz).toBeNull()
  })
})
