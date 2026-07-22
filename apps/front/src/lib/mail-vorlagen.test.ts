import { bauWillkommensmail } from './mail-vorlagen'

describe('bauWillkommensmail', () => {
  const m = bauWillkommensmail({ mediumName: 'bajour' })

  it('nennt das Medium in Betreff und Text', () => {
    expect(m.betreff).toContain('bajour')
    expect(m.text).toContain('Liebe Redaktion von bajour')
  })
  it('erklärt das Vorbereiter-Prinzip (wir bereiten vor, ihr gebt frei)', () => {
    expect(m.text).toContain('ihr gebt frei')
  })
  it('nutzt Standard-Absender, überschreibbar', () => {
    expect(m.text).toContain('Ramona Sprenger')
    const m2 = bauWillkommensmail({ mediumName: 'x', absender: 'Jolanda' })
    expect(m2.text).toContain('Jolanda')
    expect(m2.text).not.toContain('Ramona Sprenger')
  })
  it('keine ae/oe/ue-Transkriptionen im Text (echte Umlaute)', () => {
    // typische Fehl-Transkriptionen
    expect(m.text).not.toMatch(/schoen|fuer|muesst|naechstes|Gruesse/)
  })
})
