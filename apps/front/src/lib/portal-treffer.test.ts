/**
 * Tests für portal-treffer.ts: reine Kuratierungslogik der Portal-Treffer-Seite
 * (uebereinstimmungsLabel, humanisiereTag, extrahiereUeberschneidungsTags,
 * kuratiereTreffer). Kein IO, kein Mock nötig.
 */
import {
  uebereinstimmungsLabel,
  humanisiereTag,
  extrahiereUeberschneidungsTags,
  kuratiereTreffer,
  type PortalTrefferMatch,
  type PortalTrefferStiftung,
  type PortalTrefferApplication,
} from './portal-treffer'

describe('uebereinstimmungsLabel', () => {
  it.each([
    [100, 'sehr hoch'],
    [70, 'sehr hoch'],
    [69, 'hoch'],
    [45, 'hoch'],
    [44, 'gut'],
    [0, 'gut'],
  ])('Score %d ergibt Label %s', (score, erwartet) => {
    expect(uebereinstimmungsLabel(score)).toBe(erwartet)
  })
})

describe('humanisiereTag', () => {
  it('einfacher Slug: erster Buchstabe gross, Unterstriche raus', () => {
    expect(humanisiereTag('lokaljournalismus')).toBe('Lokaljournalismus')
  })

  it('geo_-Slug bekommt das Präfix «Region»', () => {
    expect(humanisiereTag('geo_basel')).toBe('Region Basel')
  })

  it('mehrteiliger Slug: Unterstriche werden zu Leerzeichen, nur der erste Buchstabe gross', () => {
    expect(humanisiereTag('marginalisierte_stimmen')).toBe('Marginalisierte stimmen')
  })

  it('mehrteiliger geo_-Slug: Präfix «Region» plus vollständig humanisierter Rest', () => {
    expect(humanisiereTag('geo_schweiz_weit')).toBe('Region Schweiz weit')
  })

  it('leerer String ergibt leeren String, kein Crash', () => {
    expect(humanisiereTag('')).toBe('')
  })
})

describe('extrahiereUeberschneidungsTags', () => {
  it('extrahiert die tag-Namen aus score_breakdown.matched, absteigend nach gewicht*gewicht_stiftung', () => {
    const breakdown = {
      matched: [
        { tag: 'kultur_kunst', gewicht: 2, gewicht_stiftung: 2 }, // Produkt 4
        { tag: 'lokaljournalismus', gewicht: 3, gewicht_stiftung: 3 }, // Produkt 9
        { tag: 'medienvielfalt', gewicht: 1, gewicht_stiftung: 3 }, // Produkt 3
      ],
    }
    expect(extrahiereUeberschneidungsTags(breakdown)).toEqual(['lokaljournalismus', 'kultur_kunst', 'medienvielfalt'])
  })

  it('boolean_fallback-Einträge ohne gewicht_stiftung: kein Crash, Produkt gilt als 0', () => {
    const breakdown = { matched: [{ tag: 'a', gewicht: 3 }, { tag: 'b', gewicht: 2, gewicht_stiftung: 1 }] }
    expect(extrahiereUeberschneidungsTags(breakdown)).toEqual(['b', 'a'])
  })

  it('kein matched-Array im Objekt: leeres Ergebnis', () => {
    expect(extrahiereUeberschneidungsTags({})).toEqual([])
  })

  it('null/undefined: leeres Ergebnis, kein Crash', () => {
    expect(extrahiereUeberschneidungsTags(null)).toEqual([])
    expect(extrahiereUeberschneidungsTags(undefined)).toEqual([])
  })

  it('Einträge ohne tag-Feld werden ausgelassen', () => {
    expect(extrahiereUeberschneidungsTags({ matched: [{ gewicht: 3 }] })).toEqual([])
  })
})

describe('kuratiereTreffer', () => {
  const stiftungen: PortalTrefferStiftung[] = [
    { id: '1', name: 'Stiftung A', sitz: 'Zürich', website: 'https://a.example' },
    { id: '2', name: 'Stiftung B', sitz: null, website: null },
    { id: '3', name: 'Stiftung C', sitz: 'Basel', website: 'https://c.example' },
  ]

  function match(overrides: Partial<PortalTrefferMatch> & { stiftungId: string }): PortalTrefferMatch {
    return { score: 50, begruendung: 'Begründungstext.', topTags: [], ...overrides }
  }

  it('sortiert nach Score absteigend und begrenzt auf das übergebene limit', () => {
    const matches = [match({ stiftungId: '1', score: 40 }), match({ stiftungId: '2', score: 90 }), match({ stiftungId: '3', score: 60 })]
    const ergebnis = kuratiereTreffer(matches, stiftungen, [], 2)
    expect(ergebnis.map((t) => t.stiftungId)).toEqual(['2', '3'])
  })

  it('Default-Limit ist 20, wenn kein limit übergeben wird', () => {
    const vieleStiftungen: PortalTrefferStiftung[] = Array.from({ length: 25 }, (_, i) => ({
      id: String(i + 1),
      name: `Stiftung ${i + 1}`,
      sitz: null,
      website: null,
    }))
    const vieleMatches: PortalTrefferMatch[] = vieleStiftungen.map((s, i) => match({ stiftungId: s.id, score: 100 - i }))
    const ergebnis = kuratiereTreffer(vieleMatches, vieleStiftungen, [])
    expect(ergebnis).toHaveLength(20)
    expect(ergebnis[0].stiftungId).toBe('1')
  })

  it('ausgeblendet-Applications fallen komplett raus und geben ihren Platz im Limit-Fenster frei', () => {
    const matches = [match({ stiftungId: '1', score: 90 }), match({ stiftungId: '2', score: 80 }), match({ stiftungId: '3', score: 10 })]
    const applications: PortalTrefferApplication[] = [{ stiftungId: '1', status: 'ausgeblendet' }]
    const ergebnis = kuratiereTreffer(matches, stiftungen, applications, 2)
    expect(ergebnis.map((t) => t.stiftungId)).toEqual(['2', '3'])
    expect(ergebnis.some((t) => t.status === 'nicht_relevant')).toBe(false)
  })

  it('mehrere match_results-Zeilen für dieselbe Stiftung (z.B. nach DNA-Neumessung des Mediums): nur die stärkste wird gezeigt, kein Duplikat', () => {
    const matches = [match({ stiftungId: '1', score: 87 }), match({ stiftungId: '1', score: 89 }), match({ stiftungId: '2', score: 50 })]
    const ergebnis = kuratiereTreffer(matches, stiftungen, [])
    const treffer1 = ergebnis.filter((t) => t.stiftungId === '1')
    expect(treffer1).toHaveLength(1)
    expect(treffer1[0].label).toBe(uebereinstimmungsLabel(89))
  })

  it('Match ohne zugehörige Stiftung wird ausgelassen (kein Crash, kein Platzhalter-Name)', () => {
    const ergebnis = kuratiereTreffer([match({ stiftungId: '999', score: 90 })], stiftungen, [])
    expect(ergebnis).toEqual([])
  })

  it('sitz/website werden 1:1 aus der Stiftung übernommen (auch null)', () => {
    const [t] = kuratiereTreffer([match({ stiftungId: '2', score: 90 })], stiftungen, [])
    expect(t.sitz).toBeNull()
    expect(t.website).toBeNull()
  })

  it('themen: nur die ersten 5 topTags, humanisiert', () => {
    const m = match({ stiftungId: '1', score: 90, topTags: ['lokaljournalismus', 'geo_basel', 'a_b', 'c_d', 'e_f', 'g_h'] })
    const [t] = kuratiereTreffer([m], stiftungen, [])
    expect(t.themen).toEqual(['Lokaljournalismus', 'Region Basel', 'A b', 'C d', 'E f'])
  })

  it('fehlende begruendung wird zu leerem String, nicht null/undefined', () => {
    const [t] = kuratiereTreffer([match({ stiftungId: '1', score: 90, begruendung: null })], stiftungen, [])
    expect(t.begruendung).toBe('')
  })

  it('das Ergebnis-Objekt hat exakt die PortalTreffer-Felder, kein score-/breakdown-Feld', () => {
    const [t] = kuratiereTreffer([match({ stiftungId: '1', score: 90 })], stiftungen, [])
    expect(Object.keys(t).sort()).toEqual(
      ['begruendung', 'fruehereFoerderung', 'label', 'name', 'sitz', 'status', 'stiftungId', 'themen', 'website'].sort(),
    )
    expect(t).not.toHaveProperty('score')
    expect(t).not.toHaveProperty('score_breakdown')
  })

  describe('Förderhistorie (Ausschluss-Set + Badge-Labels)', () => {
    it('ausgeschlossene Stiftungen fallen raus und geben ihren Platz im Limit-Fenster frei', () => {
      const matches = [match({ stiftungId: '1', score: 90 }), match({ stiftungId: '2', score: 80 }), match({ stiftungId: '3', score: 10 })]
      const ergebnis = kuratiereTreffer(matches, stiftungen, [], 2, new Set(['1']))
      expect(ergebnis.map((t) => t.stiftungId)).toEqual(['2', '3'])
    })

    it('Historie-Label landet als fruehereFoerderung am Treffer, sonst null', () => {
      const labels = new Map([['1', 'Frühere Förderung 2023 · CHF 20’000']])
      const ergebnis = kuratiereTreffer(
        [match({ stiftungId: '1', score: 90 }), match({ stiftungId: '2', score: 80 })],
        stiftungen,
        [],
        20,
        undefined,
        labels,
      )
      expect(ergebnis[0].fruehereFoerderung).toBe('Frühere Förderung 2023 · CHF 20’000')
      expect(ergebnis[1].fruehereFoerderung).toBeNull()
    })

    it('ohne die optionalen Parameter verhält sich alles wie bisher', () => {
      const [t] = kuratiereTreffer([match({ stiftungId: '1', score: 90 })], stiftungen, [])
      expect(t.fruehereFoerderung).toBeNull()
    })
  })

  describe('Status-Ableitung', () => {
    const einMatch = [match({ stiftungId: '1', score: 90 })]
    const einStiftung = [stiftungen[0]]

    it('ohne Application: offen', () => {
      const [t] = kuratiereTreffer(einMatch, einStiftung, [])
      expect(t.status).toBe('offen')
    })

    it('portal.angefordert_am gesetzt: angefordert', () => {
      const apps: PortalTrefferApplication[] = [
        { stiftungId: '1', status: 'identifiziert', portal: { angefordert_am: '2026-07-01T00:00:00Z' } },
      ]
      const [t] = kuratiereTreffer(einMatch, einStiftung, apps)
      expect(t.status).toBe('angefordert')
    })

    it('application.status=in_arbeit ohne freigegeben_am: in_arbeit', () => {
      const apps: PortalTrefferApplication[] = [
        { stiftungId: '1', status: 'in_arbeit', portal: { angefordert_am: '2026-07-01T00:00:00Z' } },
      ]
      const [t] = kuratiereTreffer(einMatch, einStiftung, apps)
      expect(t.status).toBe('in_arbeit')
    })

    it('portal.freigegeben_am gesetzt: bereit, auch wenn application.status noch in_arbeit ist', () => {
      const apps: PortalTrefferApplication[] = [
        { stiftungId: '1', status: 'in_arbeit', portal: { freigegeben_am: '2026-07-02T00:00:00Z' } },
      ]
      const [t] = kuratiereTreffer(einMatch, einStiftung, apps)
      expect(t.status).toBe('bereit')
    })

    it('portal.abgeschickt_am gesetzt: abgeschickt, hat Vorrang vor freigegeben_am', () => {
      const apps: PortalTrefferApplication[] = [
        {
          stiftungId: '1',
          status: 'in_arbeit',
          portal: { freigegeben_am: '2026-07-02T00:00:00Z', abgeschickt_am: '2026-07-05T00:00:00Z' },
        },
      ]
      const [t] = kuratiereTreffer(einMatch, einStiftung, apps)
      expect(t.status).toBe('abgeschickt')
    })
  })
})
