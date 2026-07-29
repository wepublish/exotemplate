import { istNewsletterUnbekannt } from './medium-quellen'

/**
 * Nur die reine Prüf-Funktion: ingestWepublish selbst spricht mit fremden
 * GraphQL-Instanzen und ist ohne Netz nicht sinnvoll testbar.
 */
describe('istNewsletterUnbekannt', () => {
  it('erkennt die echte Meldung der zwölf-Instanz (Befund 29.07.2026)', () => {
    const echt =
      'We.Publish HTTP 400: {"errors":[{"message":"Cannot query field \\"mails\\" on type \\"Query\\". ' +
      'Did you mean \\"images\\", \\"pages\\", \\"polls\\", or \\"tags\\"?","locations":[{"line":3,"column":5}]}]}'
    expect(istNewsletterUnbekannt(echt)).toBe(true)
  })

  it('erkennt die Meldung auch ohne Anführungszeichen und in anderer Schreibweise', () => {
    expect(istNewsletterUnbekannt('cannot query field mails on type Query')).toBe(true)
    expect(istNewsletterUnbekannt("Cannot query field 'mails' on type Query")).toBe(true)
  })

  it('echte Fehler bleiben Fehler — sie müssen weiter gemeldet werden', () => {
    expect(istNewsletterUnbekannt('We.Publish HTTP 500: Internal Server Error')).toBe(false)
    expect(istNewsletterUnbekannt('fetch failed: ECONNREFUSED')).toBe(false)
    expect(istNewsletterUnbekannt('Cannot query field "articles" on type "Query"')).toBe(false)
    expect(istNewsletterUnbekannt('timeout after 30000ms')).toBe(false)
  })

  it('leere oder fehlende Eingabe ist kein Treffer', () => {
    expect(istNewsletterUnbekannt('')).toBe(false)
    expect(istNewsletterUnbekannt(undefined as unknown as string)).toBe(false)
  })
})
