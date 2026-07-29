/**
 * Tests für die reinen Teile von dna-pipeline.ts: DNA-Rückmeldungen
 * (Titel-Präfix-Vertrag mit /api/portal/dna-erzeugen, Prompt-Abschnitt).
 * Die IO-lastige Verdichtung selbst bleibt untestbar ohne LLM — die
 * Trennung Rückmeldung/Korpus und der Abschnittsbau sind hier abgedeckt.
 */
import {
  DNA_RUECKMELDUNG_TITEL_PREFIX,
  istDnaRueckmeldung,
  baueRueckmeldungsAbschnitt,
} from './dna-pipeline'

describe('istDnaRueckmeldung', () => {
  it('erkennt Einträge am Titel-Präfix', () => {
    expect(istDnaRueckmeldung({ title: `${DNA_RUECKMELDUNG_TITEL_PREFIX} (2026-07-29)` })).toBe(true)
    expect(istDnaRueckmeldung({ title: 'Rückmeldung zur DNA' })).toBe(true)
  })

  it('normale Wissens-Einträge sind keine Rückmeldung', () => {
    expect(istDnaRueckmeldung({ title: 'Fragebogen 2026-07-28' })).toBe(false)
    expect(istDnaRueckmeldung({ title: 'Förderhistorie: Volkart Stiftung 2024' })).toBe(false)
    expect(istDnaRueckmeldung({ title: '' })).toBe(false)
  })
})

describe('baueRueckmeldungsAbschnitt', () => {
  it('leere Eingabe ergibt leeren String (kein Prompt-Abschnitt)', () => {
    expect(baueRueckmeldungsAbschnitt([])).toBe('')
    expect(baueRueckmeldungsAbschnitt([{ content: '   ' }, { content: null }])).toBe('')
  })

  it('baut den Abschnitt mit einem Punkt pro Rückmeldung', () => {
    const abschnitt = baueRueckmeldungsAbschnitt([
      { content: 'Zu breit, bitte mehr Fokus auf Lokaljournalismus.' },
      { content: 'Klima fehlt komplett.' },
    ])
    expect(abschnitt).toContain('RÜCKMELDUNGEN DES MEDIUMS')
    expect(abschnitt).toContain('- Zu breit, bitte mehr Fokus auf Lokaljournalismus.')
    expect(abschnitt).toContain('- Klima fehlt komplett.')
  })

  it('höchstens drei Rückmeldungen (neueste zuerst, wie KNOWLEDGE_QUERY sortiert)', () => {
    const abschnitt = baueRueckmeldungsAbschnitt([
      { content: 'eins' },
      { content: 'zwei' },
      { content: 'drei' },
      { content: 'vier' },
    ])
    expect(abschnitt).toContain('- eins')
    expect(abschnitt).toContain('- drei')
    expect(abschnitt).not.toContain('- vier')
  })

  it('kappt überlange Rückmeldungen auf die Zeichen-Grenze', () => {
    const abschnitt = baueRueckmeldungsAbschnitt([{ content: 'x'.repeat(5000) }])
    expect(abschnitt.length).toBeLessThan(2200)
  })
})
