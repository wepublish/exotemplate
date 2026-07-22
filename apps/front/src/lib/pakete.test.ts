import { parsePaket, paketChecks, entwurfLabel, gesuchStufe, parseSonderRef } from './pakete'

// ---- parsePaket ----

describe('parsePaket', () => {
  const gueltig = {
    score: 72,
    begruendung_kurz: 'Guter Match',
    betrag: { suggested_amount: 10000, reasoning: 'passt' },
    gold: false,
    gesuch_prompt: 'Sehr geehrte...',
    gesuch_ablage: '/drive/abc',
    einreichungs_check: { formular_erfasst: true, hinweis: 'Online' },
    outbox_ids: ['o1', 'o2'],
    gebaut_am: '2026-06-11T02:00:00',
  }

  test('gibt Objekt direkt zurück wenn es ein gültiges Paket ist', () => {
    const result = parsePaket(gueltig)
    expect(result).not.toBeNull()
    expect(result!.score).toBe(72)
    expect(result!.outbox_ids).toEqual(['o1', 'o2'])
  })

  test('parst einen JSON-String korrekt', () => {
    const result = parsePaket(JSON.stringify(gueltig))
    expect(result).not.toBeNull()
    expect(result!.score).toBe(72)
  })

  test('gibt null zurück bei kapputem JSON-String', () => {
    expect(parsePaket('{kaputt')).toBeNull()
  })

  test('gibt null zurück bei null', () => {
    expect(parsePaket(null)).toBeNull()
  })

  test('gibt null zurück wenn score nicht numerisch ist', () => {
    expect(parsePaket({ ...gueltig, score: 'hoch' })).toBeNull()
  })

  test('gibt null zurück bei Zahl oder Array', () => {
    expect(parsePaket(42)).toBeNull()
    expect(parsePaket([1, 2])).toBeNull()
  })
})

// ---- paketChecks ----

describe('paketChecks', () => {
  const voll = {
    score: 80,
    begruendung_kurz: 'Stark',
    betrag: { suggested_amount: 15000, reasoning: 'ok' },
    gold: false,
    gesuch_prompt: 'Prompt...',
    gesuch_ablage: '/drive/x',
    einreichungs_check: { formular_erfasst: true, hinweis: 'Online' },
    outbox_ids: ['o1'],
    gebaut_am: '2026-06-11T02:00:00',
  }

  test('gibt genau vier Einträge zurück', () => {
    const checks = paketChecks(voll)
    expect(checks).toHaveLength(4)
  })

  test('erster Check: Betrag berechnet — ok wenn betrag != null', () => {
    expect(paketChecks(voll)[0]).toEqual({ label: 'Betrag berechnet', ok: true })
    expect(paketChecks({ ...voll, betrag: null })[0]).toEqual({ label: 'Betrag berechnet', ok: false })
  })

  test('zweiter Check: Gesuch-Prompt bereit — Standard-Label wenn gold=false', () => {
    const c = paketChecks(voll)[1]
    expect(c.label).toBe('Gesuch-Prompt bereit')
    expect(c.ok).toBe(true)
  })

  test('zweiter Check: Gold-Prompt bereit — Label wenn gold=true', () => {
    const c = paketChecks({ ...voll, gold: true })[1]
    expect(c.label).toBe('Gold-Prompt bereit')
    expect(c.ok).toBe(true)
  })

  test('zweiter Check: ok=false wenn gesuch_prompt leer', () => {
    expect(paketChecks({ ...voll, gesuch_prompt: '' })[1].ok).toBe(false)
    expect(paketChecks({ ...voll, gesuch_prompt: null as unknown as string })[1].ok).toBe(false)
  })

  test('dritter Check: Mitteilung vorbereitet — ok wenn outbox_ids nicht leer', () => {
    expect(paketChecks(voll)[2]).toEqual({ label: 'Mitteilung vorbereitet', ok: true })
    expect(paketChecks({ ...voll, outbox_ids: [] })[2]).toEqual({ label: 'Mitteilung vorbereitet', ok: false })
  })

  test('vierter Check: Einreichung erfasst — ok wenn formular_erfasst=true', () => {
    expect(paketChecks(voll)[3]).toEqual({ label: 'Einreichung erfasst', ok: true })
    expect(paketChecks({ ...voll, einreichungs_check: { formular_erfasst: false, hinweis: '' } })[3]).toEqual({
      label: 'Einreichung erfasst',
      ok: false,
    })
    expect(paketChecks({ ...voll, einreichungs_check: null as unknown as { formular_erfasst: boolean; hinweis: string } })[3]).toEqual({
      label: 'Einreichung erfasst',
      ok: false,
    })
  })
})

describe('entwurfLabel', () => {
  const basis = {
    score: 80, begruendung_kurz: '', betrag: null, gold: true,
    gesuch_prompt: 'p', gesuch_ablage: '', einreichungs_check: null,
    outbox_ids: [], gebaut_am: '2026-07-01T00:00:00Z',
  }

  test('ohne Modell-Angabe generisches Label', () => {
    expect(entwurfLabel(basis)).toBe('Gesuch-Entwurf')
  })

  test('Sonnet-Modell wird erkannt', () => {
    expect(entwurfLabel({ ...basis, gesuch_entwurf_modell: 'claude-sonnet-4-6' }))
      .toBe('Gesuch-Entwurf (Sonnet)')
  })

  test('Opus-Modell + Loop-Quelle', () => {
    expect(entwurfLabel({
      ...basis, gesuch_entwurf_modell: 'claude-opus-4-8', gesuch_entwurf_quelle: 'studio-gesuch-loop',
    })).toBe('Gesuch-Entwurf (Opus, Gesuch-Loop)')
  })

  test('App-Knopf-Quelle', () => {
    expect(entwurfLabel({
      ...basis, gesuch_entwurf_modell: 'claude-sonnet-4-6', gesuch_entwurf_quelle: 'app-knopf',
    })).toBe('Gesuch-Entwurf (Sonnet, Sofort-Entwurf)')
  })

  test('unbekanntes Modell wird durchgereicht', () => {
    expect(entwurfLabel({ ...basis, gesuch_entwurf_modell: 'qwen3.6-27b' }))
      .toBe('Gesuch-Entwurf (qwen3.6-27b)')
  })
})

describe('gesuchStufe', () => {
  const basis = {
    score: 80, begruendung_kurz: '', betrag: null, gold: true,
    gesuch_prompt: 'p', gesuch_ablage: '', einreichungs_check: null,
    outbox_ids: [], gebaut_am: '2026-07-01T00:00:00Z',
  }

  test('ohne Paket: null', () => {
    expect(gesuchStufe({ drive_link: null, paket: null })).toBeNull()
  })

  test('Prompt ohne Entwurf: wartet', () => {
    expect(gesuchStufe({ drive_link: null, paket: basis })).toBe('wartet')
  })

  test('mit Entwurf: review', () => {
    expect(gesuchStufe({ drive_link: null, paket: { ...basis, gesuch_entwurf: 'Text' } })).toBe('review')
  })

  test('mit Stiftungs-Ordner: final (auch ohne Entwurf, z.B. Opus-Weg)', () => {
    expect(gesuchStufe({ drive_link: 'https://drive.google.com/x', paket: basis })).toBe('final')
  })

  test('leerer drive_link zählt nicht als final', () => {
    expect(gesuchStufe({ drive_link: '   ', paket: { ...basis, gesuch_entwurf: 'T' } })).toBe('review')
  })
})

describe('parseSonderRef', () => {
  test('gueltige Refs werden geparst', () => {
    expect(parseSonderRef('kirchen:60')).toEqual({ ziel: 'kirchen', id: '60' })
    expect(parseSonderRef('foerderer:7')).toEqual({ ziel: 'foerderer', id: '7' })
  })

  test('ungueltiges liefert null', () => {
    expect(parseSonderRef('stiftungen:1')).toBeNull()
    expect(parseSonderRef('kirchen:abc')).toBeNull()
    expect(parseSonderRef(null)).toBeNull()
    expect(parseSonderRef('')).toBeNull()
  })
})
