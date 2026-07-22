import { baueCoworkAuftrag } from './cowork-auftrag'

describe('baueCoworkAuftrag (Task 11, Operator-Warteschlange)', () => {
  const BASIS = {
    gesuchPrompt: 'PHASE 1: Recherchiere die Stiftung ZUERST.\n\nPHASE 2: Schreibe das Gesuch.',
    mediumName: 'Bajour',
    stiftungName: 'Ernst Göhner Stiftung',
    ablagePfad: 'bajour/02_antraege_work_in_progress/ernst_goehner_stiftung',
  }

  it('enthält den Kopf mit Medium und Stiftung', () => {
    const text = baueCoworkAuftrag(BASIS)
    expect(text).toContain('Cowork-Auftrag: Gesuch Bajour × Ernst Göhner Stiftung')
  })

  it('enthält den Ablagepfad', () => {
    const text = baueCoworkAuftrag(BASIS)
    expect(text).toContain(BASIS.ablagePfad)
  })

  it('enthält den kompletten Gesuch-Prompt am Ende', () => {
    const text = baueCoworkAuftrag(BASIS)
    expect(text).toContain(BASIS.gesuchPrompt)
    expect(text.indexOf(BASIS.gesuchPrompt)).toBeGreaterThan(text.indexOf('Cowork-Auftrag'))
  })

  it('nennt die Sprachregeln (kein scharfes s, «» als Zitatzeichen)', () => {
    const text = baueCoworkAuftrag(BASIS)
    expect(text.toLowerCase()).toContain('ss')
    expect(text).toContain('«')
    expect(text).toContain('»')
  })

  it('nennt die Beilagen-Anweisung (zusammenstellen + Ablage im Drive-Ordner)', () => {
    const text = baueCoworkAuftrag(BASIS)
    expect(text).toMatch(/Beilage/)
    expect(text).toMatch(/Drive-Ordner/)
  })

  it('enthält kein scharfes s (Unicode-Escape statt Literal in der Assertion)', () => {
    const text = baueCoworkAuftrag(BASIS)
    expect(text).not.toMatch(/\u00df/)
  })

  it('enthält keine Gedankenstriche (Halbgeviert-/Geviertstrich)', () => {
    const text = baueCoworkAuftrag(BASIS)
    // Unicode-Escapes statt Literalen: die Zeichen selbst tauchen im Quelltext
    // nirgends auf (Halbgeviertstrich U+2013, Geviertstrich U+2014).
    expect(text).not.toMatch(/[\u2013\u2014]/)
  })

  it('ist rein (kein IO, deterministisch bei gleichen Argumenten)', () => {
    expect(baueCoworkAuftrag(BASIS)).toBe(baueCoworkAuftrag({ ...BASIS }))
  })
})
