// ─── Provisionsmodell ─────────────────────────────────────────────────────────
// 10 % des zugesagten Förderbetrags pro Antrag, mit Unter- und Obergrenze.

export const PROVISION_SATZ = 0.10
export const PROVISION_MIN_CHF = 1000
export const PROVISION_MAX_CHF = 10000

/**
 * Berechnet die Provision für einen zugesagten Förderbetrag.
 * 0 CHF, wenn kein (oder ein negativer) Betrag zugesagt wurde.
 * Sonst 10 % des Betrags, gerundet und geklammert auf [CHF 1'000, CHF 10'000].
 * Die Klammerung gilt PRO GESUCH, nicht auf eine aggregierte Summe.
 */
export function berechneProvision(betragZugesagtChf: number): number {
  if (betragZugesagtChf <= 0) return 0
  const roh = Math.round(betragZugesagtChf * PROVISION_SATZ)
  return Math.min(PROVISION_MAX_CHF, Math.max(PROVISION_MIN_CHF, roh))
}
