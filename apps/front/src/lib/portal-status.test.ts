import {
  baueStationen,
  baueAnzeigeSchritte,
  baueReminder,
  baueUebersicht,
  STATION_LABEL,
  berechneWissensScore,
  baueFragebogenEintrag,
  parseFragebogenEintrag,
  istFragebogenEintrag,
  bestimmeWissensQuelle,
  gesuchPortalStatus,
  fuegeGesuchVersionHinzu,
  GESUCH_VERSIONEN_MAX,
  parsePortal,
  type ReminderKandidat,
  type WissensZaehler,
  type GesuchPortalApplication,
  type GesuchVersion,
} from './portal-status'
import { PORTAL_TEXTE } from './portal-texte'

describe('baueStationen (Fortschritts-Ableitung)', () => {
  it('gar nichts erledigt: logo aktiv, alle anderen offen (Logo ist der Pflicht-Erststep)', () => {
    const stationen = baueStationen({
      hatLogo: false,
      hatUnterlagen: false,
      dnaFreigegeben: false,
      freigeschaltet: false,
      hatGesuchUeberPortal: false,
    })
    expect(stationen).toEqual([
      { key: 'logo', status: 'aktiv' },
      { key: 'unterlagen', status: 'offen' },
      { key: 'dna', status: 'offen' },
      { key: 'freischaltung', status: 'offen' },
      { key: 'treffer', status: 'offen' },
      { key: 'gesuche', status: 'offen' },
    ])
  })

  it('Logo da, sonst nichts erledigt: unterlagen aktiv, alle anderen offen', () => {
    const stationen = baueStationen({
      hatLogo: true,
      hatUnterlagen: false,
      dnaFreigegeben: false,
      freigeschaltet: false,
      hatGesuchUeberPortal: false,
    })
    expect(stationen).toEqual([
      { key: 'logo', status: 'erledigt' },
      { key: 'unterlagen', status: 'aktiv' },
      { key: 'dna', status: 'offen' },
      { key: 'freischaltung', status: 'offen' },
      { key: 'treffer', status: 'offen' },
      { key: 'gesuche', status: 'offen' },
    ])
  })

  it('Logo und Unterlagen da, DNA noch nicht freigegeben: dna aktiv', () => {
    const stationen = baueStationen({
      hatLogo: true,
      hatUnterlagen: true,
      dnaFreigegeben: false,
      freigeschaltet: false,
      hatGesuchUeberPortal: false,
    })
    expect(stationen).toEqual([
      { key: 'logo', status: 'erledigt' },
      { key: 'unterlagen', status: 'erledigt' },
      { key: 'dna', status: 'aktiv' },
      { key: 'freischaltung', status: 'offen' },
      { key: 'treffer', status: 'offen' },
      { key: 'gesuche', status: 'offen' },
    ])
  })

  it('DNA freigegeben, noch nicht freigeschaltet: freischaltung aktiv', () => {
    const stationen = baueStationen({
      hatLogo: true,
      hatUnterlagen: true,
      dnaFreigegeben: true,
      freigeschaltet: false,
      hatGesuchUeberPortal: false,
    })
    expect(stationen).toEqual([
      { key: 'logo', status: 'erledigt' },
      { key: 'unterlagen', status: 'erledigt' },
      { key: 'dna', status: 'erledigt' },
      { key: 'freischaltung', status: 'aktiv' },
      { key: 'treffer', status: 'offen' },
      { key: 'gesuche', status: 'offen' },
    ])
  })

  it('freigeschaltet, noch kein Gesuch über das Portal: treffer aktiv, gesuche offen', () => {
    const stationen = baueStationen({
      hatLogo: true,
      hatUnterlagen: true,
      dnaFreigegeben: true,
      freigeschaltet: true,
      hatGesuchUeberPortal: false,
    })
    expect(stationen).toEqual([
      { key: 'logo', status: 'erledigt' },
      { key: 'unterlagen', status: 'erledigt' },
      { key: 'dna', status: 'erledigt' },
      { key: 'freischaltung', status: 'erledigt' },
      { key: 'treffer', status: 'aktiv' },
      { key: 'gesuche', status: 'offen' },
    ])
  })

  it('freigeschaltet UND mind. ein Gesuch über das Portal: treffer bleibt aktiv, gesuche erledigt', () => {
    const stationen = baueStationen({
      hatLogo: true,
      hatUnterlagen: true,
      dnaFreigegeben: true,
      freigeschaltet: true,
      hatGesuchUeberPortal: true,
    })
    expect(stationen).toEqual([
      { key: 'logo', status: 'erledigt' },
      { key: 'unterlagen', status: 'erledigt' },
      { key: 'dna', status: 'erledigt' },
      { key: 'freischaltung', status: 'erledigt' },
      { key: 'treffer', status: 'aktiv' },
      { key: 'gesuche', status: 'erledigt' },
    ])
  })

  it('genau eine Station ist in jedem Fall aktiv', () => {
    const faelle = [
      { hatLogo: false, hatUnterlagen: false, dnaFreigegeben: false, freigeschaltet: false, hatGesuchUeberPortal: false },
      { hatLogo: true, hatUnterlagen: false, dnaFreigegeben: false, freigeschaltet: false, hatGesuchUeberPortal: false },
      { hatLogo: true, hatUnterlagen: true, dnaFreigegeben: false, freigeschaltet: false, hatGesuchUeberPortal: false },
      { hatLogo: true, hatUnterlagen: true, dnaFreigegeben: true, freigeschaltet: false, hatGesuchUeberPortal: false },
      { hatLogo: true, hatUnterlagen: true, dnaFreigegeben: true, freigeschaltet: true, hatGesuchUeberPortal: false },
      { hatLogo: true, hatUnterlagen: true, dnaFreigegeben: true, freigeschaltet: true, hatGesuchUeberPortal: true },
    ]
    for (const fall of faelle) {
      const stationen = baueStationen(fall)
      const aktive = stationen.filter((s) => s.status === 'aktiv')
      expect(aktive).toHaveLength(1)
    }
  })
})

describe('baueUebersicht (naechsterSchritt)', () => {
  it('gar nichts erledigt: naechsterSchritt passt zur Station logo', () => {
    const ergebnis = baueUebersicht(
      { hatLogo: false, hatUnterlagen: false, dnaFreigegeben: false, freigeschaltet: false, hatGesuchUeberPortal: false },
      [],
      new Date('2026-07-09T00:00:00Z'),
    )
    expect(ergebnis.naechsterSchritt).toBe(PORTAL_TEXTE['uebersicht.naechster_schritt.logo'])
  })

  it('Logo da, sonst nichts erledigt: naechsterSchritt passt zur Station unterlagen', () => {
    const ergebnis = baueUebersicht(
      { hatLogo: true, hatUnterlagen: false, dnaFreigegeben: false, freigeschaltet: false, hatGesuchUeberPortal: false },
      [],
      new Date('2026-07-09T00:00:00Z'),
    )
    expect(ergebnis.naechsterSchritt).toBe(PORTAL_TEXTE['uebersicht.naechster_schritt.unterlagen'])
  })

  it('freigeschaltet: naechsterSchritt passt zur Station treffer', () => {
    const ergebnis = baueUebersicht(
      { hatLogo: true, hatUnterlagen: true, dnaFreigegeben: true, freigeschaltet: true, hatGesuchUeberPortal: false },
      [],
      new Date('2026-07-09T00:00:00Z'),
    )
    expect(ergebnis.naechsterSchritt).toBe(PORTAL_TEXTE['uebersicht.naechster_schritt.treffer'])
  })

  describe('Förderhistorie-Hinweis (Design 2026-07-29)', () => {
    const hinweis = PORTAL_TEXTE['uebersicht.naechster_schritt.foerderhistorie_hinweis']

    it('Unterlagen-Phase ohne Förderhistorie: Hinweis wird angehängt', () => {
      const ergebnis = baueUebersicht(
        { hatLogo: true, hatUnterlagen: false, dnaFreigegeben: false, freigeschaltet: false, hatGesuchUeberPortal: false, hatFoerderhistorie: false },
        [],
        new Date('2026-07-09T00:00:00Z'),
      )
      expect(ergebnis.naechsterSchritt).toBe(`${PORTAL_TEXTE['uebersicht.naechster_schritt.unterlagen']} ${hinweis}`)
    })

    it('DNA-Phase ohne Förderhistorie: Hinweis wird angehängt', () => {
      const ergebnis = baueUebersicht(
        { hatLogo: true, hatUnterlagen: true, dnaFreigegeben: false, freigeschaltet: false, hatGesuchUeberPortal: false, hatFoerderhistorie: false },
        [],
        new Date('2026-07-09T00:00:00Z'),
      )
      expect(ergebnis.naechsterSchritt).toBe(`${PORTAL_TEXTE['uebersicht.naechster_schritt.dna']} ${hinweis}`)
    })

    it('mit erfasster Förderhistorie: kein Hinweis', () => {
      const ergebnis = baueUebersicht(
        { hatLogo: true, hatUnterlagen: true, dnaFreigegeben: false, freigeschaltet: false, hatGesuchUeberPortal: false, hatFoerderhistorie: true },
        [],
        new Date('2026-07-09T00:00:00Z'),
      )
      expect(ergebnis.naechsterSchritt).toBe(PORTAL_TEXTE['uebersicht.naechster_schritt.dna'])
    })

    it('Logo-Phase und nach der Freischaltung: kein Hinweis, auch ohne Förderhistorie', () => {
      const logoPhase = baueUebersicht(
        { hatLogo: false, hatUnterlagen: false, dnaFreigegeben: false, freigeschaltet: false, hatGesuchUeberPortal: false, hatFoerderhistorie: false },
        [],
        new Date('2026-07-09T00:00:00Z'),
      )
      expect(logoPhase.naechsterSchritt).toBe(PORTAL_TEXTE['uebersicht.naechster_schritt.logo'])
      const frei = baueUebersicht(
        { hatLogo: true, hatUnterlagen: true, dnaFreigegeben: true, freigeschaltet: true, hatGesuchUeberPortal: false, hatFoerderhistorie: false },
        [],
        new Date('2026-07-09T00:00:00Z'),
      )
      expect(frei.naechsterSchritt).toBe(PORTAL_TEXTE['uebersicht.naechster_schritt.treffer'])
    })

    it('ohne das optionale Flag (alte Aufrufer): kein Hinweis', () => {
      const ergebnis = baueUebersicht(
        { hatLogo: true, hatUnterlagen: false, dnaFreigegeben: false, freigeschaltet: false, hatGesuchUeberPortal: false },
        [],
        new Date('2026-07-09T00:00:00Z'),
      )
      expect(ergebnis.naechsterSchritt).toBe(PORTAL_TEXTE['uebersicht.naechster_schritt.unterlagen'])
    })
  })

  it('liefert stationen, naechsterSchritt und reminder in einem Objekt', () => {
    const ergebnis = baueUebersicht(
      { hatLogo: true, hatUnterlagen: true, dnaFreigegeben: false, freigeschaltet: false, hatGesuchUeberPortal: false },
      [],
      new Date('2026-07-09T00:00:00Z'),
    )
    expect(ergebnis).toEqual({
      stationen: [
        { key: 'logo', status: 'erledigt' },
        { key: 'unterlagen', status: 'erledigt' },
        { key: 'dna', status: 'aktiv' },
        { key: 'freischaltung', status: 'offen' },
        { key: 'treffer', status: 'offen' },
        { key: 'gesuche', status: 'offen' },
      ],
      naechsterSchritt: PORTAL_TEXTE['uebersicht.naechster_schritt.dna'],
      reminder: [],
    })
  })
})

describe('baueReminder (Nachfass-Erinnerung, 90-Tage-Regel)', () => {
  const jetzt = new Date('2026-07-09T00:00:00Z')

  it('genau 90 Tage sind noch KEIN Reminder (strikt älter als 90 Tage)', () => {
    const genau90TageAlt: ReminderKandidat = {
      abgeschicktAm: new Date(jetzt.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'eingereicht',
      stiftungName: null,
    }
    expect(baueReminder([genau90TageAlt], jetzt)).toEqual([])
  })

  it('91 Tage alt, Status eingereicht: Reminder mit Text aus PORTAL_TEXTE und Datum', () => {
    const kandidat: ReminderKandidat = {
      abgeschicktAm: new Date(jetzt.getTime() - 91 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'eingereicht',
      stiftungName: null,
    }
    const reminder = baueReminder([kandidat], jetzt)
    expect(reminder).toEqual([{ text: PORTAL_TEXTE['gesuche.nachfassen_reminder'], datum: kandidat.abgeschicktAm }])
  })

  it('91 Tage alt, Stiftungsname vorhanden: Name wird an den Text angehängt', () => {
    const kandidat: ReminderKandidat = {
      abgeschicktAm: new Date(jetzt.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'eingereicht',
      stiftungName: 'Stiftung Mercator',
    }
    const reminder = baueReminder([kandidat], jetzt)
    expect(reminder[0].text).toBe(`${PORTAL_TEXTE['gesuche.nachfassen_reminder']} (Stiftung: Stiftung Mercator)`)
  })

  it('Status zugesagt: kein Reminder, auch wenn längst über 90 Tage', () => {
    const kandidat: ReminderKandidat = {
      abgeschicktAm: new Date(jetzt.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'zugesagt',
      stiftungName: null,
    }
    expect(baueReminder([kandidat], jetzt)).toEqual([])
  })

  it('Status abgelehnt: kein Reminder', () => {
    const kandidat: ReminderKandidat = {
      abgeschicktAm: new Date(jetzt.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'abgelehnt',
      stiftungName: null,
    }
    expect(baueReminder([kandidat], jetzt)).toEqual([])
  })

  it('weniger als 90 Tage: kein Reminder', () => {
    const kandidat: ReminderKandidat = {
      abgeschicktAm: new Date(jetzt.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'eingereicht',
      stiftungName: null,
    }
    expect(baueReminder([kandidat], jetzt)).toEqual([])
  })

  it('kaputtes Datum wird ignoriert statt zu crashen', () => {
    const kandidat: ReminderKandidat = { abgeschicktAm: 'nicht-ein-datum', status: 'eingereicht', stiftungName: null }
    expect(baueReminder([kandidat], jetzt)).toEqual([])
  })

  it('mehrere Kandidaten: nur die fälligen erscheinen, Reihenfolge bleibt erhalten', () => {
    const faellig: ReminderKandidat = {
      abgeschicktAm: new Date(jetzt.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'eingereicht',
      stiftungName: 'Stiftung A',
    }
    const nichtFaellig: ReminderKandidat = {
      abgeschicktAm: new Date(jetzt.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'eingereicht',
      stiftungName: 'Stiftung B',
    }
    const zweiterFaellig: ReminderKandidat = {
      abgeschicktAm: new Date(jetzt.getTime() - 95 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'in_arbeit',
      stiftungName: 'Stiftung C',
    }
    const reminder = baueReminder([faellig, nichtFaellig, zweiterFaellig], jetzt)
    expect(reminder).toHaveLength(2)
    expect(reminder[0].text).toContain('Stiftung A')
    expect(reminder[1].text).toContain('Stiftung C')
  })
})

describe('STATION_LABEL', () => {
  it('hat für jede Station-Reihenfolge-Position ein Label', () => {
    const stationen = baueStationen({
      hatLogo: false,
      hatUnterlagen: false,
      dnaFreigegeben: false,
      freigeschaltet: false,
      hatGesuchUeberPortal: false,
    })
    for (const s of stationen) {
      expect(typeof STATION_LABEL[s.key]).toBe('string')
      expect(STATION_LABEL[s.key].length).toBeGreaterThan(0)
    }
  })
})

describe('berechneWissensScore (Unterlagen-Vollständigkeit, /api/portal/wissen)', () => {
  const LEER: WissensZaehler = { published_article: 0, newsletter: 0, previous_application: 0, general_info: 0 }

  it('nichts vorhanden: 0', () => {
    expect(berechneWissensScore(LEER)).toBe(0)
  })

  it('nur published_article: eine von drei Dimensionen (33)', () => {
    expect(berechneWissensScore({ ...LEER, published_article: 1 })).toBe(33)
  })

  it('nur newsletter zählt für dieselbe Dimension wie published_article (33)', () => {
    expect(berechneWissensScore({ ...LEER, newsletter: 2 })).toBe(33)
  })

  it('published_article UND newsletter zusammen zählen weiterhin nur EINE Dimension (33)', () => {
    expect(berechneWissensScore({ ...LEER, published_article: 3, newsletter: 5 })).toBe(33)
  })

  it('nur previous_application: 33', () => {
    expect(berechneWissensScore({ ...LEER, previous_application: 1 })).toBe(33)
  })

  it('nur general_info: 33', () => {
    expect(berechneWissensScore({ ...LEER, general_info: 1 })).toBe(33)
  })

  it('zwei von drei Dimensionen: 67 (gerundet)', () => {
    expect(berechneWissensScore({ ...LEER, previous_application: 1, general_info: 1 })).toBe(67)
  })

  it('alle drei Dimensionen abgedeckt: 100', () => {
    expect(
      berechneWissensScore({ published_article: 1, newsletter: 0, previous_application: 1, general_info: 1 }),
    ).toBe(100)
  })
})

describe('baueFragebogenEintrag (Fragebogen-Eintrag für POST /api/portal/wissen)', () => {
  const jetzt = new Date('2026-07-09T10:00:00Z')

  it('alle drei Felder gefüllt: Titel mit Datum, Zwischentitel + Texte in Reihenfolge', () => {
    const eintrag = baueFragebogenEintrag(
      { selbstbeschrieb: 'Wir sind ein Lokalmedium.', fokus: 'Mehr Reichweite in der Region.', nogos: 'Keine Werbung für Tabak.' },
      jetzt,
    )
    expect(eintrag).not.toBeNull()
    expect(eintrag!.title).toBe('Fragebogen 2026-07-09')
    expect(eintrag!.content).toContain('Wir sind ein Lokalmedium.')
    expect(eintrag!.content).toContain('Mehr Reichweite in der Region.')
    expect(eintrag!.content).toContain('Keine Werbung für Tabak.')
    const posSelbstbeschrieb = eintrag!.content.indexOf('Wir sind ein Lokalmedium.')
    const posFokus = eintrag!.content.indexOf('Mehr Reichweite in der Region.')
    const posNogos = eintrag!.content.indexOf('Keine Werbung für Tabak.')
    expect(posSelbstbeschrieb).toBeLessThan(posFokus)
    expect(posFokus).toBeLessThan(posNogos)
  })

  it('leere Felder fallen weg, nur die ausgefüllten erscheinen', () => {
    const eintrag = baueFragebogenEintrag({ selbstbeschrieb: 'Nur das hier.', fokus: '', nogos: '   ' }, jetzt)
    expect(eintrag).not.toBeNull()
    expect(eintrag!.content).toContain('Nur das hier.')
    expect(eintrag!.content.trim().split('\n\n')).toHaveLength(1)
  })

  it('alle Felder leer oder nur Leerraum: null', () => {
    expect(baueFragebogenEintrag({ selbstbeschrieb: '', fokus: '   ', nogos: '' }, jetzt)).toBeNull()
  })

  it('Felder werden getrimmt', () => {
    const eintrag = baueFragebogenEintrag({ selbstbeschrieb: '  Getrimmt  ', fokus: '', nogos: '' }, jetzt)
    expect(eintrag!.content).toContain('Getrimmt')
    expect(eintrag!.content).not.toContain('  Getrimmt  ')
  })
})

describe('bestimmeWissensQuelle (Quellen-Kennzeichnung für /api/portal/wissen)', () => {
  it('auto_scraped true → «We.Publish»', () => {
    expect(bestimmeWissensQuelle(true)).toBe('We.Publish')
  })

  it('auto_scraped false → «von euch»', () => {
    expect(bestimmeWissensQuelle(false)).toBe('von euch')
  })
})

describe('gesuchPortalStatus (Portal-Gesuche-Seite, Task 10)', () => {
  const OHNE_PORTAL: GesuchPortalApplication = { status: 'identifiziert', portal: null }

  it('nur angefordert_am gesetzt, status identifiziert: angefordert', () => {
    expect(gesuchPortalStatus({ status: 'identifiziert', portal: { angefordert_am: '2026-07-01T00:00:00Z' } })).toBe(
      'angefordert',
    )
  })

  it('status in_arbeit, sonst nichts gesetzt: in_arbeit', () => {
    expect(
      gesuchPortalStatus({ status: 'in_arbeit', portal: { angefordert_am: '2026-07-01T00:00:00Z' } }),
    ).toBe('in_arbeit')
  })

  it('freigegeben_am gesetzt: bereit, unabhängig vom application-status', () => {
    expect(
      gesuchPortalStatus({
        status: 'identifiziert',
        portal: { angefordert_am: '2026-07-01T00:00:00Z', freigegeben_am: '2026-07-02T00:00:00Z' },
      }),
    ).toBe('bereit')
  })

  it('bereit schlägt in_arbeit: freigegeben_am UND status in_arbeit gesetzt ⇒ bereit', () => {
    expect(
      gesuchPortalStatus({
        status: 'in_arbeit',
        portal: { angefordert_am: '2026-07-01T00:00:00Z', freigegeben_am: '2026-07-02T00:00:00Z' },
      }),
    ).toBe('bereit')
  })

  it('final_am gesetzt: final, auch wenn freigegeben_am ebenfalls gesetzt ist', () => {
    expect(
      gesuchPortalStatus({
        status: 'identifiziert',
        portal: {
          angefordert_am: '2026-07-01T00:00:00Z',
          freigegeben_am: '2026-07-02T00:00:00Z',
          final_am: '2026-07-03T00:00:00Z',
        },
      }),
    ).toBe('final')
  })

  it('abgeschickt_am gesetzt: abgeschickt, schlägt final UND bereit', () => {
    expect(
      gesuchPortalStatus({
        status: 'identifiziert',
        portal: {
          angefordert_am: '2026-07-01T00:00:00Z',
          freigegeben_am: '2026-07-02T00:00:00Z',
          final_am: '2026-07-03T00:00:00Z',
          abgeschickt_am: '2026-07-04T00:00:00Z',
        },
      }),
    ).toBe('abgeschickt')
  })

  it('status eingereicht ohne abgeschickt_am (Edge-Case): abgeschickt', () => {
    expect(gesuchPortalStatus({ status: 'eingereicht', portal: null })).toBe('abgeschickt')
  })

  it('status zugesagt: zusage, auch wenn abgeschickt_am/freigegeben_am gesetzt sind', () => {
    expect(
      gesuchPortalStatus({
        status: 'zugesagt',
        portal: { angefordert_am: '2026-07-01T00:00:00Z', freigegeben_am: '2026-07-02T00:00:00Z', abgeschickt_am: '2026-07-04T00:00:00Z' },
      }),
    ).toBe('zusage')
  })

  it('status abgelehnt: absage, schlägt alles andere', () => {
    expect(
      gesuchPortalStatus({
        status: 'abgelehnt',
        portal: { angefordert_am: '2026-07-01T00:00:00Z', abgeschickt_am: '2026-07-04T00:00:00Z' },
      }),
    ).toBe('absage')
  })

  it('gar nichts gesetzt (defensiver Default): angefordert', () => {
    expect(gesuchPortalStatus(OHNE_PORTAL)).toBe('angefordert')
  })

  it('portal ist undefined statt null: kein Crash, Default angefordert', () => {
    expect(gesuchPortalStatus({ status: 'identifiziert' })).toBe('angefordert')
  })
})

describe('fuegeGesuchVersionHinzu (Versionen-Kippregel, Task 10)', () => {
  function baueVersion(i: number): GesuchVersion {
    return { ts: `2026-01-${String(i).padStart(2, '0')}T00:00:00Z`, von: `person-${i}@example.com` }
  }

  it('leere Liste: neue Version wird angehängt, Länge 1', () => {
    const ergebnis = fuegeGesuchVersionHinzu([], baueVersion(1))
    expect(ergebnis).toEqual([baueVersion(1)])
  })

  it('unter dem Limit: wächst um eins, älteste bleibt erhalten', () => {
    const bisherige = [baueVersion(1), baueVersion(2)]
    const ergebnis = fuegeGesuchVersionHinzu(bisherige, baueVersion(3))
    expect(ergebnis).toEqual([baueVersion(1), baueVersion(2), baueVersion(3)])
  })

  it(`genau am Limit (${GESUCH_VERSIONEN_MAX}): wächst noch auf ${GESUCH_VERSIONEN_MAX + 1}`, () => {
    const bisherige = Array.from({ length: GESUCH_VERSIONEN_MAX - 1 }, (_, i) => baueVersion(i + 1))
    const ergebnis = fuegeGesuchVersionHinzu(bisherige, baueVersion(GESUCH_VERSIONEN_MAX))
    expect(ergebnis).toHaveLength(GESUCH_VERSIONEN_MAX)
  })

  it(`über dem Limit: älteste kippt, Länge bleibt bei ${GESUCH_VERSIONEN_MAX}, neue Version steht am Ende`, () => {
    const bisherige = Array.from({ length: GESUCH_VERSIONEN_MAX }, (_, i) => baueVersion(i + 1))
    const neu = baueVersion(GESUCH_VERSIONEN_MAX + 1)
    const ergebnis = fuegeGesuchVersionHinzu(bisherige, neu)
    expect(ergebnis).toHaveLength(GESUCH_VERSIONEN_MAX)
    expect(ergebnis[0]).toEqual(baueVersion(2)) // die älteste (1) ist gekippt
    expect(ergebnis[ergebnis.length - 1]).toEqual(neu)
  })

  it('respektiert einen expliziten kleineren max-Parameter (für Tests)', () => {
    const bisherige = [baueVersion(1), baueVersion(2)]
    const ergebnis = fuegeGesuchVersionHinzu(bisherige, baueVersion(3), 2)
    expect(ergebnis).toEqual([baueVersion(2), baueVersion(3)])
  })
})

describe('parsePortal (Task 11, Operator-Warteschlange)', () => {
  it('null: leeres Objekt', () => {
    expect(parsePortal(null)).toEqual({})
  })

  it('undefined: leeres Objekt', () => {
    expect(parsePortal(undefined)).toEqual({})
  })

  it('Objekt direkt: unverändert durchgereicht', () => {
    const roh = { angefordert_am: '2026-07-01T00:00:00Z', angefordert_von: 'redaktion@bajour.ch' }
    expect(parsePortal(roh)).toEqual(roh)
  })

  it('gültiger JSON-String: geparst', () => {
    const roh = { freigegeben_am: '2026-07-02T00:00:00Z', freigegeben_von: 'team@wepublish.ch' }
    expect(parsePortal(JSON.stringify(roh))).toEqual(roh)
  })

  it('ungültiger JSON-String: leeres Objekt statt Crash', () => {
    expect(parsePortal('{kaputt')).toEqual({})
  })

  it('Array: leeres Objekt (kein gültiges portal-json)', () => {
    expect(parsePortal(['a', 'b'])).toEqual({})
  })

  it('null-sicherer Zugriff: .angefordert_am ist undefined statt Crash', () => {
    expect(parsePortal(null).angefordert_am).toBeUndefined()
  })

  it('liefert alle bekannten Felder unverändert (Beilagen, Versionen, Beträge)', () => {
    const roh = {
      angefordert_am: '2026-07-01T00:00:00Z',
      angefordert_von: 'redaktion@bajour.ch',
      freigegeben_am: null,
      gesuch_text: 'Sehr geehrte Damen und Herren',
      gesuch_versionen: [{ ts: '2026-07-03T00:00:00Z', von: 'wepublish' }],
      beilagen: [{ fileId: 'abc-123', name: 'jahresrechnung.pdf' }],
      betrag_eingereicht_chf: 20000,
    }
    expect(parsePortal(roh)).toEqual(roh)
  })
})

// ─── Fragebogen bearbeiten (Wunsch 29.07.2026) ────────────────────────────────

describe('parseFragebogenEintrag (Umkehrung von baueFragebogenEintrag)', () => {
  it('liest alle drei Felder aus einem selbst gebauten Eintrag zurück', () => {
    const felder = { selbstbeschrieb: 'Wir sind ein Kulturmagazin.', fokus: 'Mehr Recherche.', nogos: 'Keine Werbung.' }
    const eintrag = baueFragebogenEintrag(felder, new Date('2026-07-29T10:00:00Z'))
    expect(eintrag).not.toBeNull()
    expect(parseFragebogenEintrag(eintrag!.content)).toEqual(felder)
  })

  it('mehrzeilige Antworten bleiben erhalten', () => {
    const felder = { selbstbeschrieb: 'Zeile eins\nZeile zwei', fokus: '', nogos: '' }
    const eintrag = baueFragebogenEintrag(felder, new Date('2026-07-29T10:00:00Z'))
    expect(parseFragebogenEintrag(eintrag!.content).selbstbeschrieb).toBe('Zeile eins\nZeile zwei')
  })

  it('fehlende Abschnitte ergeben leere Felder', () => {
    const eintrag = baueFragebogenEintrag({ selbstbeschrieb: '', fokus: 'Nur Fokus.', nogos: '' }, new Date())
    const felder = parseFragebogenEintrag(eintrag!.content)
    expect(felder).toEqual({ selbstbeschrieb: '', fokus: 'Nur Fokus.', nogos: '' })
  })

  it('leerer, null- oder unbekannter Inhalt ergibt leere Felder statt Fehler', () => {
    const leer = { selbstbeschrieb: '', fokus: '', nogos: '' }
    expect(parseFragebogenEintrag('')).toEqual(leer)
    expect(parseFragebogenEintrag(null)).toEqual(leer)
    expect(parseFragebogenEintrag(undefined)).toEqual(leer)
    expect(parseFragebogenEintrag('Irgendwas von Hand\nohne Abschnittstitel')).toEqual(leer)
  })

  it('verkraftet CRLF-Zeilenenden (von Hand in Directus bearbeitet)', () => {
    const inhalt = 'Selbstbeschrieb\r\nEin Text.\r\n\r\nNo-Gos\r\nKeine Werbung.'
    expect(parseFragebogenEintrag(inhalt)).toEqual({ selbstbeschrieb: 'Ein Text.', fokus: '', nogos: 'Keine Werbung.' })
  })
})

describe('istFragebogenEintrag', () => {
  it('erkennt den Fragebogen am Titel-Präfix', () => {
    expect(istFragebogenEintrag({ title: 'Fragebogen 2026-07-29' })).toBe(true)
    expect(istFragebogenEintrag({ title: 'Förderhistorie: Volkart Stiftung' })).toBe(false)
    expect(istFragebogenEintrag({ title: null })).toBe(false)
  })
})

// ─── Anzeige-Schritte (Befund beim Durchklicken 29.07.2026) ───────────────────

describe('baueAnzeigeSchritte', () => {
  function stationen(teil: Partial<Record<string, 'offen' | 'aktiv' | 'erledigt'>>) {
    return (['logo', 'unterlagen', 'dna', 'freischaltung', 'treffer', 'gesuche'] as const).map((key) => ({
      key,
      status: teil[key] ?? 'offen',
    }))
  }

  it('fasst die sechs Stationen auf vier Schritte zusammen — dieselbe Zählung wie die Reiter', () => {
    const schritte = baueAnzeigeSchritte(stationen({ logo: 'aktiv' }))
    expect(schritte.map((s) => `${s.nummer}. ${s.label}`)).toEqual([
      '1. Unterlagen',
      '2. DNA',
      '3. Treffer',
      '4. Gesuche',
    ])
  })

  it('Schritt 1 ist erst erledigt, wenn Logo UND Unterlagen erledigt sind', () => {
    const nurLogo = baueAnzeigeSchritte(stationen({ logo: 'erledigt', unterlagen: 'aktiv' }))
    expect(nurLogo[0].status).toBe('aktiv')

    const beides = baueAnzeigeSchritte(stationen({ logo: 'erledigt', unterlagen: 'erledigt', dna: 'aktiv' }))
    expect(beides[0].status).toBe('erledigt')
    expect(beides[1].status).toBe('aktiv')
  })

  it('das fehlende Logo lässt Schritt 1 aktiv, nicht erledigt', () => {
    const schritte = baueAnzeigeSchritte(stationen({ logo: 'aktiv' }))
    expect(schritte[0].status).toBe('aktiv')
  })

  it('die Freischaltung erscheint als Teil von Schritt 3 (Treffer)', () => {
    const wartet = baueAnzeigeSchritte(
      stationen({ logo: 'erledigt', unterlagen: 'erledigt', dna: 'erledigt', freischaltung: 'aktiv' }),
    )
    expect(wartet[1].status).toBe('erledigt')
    expect(wartet[2].status).toBe('aktiv')

    const frei = baueAnzeigeSchritte(
      stationen({ logo: 'erledigt', unterlagen: 'erledigt', dna: 'erledigt', freischaltung: 'erledigt', treffer: 'aktiv' }),
    )
    expect(frei[2].status).toBe('aktiv')
  })

  it('Gesuche erledigt, sobald ein Gesuch über das Portal läuft', () => {
    const schritte = baueAnzeigeSchritte(
      stationen({
        logo: 'erledigt', unterlagen: 'erledigt', dna: 'erledigt',
        freischaltung: 'erledigt', treffer: 'aktiv', gesuche: 'erledigt',
      }),
    )
    expect(schritte[3].status).toBe('erledigt')
  })

  it('höchstens ein Schritt ist gleichzeitig aktiv', () => {
    const faelle = [
      stationen({ logo: 'aktiv' }),
      stationen({ logo: 'erledigt', unterlagen: 'aktiv' }),
      stationen({ logo: 'erledigt', unterlagen: 'erledigt', dna: 'aktiv' }),
      stationen({ logo: 'erledigt', unterlagen: 'erledigt', dna: 'erledigt', freischaltung: 'aktiv' }),
      stationen({ logo: 'erledigt', unterlagen: 'erledigt', dna: 'erledigt', freischaltung: 'erledigt', treffer: 'aktiv' }),
    ]
    for (const fall of faelle) {
      expect(baueAnzeigeSchritte(fall).filter((s) => s.status === 'aktiv')).toHaveLength(1)
    }
  })
})
