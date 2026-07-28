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
  it('Absender ist mit Ramona vorbelegt und pro Mail ueberschreibbar (Entscheid 28.07.2026)', () => {
    expect(m.text).toContain('Ramona, Fundraising-Team We.Publish')
    const m2 = bauWillkommensmail({ mediumName: 'x', absender: 'Jolanda' })
    expect(m2.text).toContain('Jolanda, Fundraising-Team We.Publish')
  })

  /**
   * Der Fehler, den Michael Scheurer am 28.07.2026 gemeldet hat: in der
   * verschickten Mail stand woertlich «Hallo {name}» und «{absender}». Kein
   * Aufrufer kann das mehr ausloesen, weil die Vorlage selbst keine
   * Platzhalter mehr enthaelt.
   */
  it('enthaelt unter keinen Umstaenden einen rohen Platzhalter', () => {
    for (const mail of [
      bauWillkommensmail({ mediumName: 'bajour' }),
      bauWillkommensmail({ mediumName: 'bajour', name: 'Simon', absender: 'Jolanda' }),
      bauWillkommensmail({ mediumName: 'bajour', loginSeite: 'https://p.example/portal/login', slack: '#kanal' }),
    ]) {
      expect(mail.text).not.toMatch(/\{[a-z]+\}/)
      expect(mail.betreff).not.toMatch(/\{[a-z]+\}/)
    }
  })

  it('Anrede: mit Name persoenlich, ohne Name die Redaktion', () => {
    expect(bauWillkommensmail({ mediumName: 'bajour', name: 'Simon' }).text).toContain('Hallo Simon')
    expect(bauWillkommensmail({ mediumName: 'bajour' }).text).toContain('Liebe Redaktion von bajour')
  })

  it('traegt keinen Login-Link, sondern den Weg ueber die Login-Seite', () => {
    const mail = bauWillkommensmail({ mediumName: 'bajour', loginSeite: 'https://p.example/portal/login', stunden: 8 })
    expect(mail.text).toContain('https://p.example/portal/login')
    expect(mail.text).toContain('gilt 8 Stunden')
    expect(mail.text).not.toContain('einloesen?token=')
  })
  it('keine ae/oe/ue-Transkriptionen im Text (echte Umlaute)', () => {
    // typische Fehl-Transkriptionen
    expect(m.text).not.toMatch(/schoen|fuer|muesst|naechstes|Gruesse/)
  })
})
