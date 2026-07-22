import {
  prioritaetRang,
  sortVorschlaege,
  typMeta,
  fristAmpel,
  bauApplicationDaten,
  bauLessonDaten,
  bauStatusPatch,
  bauAbsageBemerkung,
  type SortBar,
  type EntscheidBar,
} from './vorschlaege'

describe('prioritaetRang', () => {
  it('ordnet hoch < mittel < tief', () => {
    expect(prioritaetRang('hoch')).toBeLessThan(prioritaetRang('mittel'))
    expect(prioritaetRang('mittel')).toBeLessThan(prioritaetRang('tief'))
  })
  it('unbekannt landet hinten', () => {
    expect(prioritaetRang('x' as never)).toBeGreaterThan(prioritaetRang('tief'))
  })
})

describe('sortVorschlaege', () => {
  it('sortiert (innerhalb gleicher Gruppe) nach Priorität, dann Frist (früheste zuerst, null ans Ende)', () => {
    const list: SortBar[] = [
      { typ: 'frist', prioritaet: 'tief', frist: null },
      { typ: 'frist', prioritaet: 'hoch', frist: '2026-07-01T00:00:00' },
      { typ: 'frist', prioritaet: 'hoch', frist: '2026-06-10T00:00:00' },
      { typ: 'frist', prioritaet: 'mittel', frist: null },
    ]
    const out = sortVorschlaege(list)
    expect(out.map((v) => v.prioritaet)).toEqual(['hoch', 'hoch', 'mittel', 'tief'])
    expect(out[0].frist).toBe('2026-06-10T00:00:00')
  })

  it('reiht echte To-dos oben, Match-Vorschläge IMMER zuhinterst (auch bei hoher Priorität)', () => {
    const list: SortBar[] = [
      { typ: 'match', prioritaet: 'hoch', frist: null },
      { typ: 'hygiene', prioritaet: 'tief', frist: null },
      { typ: 'frist', prioritaet: 'mittel', frist: '2026-06-10T00:00:00' },
      { typ: 'entwurf', prioritaet: 'mittel', frist: null },
      { typ: 'match', prioritaet: 'mittel', frist: null },
    ]
    const out = sortVorschlaege(list)
    // erst die To-dos (nach Priorität/Frist), dann beide Matches am Ende
    expect(out.map((v) => v.typ)).toEqual(['frist', 'entwurf', 'hygiene', 'match', 'match'])
  })
})

describe('typMeta', () => {
  it('liefert Label und Akzentklasse je Typ, keine Emojis', () => {
    expect(typMeta('frist').label).toBe('Frist')
    expect(typMeta('match').label).toBe('Match')
    expect(typMeta('entwurf').label).toBe('Entwurf')
    expect(typMeta('hygiene').label).toBe('Hygiene')
    expect(typMeta('frist').akzent).toMatch(/^(bg|text|border)-/)
  })
})

describe('fristAmpel', () => {
  it('null bei fehlender Frist', () => {
    expect(fristAmpel(null)).toBeNull()
  })
  it('rot bei überfällig oder <= 2 Tagen', () => {
    expect(fristAmpel('2020-01-01T00:00:00')?.variant).toBe('rot')
  })
  it('amber/gelb/keine für 7/14/fern (nur Variant geprüft)', () => {
    const tage = (n: number) => {
      const d = new Date()
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
      return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}T00:00:00`
    }
    expect(fristAmpel(tage(5))?.variant).toBe('amber')
    expect(fristAmpel(tage(12))?.variant).toBe('gelb')
    expect(fristAmpel(tage(40))).toBeNull()
  })
})

const matchV: EntscheidBar = {
  typ: 'match',
  medium_id: 'bajour',
  stiftung_id: '12001',
  stiftung_name: 'Fondation Beispiel',
  titel: 'Starker Match (Score 84): Fondation Beispiel fuer bajour',
}

describe('bauApplicationDaten', () => {
  it('macht aus einem Match-Vorschlag gueltige Antragsdaten (stiftung_id als int, Station 1)', () => {
    const d = bauApplicationDaten(matchV, 'ramona@wepublish.ch')
    expect(d.medium_id).toBe('bajour')
    expect(d.stiftung_id).toBe(12001)
    expect(d.stiftung_name).toBe('Fondation Beispiel')
    expect(d.status).toBe('identifiziert')
    expect(d.station).toBe(1)
    expect(d.verantwortung).toBe('ramona@wepublish.ch')
    expect(d.zuletzt_geaendert_quelle).toBe('assistent-vorschlag')
  })
  it('setzt stiftung_id undefined bei fehlender/ungueltiger ID, verantwortung-Fallback', () => {
    const d = bauApplicationDaten({ ...matchV, stiftung_id: null })
    expect(d.stiftung_id).toBeUndefined()
    expect(d.verantwortung).toBe('offen')
  })
})

describe('bauStatusPatch', () => {
  const jetzt = new Date('2026-06-11T10:00:00.000Z')
  const leer = { eingereicht_am: null, entschieden_am: null }

  it('setzt eingereicht_am beim Statuswechsel auf eingereicht (wenn noch leer)', () => {
    const patch = bauStatusPatch('eingereicht', leer, jetzt)
    expect(patch.eingereicht_am).toBe('2026-06-11T10:00:00.000Z')
    expect(patch.entschieden_am).toBeUndefined()
  })

  it('setzt eingereicht_am NICHT, wenn bereits vorhanden', () => {
    const patch = bauStatusPatch('eingereicht', { ...leer, eingereicht_am: '2026-05-01T00:00:00.000Z' }, jetzt)
    expect(patch.eingereicht_am).toBeUndefined()
  })

  it('setzt entschieden_am bei zugesagt (wenn noch leer)', () => {
    const patch = bauStatusPatch('zugesagt', leer, jetzt)
    expect(patch.entschieden_am).toBe('2026-06-11T10:00:00.000Z')
    expect(patch.eingereicht_am).toBeUndefined()
  })

  it('setzt entschieden_am bei abgelehnt (wenn noch leer)', () => {
    const patch = bauStatusPatch('abgelehnt', leer, jetzt)
    expect(patch.entschieden_am).toBe('2026-06-11T10:00:00.000Z')
  })

  it('setzt entschieden_am NICHT, wenn bereits vorhanden', () => {
    const patch = bauStatusPatch('zugesagt', { ...leer, entschieden_am: '2026-05-01T00:00:00.000Z' }, jetzt)
    expect(patch.entschieden_am).toBeUndefined()
  })

  it('gibt leeres Objekt bei anderen Status zurück', () => {
    expect(bauStatusPatch('in_arbeit', leer, jetzt)).toEqual({})
    expect(bauStatusPatch('identifiziert', leer, jetzt)).toEqual({})
  })
})

describe('bauLessonDaten', () => {
  it('macht aus einer Verneinung eine medium-spezifische Lern-Notiz', () => {
    const d = bauLessonDaten(matchV, 'jolanda@wepublish.ch')
    expect(d.scope).toBe('medium')
    expect(d.medium_id).toBe('bajour')
    expect(d.stiftung_id).toBe('12001')
    expect(d.quelle).toBe('verworfen')
    expect(d.notiz).toContain('Fondation Beispiel')
    expect(d.notiz).toContain('jolanda@wepublish.ch')
  })
})

describe('bauAbsageBemerkung', () => {
  test('leere Bemerkung: nur der Grund', () => {
    expect(bauAbsageBemerkung(null, 'passt thematisch nicht')).toBe('Absagegrund: passt thematisch nicht')
    expect(bauAbsageBemerkung('', 'x')).toBe('Absagegrund: x')
  })

  test('bestehende Bemerkung bleibt erhalten', () => {
    expect(bauAbsageBemerkung('Notiz von Ramona', 'Budget erschöpft'))
      .toBe('Notiz von Ramona\nAbsagegrund: Budget erschöpft')
  })

  test('leerer Grund ändert nichts', () => {
    expect(bauAbsageBemerkung('Notiz', '   ')).toBe('Notiz')
    expect(bauAbsageBemerkung(null, '')).toBe('')
  })
})
