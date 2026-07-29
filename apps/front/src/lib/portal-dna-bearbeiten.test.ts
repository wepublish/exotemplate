import {
  parseDnaBearbeitung,
  baueNeueDnaVersion,
  SOUND_FEELING_MAX,
  TAGS_MAX,
  type DnaVorlage,
} from './portal-dna-bearbeiten'

const BEKANNT = new Set(['lokaljournalismus', 'kultur_kunst', 'medienvielfalt', 'klima'])
const istBekannt = (slug: string) => BEKANNT.has(slug)

const TEXT = 'Wir sind ein Lokalmedium mit Fokus auf Recherche.'

function vorlage(teil: Partial<DnaVorlage> = {}): DnaVorlage {
  return {
    medium_id: 'zwolf',
    medium_name: 'Zwölf',
    version: 2,
    version_id: 'v2-app-2026-07-29T09-04-01-854Z',
    schaerfe_prozent: 68,
    sektionen: { a: 1 },
    exclusion_tags: [{ tag_slug: 'werbung' }],
    quellen: { datenbasis: 'web' },
    foerderpraxis: { x: true },
    vocabulary_version_at_creation: 3,
    antragsteller_typ: 'medium',
    ...teil,
  }
}

describe('parseDnaBearbeitung', () => {
  it('akzeptiert Text und Themen', () => {
    const r = parseDnaBearbeitung(
      { sound_feeling: `  ${TEXT}  `, tags: [{ tag_slug: 'lokaljournalismus', gewicht: 3, begruendung: 'Kern' }] },
      istBekannt,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.eingabe.soundFeeling).toBe(TEXT)
    expect(r.eingabe.tags).toEqual([{ tag_slug: 'lokaljournalismus', gewicht: 3, begruendung: 'Kern' }])
  })

  it('verlangt einen Text mit Substanz', () => {
    expect(parseDnaBearbeitung({ sound_feeling: 'zu kurz', tags: [{ tag_slug: 'klima', gewicht: 1 }] }, istBekannt).ok).toBe(false)
    expect(parseDnaBearbeitung({ tags: [{ tag_slug: 'klima', gewicht: 1 }] }, istBekannt).ok).toBe(false)
  })

  it('verlangt mindestens ein Thema — ohne Themen findet das Matching nichts', () => {
    const r = parseDnaBearbeitung({ sound_feeling: TEXT, tags: [] }, istBekannt)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.fehler).toMatch(/Mindestens ein Thema/)
  })

  it('weist erfundene Themen ab (sie würden die DNA still entwerten)', () => {
    const r = parseDnaBearbeitung({ sound_feeling: TEXT, tags: [{ tag_slug: 'erfunden_xyz', gewicht: 2 }] }, istBekannt)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.fehler).toContain('erfunden_xyz')
  })

  it('weist ungültige Gewichte ab, nimmt Strings an', () => {
    expect(parseDnaBearbeitung({ sound_feeling: TEXT, tags: [{ tag_slug: 'klima', gewicht: 5 }] }, istBekannt).ok).toBe(false)
    expect(parseDnaBearbeitung({ sound_feeling: TEXT, tags: [{ tag_slug: 'klima', gewicht: 0 }] }, istBekannt).ok).toBe(false)
    const r = parseDnaBearbeitung({ sound_feeling: TEXT, tags: [{ tag_slug: 'klima', gewicht: '2' }] }, istBekannt)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.eingabe.tags[0].gewicht).toBe(2)
  })

  it('dedupliziert dasselbe Thema still', () => {
    const r = parseDnaBearbeitung(
      { sound_feeling: TEXT, tags: [{ tag_slug: 'klima', gewicht: 2 }, { tag_slug: 'klima', gewicht: 3 }] },
      istBekannt,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.eingabe.tags).toHaveLength(1)
    expect(r.eingabe.tags[0].gewicht).toBe(2)
  })

  it('deckelt Textlänge und Themen-Anzahl', () => {
    const lang = parseDnaBearbeitung({ sound_feeling: 'x'.repeat(5000), tags: [{ tag_slug: 'klima', gewicht: 1 }] }, istBekannt)
    expect(lang.ok).toBe(true)
    if (lang.ok) expect(lang.eingabe.soundFeeling).toHaveLength(SOUND_FEELING_MAX)

    const vieleTags = Array.from({ length: TAGS_MAX + 1 }, () => ({ tag_slug: 'klima', gewicht: 1 }))
    expect(parseDnaBearbeitung({ sound_feeling: TEXT, tags: vieleTags }, istBekannt).ok).toBe(false)
  })
})

describe('baueNeueDnaVersion', () => {
  const eingabe = { soundFeeling: TEXT, tags: [{ tag_slug: 'klima' as const, gewicht: 3 as const, begruendung: '' }] }
  const jetzt = new Date('2026-07-29T12:34:56.789Z')

  it('zählt die Version hoch und verweist auf den Vorgänger', () => {
    const neu = baueNeueDnaVersion(vorlage(), eingabe, jetzt)
    expect(neu.version).toBe(3)
    expect(neu.vorgaenger_version_id).toBe('v2-app-2026-07-29T09-04-01-854Z')
    expect(neu.is_active).toBe(true)
  })

  it('erzeugt eine NEUE, als portal erkennbare version_id — sonst bleibt der LLM-Cache warm', () => {
    const alt = vorlage()
    const neu = baueNeueDnaVersion(alt, eingabe, jetzt)
    expect(neu.version_id).not.toBe(alt.version_id)
    expect(String(neu.version_id)).toMatch(/^v3-portal-/)
    // Keine Doppelpunkte/Punkte in der id (Muster der App-Messung).
    expect(String(neu.version_id)).not.toMatch(/[:.]/)
  })

  it('übernimmt die json-Blöcke und den Schärfe-Wert unverändert', () => {
    const alt = vorlage()
    const neu = baueNeueDnaVersion(alt, eingabe, jetzt)
    expect(neu.sektionen).toEqual(alt.sektionen)
    expect(neu.exclusion_tags).toEqual(alt.exclusion_tags)
    expect(neu.quellen).toEqual(alt.quellen)
    expect(neu.foerderpraxis).toEqual(alt.foerderpraxis)
    expect(neu.schaerfe_prozent).toBe(68)
    expect(neu.vocabulary_version_at_creation).toBe(3)
    expect(neu.antragsteller_typ).toBe('medium')
  })

  it('trägt Text und Themen der Eingabe und markiert die Herkunft', () => {
    const neu = baueNeueDnaVersion(vorlage(), eingabe, jetzt)
    expect(neu.sound_feeling).toBe(TEXT)
    expect(neu.tags).toEqual(eingabe.tags)
    expect(neu.veredelt_by).toBe('portal-medium')
  })

  it('nimmt KEIN embedding mit (es gehört zum alten Text)', () => {
    const neu = baueNeueDnaVersion(vorlage(), eingabe, jetzt)
    expect(neu).not.toHaveProperty('embedding')
  })

  it('verkraftet eine Vorlage ohne Versionsnummer', () => {
    const neu = baueNeueDnaVersion(vorlage({ version: undefined as unknown as number }), eingabe, jetzt)
    expect(neu.version).toBe(2)
  })
})
