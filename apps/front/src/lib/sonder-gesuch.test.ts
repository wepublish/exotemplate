import {
  istSonderZiel,
  sonderRef,
  mapSonderItem,
  ergaenzePraxis,
  SONDER_FELDER,
  SONDER_ZIELE,
} from './sonder-gesuch'

describe('sonder-gesuch', () => {
  test('istSonderZiel akzeptiert nur die vier Collections', () => {
    expect(istSonderZiel('kirchen')).toBe(true)
    expect(istSonderZiel('foerderer')).toBe(true)
    expect(istSonderZiel('lotteriefonds')).toBe(true)
    expect(istSonderZiel('sponsoren')).toBe(true)
    expect(istSonderZiel('stiftungen')).toBe(false)
    expect(istSonderZiel('')).toBe(false)
    expect(istSonderZiel(null)).toBe(false)
  })

  test('sonderRef baut den Referenz-Schlüssel', () => {
    expect(sonderRef('kirchen', 1)).toBe('kirchen:1')
    expect(sonderRef('foerderer', '23')).toBe('foerderer:23')
  })

  test('SONDER_FELDER deckt alle Ziele und liest bemerkungen NIE (vertraulich)', () => {
    for (const ziel of SONDER_ZIELE) {
      expect(SONDER_FELDER[ziel].length).toBeGreaterThan(0)
      expect(SONDER_FELDER[ziel]).not.toContain('bemerkungen')
    }
  })

  test('ergaenzePraxis hängt fehlende Angaben an, dedupliziert vorhandene', () => {
    expect(
      ergaenzePraxis('Einreichung via https://x.ch/form', [
        ['Gesuchseinreichung', 'https://x.ch/form'],
        ['Eingabefrist', '31.3.'],
      ]),
    ).toBe('Einreichung via https://x.ch/form\nEingabefrist: 31.3.')
    expect(ergaenzePraxis(null, [['Webseite', 'https://y.ch']])).toBe('Webseite: https://y.ch')
    expect(ergaenzePraxis(null, [['Webseite', null]])).toBeNull()
  })

  test('mapSonderItem: kirchen mit Förderpraxis-Objekt und Formular-URL', () => {
    const d = mapSonderItem('kirchen', {
      name: 'Erprobungsfonds',
      organisationsform: 'Kirche',
      keywords_ausrichtung: 'Bern-Jura-Solothurn',
      form_gesuche: 'https://www.kircheinbewegung.ch/beitragsgesuch/',
      webseite: 'https://www.kircheinbewegung.ch/beitragsgesuch/',
      eingabefrist: null,
      sound_feeling: 'Mutiger Förderpool.',
      foerderpraxis: { geo_scope: ['Bern'], einreichmodalitaet: 'Online-Formular' },
    })
    expect(d.stiftungName).toBe('Erprobungsfonds')
    expect(d.stiftungZweck).toBe('Kirche — Bern-Jura-Solothurn')
    expect(d.stiftungSound).toBe('Mutiger Förderpool.')
    // Förderpraxis-JSON als Text + ergänzte Formular-URL (Webseite ist identisch → einmal)
    expect(d.stiftungFoerderpraxis).toContain('einreichmodalitaet')
    expect(d.stiftungFoerderpraxis).toContain('Gesuchseinreichung: https://www.kircheinbewegung.ch/beitragsgesuch/')
    expect((d.stiftungFoerderpraxis!.match(/kircheinbewegung/g) ?? []).length).toBeLessThanOrEqual(2)
  })

  test('mapSonderItem: lotteriefonds nutzt stiftungsname/kanton/foerderbedingungen', () => {
    const d = mapSonderItem('lotteriefonds', {
      stiftungsname: 'Swisslos-Fonds Kanton Bern',
      kanton: 'Bern',
      foerderbedingungen: 'Gemeinnützige Projekte im Kanton.',
      medientrigger: 'Lokaljournalismus',
      url_eingabeformular: 'https://be.ch/form',
      sound_feeling: null,
      foerderpraxis: null,
    })
    expect(d.stiftungName).toBe('Swisslos-Fonds Kanton Bern')
    expect(d.stiftungSitz).toBe('Bern')
    expect(d.stiftungLand).toBe('CH')
    expect(d.stiftungZweck).toContain('Gemeinnützige Projekte')
    expect(d.stiftungZweck).toContain('Medien-Bezug: Lokaljournalismus')
    expect(d.stiftungFoerderpraxis).toBe('Eingabeformular: https://be.ch/form')
  })

  test('mapSonderItem: sponsoren nutzt firmenname und B2B-Felder', () => {
    const d = mapSonderItem('sponsoren', {
      firmenname: 'Beispiel AG',
      fokus_medium: 'Lokalmedien',
      sponsoring_paket: 'Logo + Newsletter',
      b2b_argumente: 'Reichweite in Basel',
      sound_feeling: 'Pragmatisch.',
      foerderpraxis: null,
    })
    expect(d.stiftungName).toBe('Beispiel AG')
    expect(d.stiftungZweck).toContain('Fokus: Lokalmedien')
    expect(d.stiftungZweck).toContain('Sponsoring-Paket: Logo + Newsletter')
    expect(d.stiftungZweck).toContain('B2B-Argumente: Reichweite in Basel')
  })

  test('mapSonderItem: fehlende Felder fallen sauber auf null', () => {
    const d = mapSonderItem('foerderer', { name: 'X' })
    expect(d.stiftungName).toBe('X')
    expect(d.stiftungZweck).toBeNull()
    expect(d.stiftungSound).toBeNull()
    expect(d.stiftungFoerderpraxis).toBeNull()
  })
})
