/**
 * Tests für portal-dna.ts: reine Ableitungslogik der Portal-DNA-Seite
 * (baueDnaAnsicht, bauePdfDaten, stufeAusPhase). Kein IO, kein Mock nötig.
 */
import { baueDnaAnsicht, bauePdfDaten, stufeAusPhase, type PortalAktiveDnaRoh } from './portal-dna'
import type { DnaProfil } from './generate-dna-jobs'

const ROH: PortalAktiveDnaRoh = {
  id: 42,
  version: 3,
  soundFeeling: 'Bajour ist unabhängiger Lokaljournalismus für Basel.',
  tags: [
    { tag_slug: 'geo_basel', gewicht: 3, begruendung: 'Basler Lokaljournalismus im Zentrum jeder Ausgabe.' },
    { tag_slug: 'gesellschaft_demokratie_bekaempfung_fake_news', gewicht: 2, begruendung: 'Regelmässige Faktenchecks.' },
  ],
  schaerfe: 74,
  aktivSeit: '2026-07-01T08:00:00.000Z',
  hatteCrawl: true,
}

describe('baueDnaAnsicht', () => {
  it('mappt auf die schlanke {soundFeeling,tags,schaerfe,aktivSeit}-Form mit echten Tag-Labels', () => {
    const ansicht = baueDnaAnsicht(ROH)
    expect(ansicht).toEqual({
      soundFeeling: ROH.soundFeeling,
      tags: [
        { slug: 'geo_basel', label: 'Basel' },
        { slug: 'gesellschaft_demokratie_bekaempfung_fake_news', label: 'Bekaempfung fake news' },
      ],
      schaerfe: 74,
      aktivSeit: '2026-07-01T08:00:00.000Z',
    })
  })

  it('leere Tag-Liste ergibt leeres tags-Array, kein Crash', () => {
    const ansicht = baueDnaAnsicht({ ...ROH, tags: [] })
    expect(ansicht.tags).toEqual([])
  })
})

describe('bauePdfDaten', () => {
  const PROFIL: DnaProfil = {
    dna_summary: 'Bajour berichtet unabhängig aus Basel.',
    core_themes: ['Lokaljournalismus'],
    editorial_stance: ['Konstruktiv'],
    societal_impact: ['Stärkt die lokale Öffentlichkeit'],
    target_groups: ['Baslerinnen und Basler'],
    geographic_focus: 'Basel',
    funding_keywords: ['Lokaljournalismus', 'Medienvielfalt'],
    grant_strengths: ['Etablierte Leserschaft'],
    matching_foundation_themes: ['Medienförderung'],
  }

  it('baut ein GenerateDnaResult-kompatibles Objekt mit vorhandenem Profil, ohne quellen', () => {
    const ergebnis = bauePdfDaten(ROH, PROFIL)
    expect(ergebnis).toEqual({
      id: 42,
      version: 3,
      schaerfe_prozent: 74,
      tag_count: 2,
      sound_feeling: ROH.soundFeeling,
      tags: ROH.tags,
      hatte_crawl: true,
      aktiv_geschaltet: true,
      profil: PROFIL,
      warnungen: [],
    })
    expect(ergebnis.quellen).toBeUndefined()
  })

  it('ohne Arbeits-DNA-Profil (null): leeres, aber gültiges Profil-Objekt statt Crash', () => {
    const ergebnis = bauePdfDaten(ROH, null)
    expect(ergebnis.profil.dna_summary).toBe('')
    expect(ergebnis.profil.core_themes).toEqual([])
    expect(ergebnis.profil.matching_foundation_themes).toEqual([])
  })
})

describe('stufeAusPhase', () => {
  it.each([
    ['sammeln', 'sammeln'],
    ['verdichten', 'verdichten'],
    ['verdichten 3/7', 'verdichten'],
    ['profil', 'verdichten'],
    ['messen', 'messen'],
    ['aktivieren', 'aktivieren'],
    ['fertig', 'fertig'],
  ])('%s → %s', (phase, erwartet) => {
    expect(stufeAusPhase(phase)).toBe(erwartet)
  })

  it('unbekannte Phase fällt auf sammeln zurück (kein Crash)', () => {
    expect(stufeAusPhase('irgendwas_unbekanntes')).toBe('sammeln')
  })

  it('leerer String fällt auf sammeln zurück', () => {
    expect(stufeAusPhase('')).toBe('sammeln')
  })
})
