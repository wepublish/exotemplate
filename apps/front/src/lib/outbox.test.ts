import { gruppiereNachMedium, kannSenden, ANLASS_LABEL, type OutboxEintrag } from './outbox'

const basis: OutboxEintrag = {
  id: '1', ts: '2026-06-11T08:00:00Z', typ: 'slack', anlass: 'nachfassen',
  status: 'entwurf', medium_id: 'bajour', application_id: null, stiftung_id: null,
  empfaenger: '#p-faas-bajour', betreff: null, inhalt: 'Hallo', anhang: null,
  erstellt_von: 'waechter', fehler_text: null,
}

describe('outbox-helfer', () => {
  test('gruppiereNachMedium gruppiert und sortiert nach Medium', () => {
    const e = [basis, { ...basis, id: '2', medium_id: 'aufbruch' }, { ...basis, id: '3' }]
    const g = gruppiereNachMedium(e)
    expect(g.map((x) => x.medium)).toEqual(['aufbruch', 'bajour'])
    expect(g[1].eintraege).toHaveLength(2)
  })

  test('kannSenden: nur entwurf mit Empfaenger, gesuch_final nie', () => {
    expect(kannSenden(basis)).toBe(true)
    expect(kannSenden({ ...basis, status: 'versendet' })).toBe(false)
    expect(kannSenden({ ...basis, empfaenger: '' })).toBe(false)
    expect(kannSenden({ ...basis, typ: 'gesuch_final' })).toBe(false)
  })

  test('ANLASS_LABEL kennt alle Anlaesse aus der Spec', () => {
    for (const a of ['matching_liste', 'datensuppe_erinnerung', 'willkommensmail', 'nachfassen', 'gesuch', 'onboarding_canvas', 'foerderpaket', 'sonstiges']) {
      expect(ANLASS_LABEL[a]).toBeTruthy()
    }
  })
})
