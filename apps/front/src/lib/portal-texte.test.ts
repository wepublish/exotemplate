import { MAIL_EINLADUNG, MAIL_NEUER_LINK, PORTAL_TEXTE, fuelleText, fuelleVorlage } from './portal-texte'

describe('fuelleVorlage', () => {
  it('MAIL_EINLADUNG: ersetzt {medium} und {link}, lässt {name} unangetastet', () => {
    const ergebnis = fuelleVorlage(MAIL_EINLADUNG, {
      medium: 'Bajour',
      link: 'https://portal.example/api/portal/einloesen?token=abc.def',
    })
    expect(ergebnis.text).toContain('Schön, dass Bajour beim Fundraising as a Service von We.Publish dabei ist.')
    expect(ergebnis.text).toContain('So läuft es Schritt für Schritt:')
    expect(ergebnis.text).toContain('https://portal.example/api/portal/einloesen?token=abc.def')
    expect(ergebnis.text).toContain('Hallo {name}')
    expect(ergebnis.text).not.toContain('{medium}')
    expect(ergebnis.text).not.toContain('{link}')
    expect(ergebnis.betreff).toBe(MAIL_EINLADUNG.betreff)
  })

  it('MAIL_NEUER_LINK: ersetzt {link}, lässt {name} unangetastet, ohne {medium}-Erwähnung', () => {
    const ergebnis = fuelleVorlage(MAIL_NEUER_LINK, { link: 'https://portal.example/api/portal/einloesen?token=xyz.123' })
    expect(ergebnis.text).toContain('https://portal.example/api/portal/einloesen?token=xyz.123')
    expect(ergebnis.text).toContain('Hallo {name}')
    expect(ergebnis.text).not.toContain('{link}')
    expect(ergebnis.text).not.toContain('{medium}')
  })

  it('unbekannte Platzhalter bleiben stehen, wenn kein Wert übergeben wird', () => {
    const ergebnis = fuelleVorlage({ betreff: 'x', text: 'Hallo {name}, dein Link: {link}' }, {})
    expect(ergebnis.text).toBe('Hallo {name}, dein Link: {link}')
    expect(ergebnis.betreff).toBe('x')
  })

  it('mehrfaches Vorkommen desselben Platzhalters wird vollständig ersetzt', () => {
    const ergebnis = fuelleVorlage({ betreff: '{link}', text: '{link} und nochmal {link}' }, { link: 'L' })
    expect(ergebnis.text).toBe('L und nochmal L')
    expect(ergebnis.betreff).toBe('L')
  })

  it('leerer werte-Wert (leerer String) ersetzt trotzdem, ohne den Platzhalter stehen zu lassen', () => {
    const ergebnis = fuelleVorlage({ betreff: 'x', text: 'Hallo {name}' }, { name: '' })
    expect(ergebnis.text).toBe('Hallo ')
  })
})

describe('fuelleText (roher String, Grundlage von fuelleVorlage)', () => {
  it('ersetzt {medium} in uebersicht.willkommen', () => {
    expect(fuelleText(PORTAL_TEXTE['uebersicht.willkommen'], { medium: 'Bajour' })).toBe('Schön, dass ihr da seid, Bajour.')
  })

  it('unbekannter Platzhalter bleibt stehen', () => {
    expect(fuelleText('Hallo {name}', {})).toBe('Hallo {name}')
  })
})

describe('PORTAL_TEXTE', () => {
  const ERWARTETE_SCHLUESSEL = [
    'login.titel',
    'login.intro',
    'login.link_angefordert',
    'login.fehler',
    'uebersicht.willkommen',
    'uebersicht.stationen_intro',
    // Nächster-Schritt-Sätze pro Station (Task 5): im Wording-Dokument nicht
    // vorgegeben, für die Übersichtsseite ergänzt (siehe Task-5-Report).
    // logo (Pflicht-Erststep-Feature) folgt demselben Muster, nachträglich ergänzt.
    'uebersicht.naechster_schritt.logo',
    'uebersicht.naechster_schritt.unterlagen',
    'uebersicht.naechster_schritt.dna',
    'uebersicht.naechster_schritt.freischaltung',
    'uebersicht.naechster_schritt.treffer',
    'uebersicht.naechster_schritt.gesuche',
    // Logo-Block (Pflicht-Erststep-Feature, siehe portal-status.ts baueStationen).
    'logo.titel',
    'logo.hinweis',
    'logo.hochladen_knopf',
    'logo.kein_logo',
    'unterlagen.intro',
    'unterlagen.fragebogen_intro',
    'unterlagen.dna_knopf_hinweis',
    // Feinere Wording-Schlüssel der Unterlagen-Seite (Task 6, siehe Task-6-Report).
    'unterlagen.upload_titel',
    'unterlagen.upload_hinweis',
    'unterlagen.url_titel',
    'unterlagen.url_hinweis',
    'unterlagen.fragebogen_titel',
    'unterlagen.fragebogen_selbstbeschrieb_label',
    'unterlagen.fragebogen_fokus_label',
    'unterlagen.fragebogen_nogos_label',
    'unterlagen.liste_titel',
    'unterlagen.liste_leer',
    'unterlagen.wepublish_titel',
    'unterlagen.dna_knopf',
    'unterlagen.dna_knopf_gesperrt',
    // Logo-Gate für denselben Knopf (Pflicht-Erststep-Feature).
    'unterlagen.dna_knopf_gesperrt_logo',
    'dna.intro',
    'dna.freigabe_hinweis',
    'dna.warten_auf_freischaltung',
    // Feinere Wording-Schlüssel der DNA-Seite (Task 7, siehe Task-7-Report).
    'dna.freigeben_knopf',
    'dna.freigeben_bestaetigung',
    'dna.neu_erstellen_knopf',
    'dna.wird_erstellt',
    'dna.fehlgeschlagen',
    // Logo-Gate auf der DNA-Seite (Pflicht-Erststep-Feature).
    'dna.logo_fehlt',
    'treffer.intro',
    'treffer.anschreiben_hinweis',
    'treffer.leer',
    // Feinere Wording-Schlüssel der Treffer-Seite (Task 8, siehe Task-8-Report).
    'treffer.anschreiben_knopf',
    'treffer.nicht_relevant_knopf',
    'treffer.nicht_relevant_hinweis',
    // Feinere Wording-Schlüssel Consent-Flow (Task 9, siehe Task-9-Report).
    'treffer.bereits_vorhanden_hinweis',
    'consent.titel',
    'consent.checkbox_label',
    'consent.bestaetigen_knopf',
    'consent.abbrechen_knopf',
    'consent.kurzfassung',
    'gesuche.in_arbeit',
    'gesuche.bereit',
    'gesuche.final_hinweis',
    'gesuche.abgeschickt_frage',
    'gesuche.nachfassen_reminder',
    // Feinere Wording-Schlüssel der Gesuche-Seite (Task 10, siehe Task-10-Report).
    'gesuche.leer',
    'gesuche.speichern_knopf',
    'gesuche.final_knopf',
    'gesuche.abgeschickt_knopf',
    'gesuche.antwort_knopf',
    // Gemeinsamer Fehlertext der Portal-Seiten (Task 5, siehe Task-5-Report).
    'fehler.daten_nicht_verfuegbar',
  ]

  it('enthält exakt die erwarteten Schlüssel aus portal-wording-final.md plus die in Task 5 ergänzten (uebersicht.naechster_schritt.*, fehler.*), keinen mehr, keinen weniger', () => {
    expect(Object.keys(PORTAL_TEXTE).sort()).toEqual([...ERWARTETE_SCHLUESSEL].sort())
  })

  it('jeder Wert ist ein nicht-leerer String', () => {
    for (const schluessel of ERWARTETE_SCHLUESSEL) {
      expect(typeof PORTAL_TEXTE[schluessel]).toBe('string')
      expect(PORTAL_TEXTE[schluessel].length).toBeGreaterThan(0)
    }
  })

  it('uebersicht.willkommen trägt den {medium}-Platzhalter', () => {
    expect(PORTAL_TEXTE['uebersicht.willkommen']).toContain('{medium}')
  })

  it('stichprobenweise Wortlaut-Prüfung (verhindert stille Tippfehler beim Abtippen)', () => {
    expect(PORTAL_TEXTE['login.titel']).toBe('Willkommen zurück')
    expect(PORTAL_TEXTE['dna.intro']).toBe(
      'Das ist eure Fundraising-DNA, euer Profil in unseren Worten. Lest es in Ruhe durch und sagt uns, ob es euch trifft.',
    )
    expect(PORTAL_TEXTE['gesuche.nachfassen_reminder']).toBe(
      'Seit der Einreichung sind drei Monate vergangen und noch keine Antwort da. Wenn ihr mögt, haken wir für euch bei der Stiftung nach.',
    )
  })
})
