import {
  MATCH_RUECKMELDUNG_KATEGORIE,
  RUECKMELDUNG_MAX_ZEICHEN,
  parseRueckmeldung,
  bauRueckmeldungLesson,
  wartetAufFreigabe,
  bauFreigabeVorschlag,
} from './match-rueckmeldung'

describe('parseRueckmeldung', () => {
  it('akzeptiert eine gültige Eingabe und trimmt', () => {
    const r = parseRueckmeldung({ stiftung_id: 11991, stiftung_name: '  Media Forward Fund ', notiz: '  Fördert nur Print.  ' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.eingabe).toEqual({ stiftungId: 11991, stiftungName: 'Media Forward Fund', notiz: 'Fördert nur Print.' })
  })

  it('nimmt stiftung_id auch als String', () => {
    const r = parseRueckmeldung({ stiftung_id: '42', notiz: 'Passt inhaltlich nicht.' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.eingabe.stiftungId).toBe(42)
  })

  it('weist fehlende oder unbrauchbare stiftung_id ab', () => {
    expect(parseRueckmeldung({ notiz: 'Passt nicht wirklich.' }).ok).toBe(false)
    expect(parseRueckmeldung({ stiftung_id: 'abc', notiz: 'Passt nicht wirklich.' }).ok).toBe(false)
    expect(parseRueckmeldung({ stiftung_id: 0, notiz: 'Passt nicht wirklich.' }).ok).toBe(false)
    expect(parseRueckmeldung({ stiftung_id: -5, notiz: 'Passt nicht wirklich.' }).ok).toBe(false)
  })

  it('verlangt eine Notiz mit Substanz', () => {
    expect(parseRueckmeldung({ stiftung_id: 1, notiz: '' }).ok).toBe(false)
    expect(parseRueckmeldung({ stiftung_id: 1, notiz: '   ' }).ok).toBe(false)
    expect(parseRueckmeldung({ stiftung_id: 1, notiz: 'nein' }).ok).toBe(false)
    expect(parseRueckmeldung({ stiftung_id: 1 }).ok).toBe(false)
  })

  it('kappt überlange Notizen', () => {
    const r = parseRueckmeldung({ stiftung_id: 1, notiz: 'x'.repeat(5000) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.eingabe.notiz).toHaveLength(RUECKMELDUNG_MAX_ZEICHEN)
  })

  it('fehlender Stiftungsname ist erlaubt (Route lädt ihn nach)', () => {
    const r = parseRueckmeldung({ stiftung_id: 1, notiz: 'Passt inhaltlich nicht.' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.eingabe.stiftungName).toBe('')
  })
})

describe('bauRueckmeldungLesson', () => {
  const eingabe = { stiftungId: 11991, stiftungName: 'Media Forward Fund', notiz: 'Fördert nur Print.' }

  it('Operator-Rückmeldung ist sofort aktiv', () => {
    const lesson = bauRueckmeldungLesson({ mediumId: 'cueltuer', mandant: 'wepublish', eingabe, quelle: 'matching-app' })
    expect(lesson).toEqual({
      scope: 'medium',
      mandant: 'wepublish',
      medium_id: 'cueltuer',
      stiftung_id: '11991',
      kategorie: MATCH_RUECKMELDUNG_KATEGORIE,
      quelle: 'matching-app',
      notiz: 'Fördert nur Print.',
      aktiv: true,
    })
  })

  it('Portal-Rückmeldung wartet auf die Freigabe (aktiv false)', () => {
    const lesson = bauRueckmeldungLesson({ mediumId: 'zwolf', mandant: 'wepublish', eingabe, quelle: 'portal' })
    expect(lesson.aktiv).toBe(false)
    expect(lesson.quelle).toBe('portal')
  })
})

describe('wartetAufFreigabe', () => {
  it('nur inaktive Portal-Zeilen warten', () => {
    expect(wartetAufFreigabe({ quelle: 'portal', aktiv: false })).toBe(true)
    expect(wartetAufFreigabe({ quelle: 'portal', aktiv: true })).toBe(false)
    expect(wartetAufFreigabe({ quelle: 'matching-app', aktiv: true })).toBe(false)
    // Eine inaktive Operator-Zeile ist eine zurückgenommene Lesson, keine
    // wartende Freigabe.
    expect(wartetAufFreigabe({ quelle: 'matching-app', aktiv: false })).toBe(false)
  })
})

describe('bauFreigabeVorschlag', () => {
  it('trägt Medium, Stiftung, Notiz und einen dedup_key mit der Lesson-id', () => {
    const v = bauFreigabeVorschlag({
      mediumId: 'zwolf',
      mandant: 'wepublish',
      stiftungName: 'Volkart Stiftung',
      stiftungId: 6651,
      notiz: 'Die fördern kein Lokales.',
      lessonId: 'abc-123',
    })
    expect(v.titel).toBe('Rückmeldung freigeben: zwolf zu Volkart Stiftung')
    expect(String(v.beschreibung)).toContain('Die fördern kein Lokales.')
    expect(v.dedup_key).toBe('match_rueckmeldung:abc-123')
    expect(v.status).toBe('offen')
    expect(v.stiftung_id).toBe('6651')
  })
})
