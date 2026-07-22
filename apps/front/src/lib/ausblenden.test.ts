import {
  AUSBLENDE_GRUENDE,
  bauAusblendeNotiz,
  bauAusblendeLesson,
} from './ausblenden'

// ─── AUSBLENDE_GRUENDE ────────────────────────────────────────────────────────

describe('AUSBLENDE_GRUENDE', () => {
  it('enthält genau 4 Gründe', () => {
    expect(AUSBLENDE_GRUENDE).toHaveLength(4)
  })

  it('alle erwarteten Keys sind vorhanden', () => {
    const keys = AUSBLENDE_GRUENDE.map(g => g.key)
    expect(keys).toContain('bereits_gefoerdert')
    expect(keys).toContain('nicht_einreichen')
    expect(keys).toContain('passt_nicht')
    expect(keys).toContain('sonstiges')
  })

  it('jeder Eintrag hat key und label', () => {
    for (const g of AUSBLENDE_GRUENDE) {
      expect(typeof g.key).toBe('string')
      expect(typeof g.label).toBe('string')
      expect(g.key.length).toBeGreaterThan(0)
      expect(g.label.length).toBeGreaterThan(0)
    }
  })
})

// ─── bauAusblendeNotiz ────────────────────────────────────────────────────────

describe('bauAusblendeNotiz', () => {
  it('baut Notiz ohne Freitext', () => {
    const notiz = bauAusblendeNotiz('Stiftung Greulich', 'Passt inhaltlich nicht')
    expect(notiz).toBe('Ausgeblendet: Stiftung Greulich. Grund: Passt inhaltlich nicht.')
  })

  it('baut Notiz mit Freitext (angehängt nach Punkt + Leerzeichen)', () => {
    const notiz = bauAusblendeNotiz('Stiftung Greulich', 'Anderer Grund', 'Zu kleine Stiftung')
    expect(notiz).toBe('Ausgeblendet: Stiftung Greulich. Grund: Anderer Grund. Zu kleine Stiftung')
  })

  it('ignoriert Freitext der nur Leerzeichen enthält', () => {
    const notiz = bauAusblendeNotiz('Stiftung A', 'Nach Abklärung: nichts einreichen', '   ')
    expect(notiz).toBe('Ausgeblendet: Stiftung A. Grund: Nach Abklärung: nichts einreichen.')
  })

  it('ignoriert leeren Freitext', () => {
    const notiz = bauAusblendeNotiz('Stiftung B', 'Erhalten bereits Förderung von dieser Stiftung', '')
    expect(notiz).toBe('Ausgeblendet: Stiftung B. Grund: Erhalten bereits Förderung von dieser Stiftung.')
  })
})

// ─── bauAusblendeLesson ───────────────────────────────────────────────────────

describe('bauAusblendeLesson', () => {
  const basis = {
    mediumId: 'bajour',
    stiftungId: '12001',
    stiftungName: 'Fondation Greulich',
    grundKey: 'passt_nicht' as const,
    grundLabel: 'Passt inhaltlich nicht',
  }

  it('setzt scope, mandant, medium_id, stiftung_id, quelle, aktiv korrekt', () => {
    const d = bauAusblendeLesson(basis)
    expect(d.scope).toBe('medium')
    expect(d.mandant).toBe('wepublish')
    expect(d.medium_id).toBe('bajour')
    expect(d.stiftung_id).toBe('12001')
    expect(d.quelle).toBe('ausgeblendet')
    expect(d.aktiv).toBe(true)
  })

  it('setzt kategorie auf den grundKey', () => {
    const d = bauAusblendeLesson(basis)
    expect(d.kategorie).toBe('passt_nicht')
  })

  it('notiz enthält Stiftungsname und Grund', () => {
    const d = bauAusblendeLesson(basis)
    expect(d.notiz).toContain('Fondation Greulich')
    expect(d.notiz).toContain('Passt inhaltlich nicht')
  })

  it('notiz mit Freitext enthält auch den Freitext', () => {
    const d = bauAusblendeLesson({ ...basis, freitext: 'Zu nischig' })
    expect(d.notiz).toContain('Zu nischig')
  })

  it('notiz ohne Freitext enthält keinen undefined-String', () => {
    const d = bauAusblendeLesson(basis)
    expect(d.notiz).not.toContain('undefined')
  })

  it('notiz ist auf 1000 Zeichen begrenzt', () => {
    const langer = 'x'.repeat(2000)
    const d = bauAusblendeLesson({ ...basis, freitext: langer })
    expect(d.notiz.length).toBeLessThanOrEqual(1000)
  })

  it('funktioniert für alle 4 Grundkeys', () => {
    const keys = ['bereits_gefoerdert', 'nicht_einreichen', 'passt_nicht', 'sonstiges'] as const
    for (const key of keys) {
      const d = bauAusblendeLesson({ ...basis, grundKey: key, grundLabel: key })
      expect(d.kategorie).toBe(key)
    }
  })
})
