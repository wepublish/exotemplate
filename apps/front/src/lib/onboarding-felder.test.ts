import { baueFelderDiff, beschreibeDiff, leseEmailListe, pruefeMediumIdentitaet } from './onboarding-felder'

const ZWOLF = {
  website: 'https://www.zwoelf.ch/',
  wepublish_api_url: 'https://api-zwoelf.wepublish.cloud/v1',
  mailchimp_archive_url: null,
  kontakt_emails: ['sykora@zwoelf.ch'],
  slack_channel: 'C0BFYRBKL9F',
}

/** Die Eingabe, die den geladenen Stand unverändert spiegelt. */
function unangetastet() {
  return {
    website: ZWOLF.website,
    wepublishUrl: ZWOLF.wepublish_api_url,
    mailchimpUrl: '',
    kontaktEmails: 'sykora@zwoelf.ch',
    slackChannel: ZWOLF.slack_channel,
  }
}

describe('baueFelderDiff', () => {
  it('schickt nichts, wenn niemand etwas geändert hat', () => {
    expect(baueFelderDiff(unangetastet(), ZWOLF)).toEqual({})
  })

  it('schickt nur das eine geänderte Feld', () => {
    const diff = baueFelderDiff({ ...unangetastet(), mailchimpUrl: 'https://mailchi.mp/zwoelf' }, ZWOLF)
    expect(diff).toEqual({ mailchimp_archive_url: 'https://mailchi.mp/zwoelf' })
  })

  /**
   * Der Kern des Befunds vom 29.07.2026: ein leeres Formular darf keine
   * bestehenden Werte löschen. Vorher gingen alle fünf Felder als null raus.
   */
  it('leert NICHTS, wenn das Formular gar nicht zum Medium gehört (alles leer)', () => {
    const diff = baueFelderDiff(
      { website: '', wepublishUrl: '', mailchimpUrl: '', kontaktEmails: '', slackChannel: '' },
      ZWOLF,
    )
    // Es entsteht ein Diff (der Nutzer HAT ja leere Felder), aber genau der wird
    // durch die Identitätsprüfung abgefangen — siehe unten. Wichtig hier: die
    // unveränderten Felder sind nicht dabei.
    expect(diff).not.toHaveProperty('mailchimp_archive_url')
    expect(Object.keys(diff).sort()).toEqual(['kontakt_emails', 'slack_channel', 'website', 'wepublish_api_url'])
  })

  it('erlaubt bewusstes Leeren eines einzelnen Feldes', () => {
    const diff = baueFelderDiff({ ...unangetastet(), website: '' }, ZWOLF)
    expect(diff).toEqual({ website: null })
  })

  it('behandelt Leerraum wie leer', () => {
    const diff = baueFelderDiff({ ...unangetastet(), website: '   ' }, ZWOLF)
    expect(diff).toEqual({ website: null })
  })

  it('erkennt geänderte Kontakt-Mails, ignoriert reine Formatierung', () => {
    expect(baueFelderDiff({ ...unangetastet(), kontaktEmails: ' sykora@zwoelf.ch , ' }, ZWOLF)).toEqual({})
    expect(baueFelderDiff({ ...unangetastet(), kontaktEmails: 'sykora@zwoelf.ch, chef@zwoelf.ch' }, ZWOLF)).toEqual({
      kontakt_emails: ['sykora@zwoelf.ch', 'chef@zwoelf.ch'],
    })
  })

  it('verkraftet ein Medium ohne jeden gesetzten Wert', () => {
    const leer = {}
    expect(baueFelderDiff({ website: '', wepublishUrl: '', mailchimpUrl: '', kontaktEmails: '', slackChannel: '' }, leer)).toEqual({})
  })
})

describe('pruefeMediumIdentitaet', () => {
  it('lässt den Normalfall durch', () => {
    expect(pruefeMediumIdentitaet('zwolf', 'zwolf')).toEqual({ ok: true })
  })

  it('stoppt den Fremddaten-Save und nennt beide Medien', () => {
    const r = pruefeMediumIdentitaet('vmz', 'zwolf')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.fehler).toContain('vmz')
      expect(r.fehler).toContain('zwolf')
    }
  })

  it('prüft nicht, solange nichts ausgewählt ist', () => {
    expect(pruefeMediumIdentitaet('zwolf', '')).toEqual({ ok: true })
  })
})

describe('Hilfsfunktionen', () => {
  it('leseEmailListe wirft Leereinträge weg', () => {
    expect(leseEmailListe(' a@b.ch ,, c@d.ch , ')).toEqual(['a@b.ch', 'c@d.ch'])
    expect(leseEmailListe('')).toEqual([])
  })

  it('beschreibeDiff nennt die Felder auf Deutsch', () => {
    expect(beschreibeDiff({ website: null, kontakt_emails: ['a@b.ch'] })).toBe('Website, Kontakt-Mails')
  })
})
