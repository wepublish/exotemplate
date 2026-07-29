import { endungVon, istErlaubteVorlage, TEXTVORLAGE_ENDUNGEN, TEXTVORLAGE_MAX_BYTES } from './portal-textvorlage'

describe('endungVon', () => {
  it('liest die Endung kleingeschrieben', () => {
    expect(endungVon('Briefvorlage.DOCX')).toBe('docx')
    expect(endungVon('vorlage.tar.gz')).toBe('gz')
  })

  it('ohne Endung leer, kein Crash', () => {
    expect(endungVon('Briefvorlage')).toBe('')
    expect(endungVon('')).toBe('')
    expect(endungVon('   ')).toBe('')
  })
})

describe('istErlaubteVorlage', () => {
  it.each([...TEXTVORLAGE_ENDUNGEN])('erlaubt .%s', (endung) => {
    expect(istErlaubteVorlage(`vorlage.${endung}`)).toBe(true)
  })

  it('weist Bilder, Archive und Ausführbares ab', () => {
    for (const name of ['logo.png', 'daten.zip', 'skript.sh', 'programm.exe', 'tabelle.xlsx', 'vorlage']) {
      expect(istErlaubteVorlage(name)).toBe(false)
    }
  })

  it('Grossschreibung und Leerraum stören nicht', () => {
    expect(istErlaubteVorlage('  Briefkopf.PDF  ')).toBe(true)
  })
})

describe('TEXTVORLAGE_MAX_BYTES', () => {
  it('liegt bei 10 MB — kleiner als der 50-MB-Deckel für Unterlagen', () => {
    expect(TEXTVORLAGE_MAX_BYTES).toBe(10 * 1024 * 1024)
  })
})
