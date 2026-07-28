import { bauWillkommensmail } from './mail-vorlagen'

describe('bauWillkommensmail', () => {
  const m = bauWillkommensmail({ mediumName: 'bajour' })

  it('nennt das Medium in Betreff und Text', () => {
    expect(m.betreff).toContain('bajour')
    expect(m.text).toContain('Liebe Redaktion von bajour')
  })
  it('beschreibt den Portal-Onboarding-Weg (Zugang, Unterlagen, DNA-Freigabe, Matching, Gesuche, Stand)', () => {
    expect(m.text).toContain('Zugang zu unserem Portal')
    expect(m.text).toContain('Logo und eure Unterlagen')
    expect(m.text).toContain('Fundraising-DNA')
    expect(m.text).toContain('gebt sie frei')
    expect(m.text).toContain('schalten das Matching')
    expect(m.text).toContain('Gesuche vorbereiten')
    expect(m.text).toContain('Slack-Kanal')
  })
  it('kein fixer Absender: Platzhalter {absender} bleibt stehen, überschreibbar', () => {
    expect(m.text).toContain('{absender}, Fundraising-Team We.Publish')
    expect(m.text).not.toContain('Ramona')
    const m2 = bauWillkommensmail({ mediumName: 'x', absender: 'Jolanda' })
    expect(m2.text).toContain('Jolanda, Fundraising-Team We.Publish')
    expect(m2.text).not.toContain('{absender}')
  })
  it('keine ae/oe/ue-Transkriptionen im Text (echte Umlaute)', () => {
    // typische Fehl-Transkriptionen
    expect(m.text).not.toMatch(/schoen|fuer|muesst|naechstes|Gruesse/)
  })
})
