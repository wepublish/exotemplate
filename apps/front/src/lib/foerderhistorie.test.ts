import {
  FOERDERHISTORIE_TYPEN,
  parseFoerderhistorieEingabe,
  istAusschluss,
  bauAusschlussSet,
  bauHistorieLabels,
  bauKnowledgeEintrag,
  formatBetragChf,
  foerderhistorieTypLabel,
  type FoerderhistorieZeile,
} from './foerderhistorie'

const JETZT = 2026

function zeile(teil: Partial<FoerderhistorieZeile>): FoerderhistorieZeile {
  return {
    id: 1,
    stiftungId: '11991',
    stiftungName: 'Media Forward Fund',
    typ: 'erhalten',
    jahr: null,
    betrag: null,
    zweck: null,
    ausgeschlossen: false,
    ausschlussGrund: null,
    ...teil,
  }
}

// ─── FOERDERHISTORIE_TYPEN ────────────────────────────────────────────────────

describe('FOERDERHISTORIE_TYPEN', () => {
  it('enthält genau die drei Typen', () => {
    expect(FOERDERHISTORIE_TYPEN.map((t) => t.key)).toEqual(['erhalten', 'abgelehnt', 'ausgeschlossen'])
  })

  it('foerderhistorieTypLabel fällt auf den Roh-Typ zurück', () => {
    expect(foerderhistorieTypLabel('erhalten')).toBe('Förderung erhalten')
    expect(foerderhistorieTypLabel('unbekannt')).toBe('unbekannt')
  })
})

// ─── parseFoerderhistorieEingabe ──────────────────────────────────────────────

describe('parseFoerderhistorieEingabe', () => {
  it('akzeptiert eine vollständige erhalten-Eingabe', () => {
    const r = parseFoerderhistorieEingabe(
      {
        typ: 'erhalten',
        stiftung_id: 11991,
        stiftung_name: '  Media Forward Fund ',
        jahr: 2023,
        betrag: 20000,
        zweck: 'Recherchefonds',
      },
      JETZT,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.eingabe).toEqual({
      typ: 'erhalten',
      stiftungId: 11991,
      stiftungName: 'Media Forward Fund',
      jahr: 2023,
      betrag: 20000,
      zweck: 'Recherchefonds',
      ausgeschlossen: false,
      ausschlussGrund: null,
    })
  })

  it('weist unbekannten typ ab', () => {
    const r = parseFoerderhistorieEingabe({ typ: 'gewonnen', stiftung_name: 'X Y' }, JETZT)
    expect(r.ok).toBe(false)
  })

  it('verlangt stiftung_name mit mindestens 2 Zeichen', () => {
    expect(parseFoerderhistorieEingabe({ typ: 'erhalten', stiftung_name: ' ' }, JETZT).ok).toBe(false)
    expect(parseFoerderhistorieEingabe({ typ: 'erhalten', stiftung_name: 'A' }, JETZT).ok).toBe(false)
    expect(parseFoerderhistorieEingabe({ typ: 'erhalten' }, JETZT).ok).toBe(false)
  })

  it('weist Jahre ausserhalb des Fensters ab, erlaubt jetztJahr+1', () => {
    expect(parseFoerderhistorieEingabe({ typ: 'erhalten', stiftung_name: 'XY', jahr: 1899 }, JETZT).ok).toBe(false)
    expect(parseFoerderhistorieEingabe({ typ: 'erhalten', stiftung_name: 'XY', jahr: 2028 }, JETZT).ok).toBe(false)
    expect(parseFoerderhistorieEingabe({ typ: 'erhalten', stiftung_name: 'XY', jahr: 2027 }, JETZT).ok).toBe(true)
  })

  it('weist negativen oder absurden Betrag ab', () => {
    expect(parseFoerderhistorieEingabe({ typ: 'erhalten', stiftung_name: 'XY', betrag: -5 }, JETZT).ok).toBe(false)
    expect(parseFoerderhistorieEingabe({ typ: 'erhalten', stiftung_name: 'XY', betrag: 200_000_000 }, JETZT).ok).toBe(false)
  })

  it('nimmt Jahr und Betrag auch als String (Formularfelder)', () => {
    const r = parseFoerderhistorieEingabe(
      { typ: 'erhalten', stiftung_name: 'XY', jahr: '2022', betrag: '15000' },
      JETZT,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.eingabe.jahr).toBe(2022)
    expect(r.eingabe.betrag).toBe(15000)
  })

  it('typ ausgeschlossen erzwingt das Flag und leert Förder-Felder', () => {
    const r = parseFoerderhistorieEingabe(
      {
        typ: 'ausgeschlossen',
        stiftung_name: 'Stiftung Greulich',
        jahr: 2020,
        betrag: 9999,
        zweck: 'egal',
        ausschluss_grund: 'Befangenheit im Stiftungsrat',
      },
      JETZT,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.eingabe.ausgeschlossen).toBe(true)
    expect(r.eingabe.jahr).toBeNull()
    expect(r.eingabe.betrag).toBeNull()
    expect(r.eingabe.zweck).toBeNull()
    expect(r.eingabe.ausschlussGrund).toBe('Befangenheit im Stiftungsrat')
  })

  it('erhalten mit Ausschluss-Häkchen behält Grund, abgelehnt trägt keinen Betrag', () => {
    const r = parseFoerderhistorieEingabe(
      {
        typ: 'abgelehnt',
        stiftung_name: 'XY',
        jahr: 2024,
        betrag: 5000,
        ausgeschlossen: true,
        ausschluss_grund: 'fördert nur einmalig',
      },
      JETZT,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.eingabe.betrag).toBeNull()
    expect(r.eingabe.ausgeschlossen).toBe(true)
    expect(r.eingabe.ausschlussGrund).toBe('fördert nur einmalig')
  })

  it('ohne Ausschluss-Häkchen wird ausschluss_grund verworfen', () => {
    const r = parseFoerderhistorieEingabe(
      { typ: 'erhalten', stiftung_name: 'XY', ausschluss_grund: 'sollte verschwinden' },
      JETZT,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.eingabe.ausschlussGrund).toBeNull()
  })
})

// ─── istAusschluss / bauAusschlussSet ─────────────────────────────────────────

describe('bauAusschlussSet', () => {
  it('nimmt typ ausgeschlossen und das Flag, ignoriert Zeilen ohne stiftungId', () => {
    const zeilen = [
      zeile({ id: 1, stiftungId: '100', typ: 'ausgeschlossen', ausgeschlossen: true }),
      zeile({ id: 2, stiftungId: '200', typ: 'erhalten', ausgeschlossen: true }),
      zeile({ id: 3, stiftungId: '300', typ: 'erhalten', ausgeschlossen: false }),
      zeile({ id: 4, stiftungId: null, typ: 'ausgeschlossen', ausgeschlossen: true }),
    ]
    expect(bauAusschlussSet(zeilen)).toEqual(new Set(['100', '200']))
    expect(istAusschluss(zeilen[2])).toBe(false)
  })
})

// ─── bauHistorieLabels ────────────────────────────────────────────────────────

describe('bauHistorieLabels', () => {
  it('baut Label mit Jahr und Betrag (de-CH-Format)', () => {
    const labels = bauHistorieLabels([zeile({ jahr: 2023, betrag: 20000 })])
    expect(labels.get('11991')).toBe(`Frühere Förderung 2023 · ${formatBetragChf(20000)}`)
    expect(formatBetragChf(20000)).toMatch(/^CHF 20.000$/)
  })

  it('erhalten gewinnt vor abgelehnt, jüngstes Jahr gewinnt', () => {
    const labels = bauHistorieLabels([
      zeile({ id: 1, typ: 'abgelehnt', jahr: 2025 }),
      zeile({ id: 2, typ: 'erhalten', jahr: 2019 }),
      zeile({ id: 3, typ: 'erhalten', jahr: 2022 }),
    ])
    expect(labels.get('11991')).toBe('Frühere Förderung 2022')
  })

  it('abgelehnt ohne Jahr bekommt das neutrale Label, reine Ausschlüsse keines', () => {
    const labels = bauHistorieLabels([
      zeile({ id: 1, stiftungId: '7', typ: 'abgelehnt', jahr: null }),
      zeile({ id: 2, stiftungId: '8', typ: 'ausgeschlossen', ausgeschlossen: true }),
    ])
    expect(labels.get('7')).toBe('Gesuch früher abgelehnt')
    expect(labels.has('8')).toBe(false)
  })
})

// ─── bauKnowledgeEintrag ──────────────────────────────────────────────────────

describe('bauKnowledgeEintrag', () => {
  it('baut Titel und Inhalt für erhalten', () => {
    const r = parseFoerderhistorieEingabe(
      { typ: 'erhalten', stiftung_name: 'Volkart Stiftung', jahr: 2024, betrag: 30000, zweck: 'Klimarecherche' },
      JETZT,
    )
    if (!r.ok) throw new Error('Eingabe unerwartet ungültig')
    const k = bauKnowledgeEintrag(r.eingabe)
    expect(k?.title).toBe('Förderhistorie: Volkart Stiftung 2024')
    expect(k?.content).toContain('Ergebnis: Förderung erhalten.')
    expect(k?.content).toContain('Jahr: 2024.')
    expect(k?.content).toContain('Zweck: Klimarecherche.')
  })

  it('nennt den Ausschluss samt Grund im Inhalt', () => {
    const r = parseFoerderhistorieEingabe(
      { typ: 'abgelehnt', stiftung_name: 'XY', ausgeschlossen: true, ausschluss_grund: 'fördert nur Startphasen' },
      JETZT,
    )
    if (!r.ok) throw new Error('Eingabe unerwartet ungültig')
    const k = bauKnowledgeEintrag(r.eingabe)
    expect(k?.content).toContain('Ergebnis: Gesuch abgelehnt.')
    expect(k?.content).toContain('nicht mehr in Frage (fördert nur Startphasen).')
  })

  it('liefert null für reine Ausschlüsse', () => {
    const r = parseFoerderhistorieEingabe({ typ: 'ausgeschlossen', stiftung_name: 'XY' }, JETZT)
    if (!r.ok) throw new Error('Eingabe unerwartet ungültig')
    expect(bauKnowledgeEintrag(r.eingabe)).toBeNull()
  })
})
