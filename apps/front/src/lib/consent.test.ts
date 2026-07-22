import { CONSENT_TEXT, CONSENT_TEXT_VERSION, brauchtVollConsent, baueGesuchAuftrag } from './consent'
import type { PortalSession } from './portal-session'

// ─── CONSENT_TEXT_VERSION ───────────────────────────────────────────────────

describe('CONSENT_TEXT_VERSION', () => {
  it('ist 2026-07-09 (Wortlaut-Quelle: .superpowers/sdd/consent-text-final.md)', () => {
    expect(CONSENT_TEXT_VERSION).toBe('2026-07-09')
  })
})

// ─── CONSENT_TEXT ────────────────────────────────────────────────────────────

describe('CONSENT_TEXT', () => {
  it('enthält alle sechs Abschnitte, verbatim, von "Was We.Publish für euch tut" bis "Eure Bestätigung"', () => {
    expect(CONSENT_TEXT).toContain('## Was We.Publish für euch tut')
    expect(CONSENT_TEXT).toContain('## Was ihr im Gegenzug bezahlt')
    expect(CONSENT_TEXT).toContain('## Wann Sonderregeln gelten')
    expect(CONSENT_TEXT).toContain('## Was ihr uns zurückmeldet')
    expect(CONSENT_TEXT).toContain('## Wie wir mit euren Unterlagen umgehen')
    expect(CONSENT_TEXT).toContain('## Eure Bestätigung')
  })

  it('enthält die Provisionszahlen wörtlich', () => {
    expect(CONSENT_TEXT).toContain('10 Prozent')
    expect(CONSENT_TEXT).toContain("CHF 1'000")
    expect(CONSENT_TEXT).toContain("CHF 10'000")
  })

  it('endet mit dem letzten Satz von "Eure Bestätigung" (kein Trailing-Content danach)', () => {
    expect(CONSENT_TEXT.trim().endsWith('Eure Bestätigung wird mit Zeitstempel, Person und Textversion protokolliert.')).toBe(true)
  })

  it('enthält NICHT die Meta-Kopfzeilen (Titel, Textversion-Provenienz)', () => {
    expect(CONSENT_TEXT).not.toContain('Textversion:')
    expect(CONSENT_TEXT).not.toContain('Erstellt via Opus')
    expect(CONSENT_TEXT).not.toContain('# Consent- und Provisionstext')
  })

  it('enthält NICHT die Kurzfassung (die lebt nur in der UI, nicht im vollen Consent-Text)', () => {
    expect(CONSENT_TEXT).not.toContain('Kurzfassung für jedes weitere Gesuch')
  })

  it('ist frei von Gedankenstrichen (em/en dash) und scharfem ß', () => {
    expect(CONSENT_TEXT).not.toMatch(/[—–]/)
    expect(CONSENT_TEXT).not.toContain('ß')
  })
})

// ─── brauchtVollConsent ──────────────────────────────────────────────────────

describe('brauchtVollConsent', () => {
  it('leere Logs: true (noch nie zugestimmt)', () => {
    expect(brauchtVollConsent([])).toBe(true)
  })

  it('nur ein Log mit einer älteren Textversion: true', () => {
    expect(brauchtVollConsent([{ text_version: '2026-01-01', kontext: 'erstgesuch' }])).toBe(true)
  })

  it('ein Log mit der aktuellen Textversion: false', () => {
    expect(brauchtVollConsent([{ text_version: CONSENT_TEXT_VERSION, kontext: 'erstgesuch' }])).toBe(false)
  })

  it('mehrere Logs, davon einer mit der aktuellen Version (Reihenfolge egal): false', () => {
    expect(
      brauchtVollConsent([
        { text_version: '2025-01-01', kontext: 'erstgesuch' },
        { text_version: CONSENT_TEXT_VERSION, kontext: 'gesuch:abc-123' },
        { text_version: '2025-06-01', kontext: 'gesuch:def-456' },
      ]),
    ).toBe(false)
  })

  it('mehrere Logs, keiner mit der aktuellen Version: true', () => {
    expect(
      brauchtVollConsent([
        { text_version: '2025-01-01', kontext: 'erstgesuch' },
        { text_version: '2025-06-01', kontext: 'gesuch:def-456' },
      ]),
    ).toBe(true)
  })
})

// ─── baueGesuchAuftrag ───────────────────────────────────────────────────────

describe('baueGesuchAuftrag', () => {
  const session: PortalSession = { email: 'redaktion@bajour.ch', mediumSlug: 'bajour', rolle: 'medium' }
  const jetzt = new Date('2026-07-09T10:00:00.000Z')

  it('applicationDaten: stempelt status, station, mandant, medium_id, stiftung_id (Int), zuletzt_geaendert_quelle, verantwortung', () => {
    const { applicationDaten } = baueGesuchAuftrag(session, '12001', 'consent-id-1', jetzt)
    expect(applicationDaten.status).toBe('identifiziert')
    expect(applicationDaten.station).toBe(1)
    expect(applicationDaten.mandant).toBe('wepublish')
    expect(applicationDaten.medium_id).toBe('bajour')
    expect(applicationDaten.stiftung_id).toBe(12001)
    expect(typeof applicationDaten.stiftung_id).toBe('number')
    expect(applicationDaten.zuletzt_geaendert_quelle).toBe('portal')
    expect(applicationDaten.verantwortung).toBe('redaktion@bajour.ch')
  })

  it('portalJson: angefordert_am (ISO von jetzt), angefordert_von (session.email), consent_id', () => {
    const { portalJson } = baueGesuchAuftrag(session, '12001', 'consent-id-1', jetzt)
    expect(portalJson.angefordert_am).toBe('2026-07-09T10:00:00.000Z')
    expect(portalJson.angefordert_von).toBe('redaktion@bajour.ch')
    expect(portalJson.consent_id).toBe('consent-id-1')
  })

  it('unterschiedliche stiftungId/consentId schlagen sich in beiden Teilen nieder', () => {
    const { applicationDaten, portalJson } = baueGesuchAuftrag(session, '99', 'log-xyz', jetzt)
    expect(applicationDaten.stiftung_id).toBe(99)
    expect(portalJson.consent_id).toBe('log-xyz')
  })

  it('nutzt new Date() als Default, wenn kein jetzt übergeben wird', () => {
    const vor = Date.now()
    const { portalJson } = baueGesuchAuftrag(session, '12001', 'x')
    const nach = Date.now()
    const ts = new Date(portalJson.angefordert_am).getTime()
    expect(ts).toBeGreaterThanOrEqual(vor)
    expect(ts).toBeLessThanOrEqual(nach)
  })
})
