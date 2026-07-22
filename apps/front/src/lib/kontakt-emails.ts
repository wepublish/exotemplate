/**
 * Helfer für das Bearbeiten der Medien-Kontakt-E-Mails (faas_medien.kontakt_emails).
 * kontakt_emails ist ein json-Array von Adressen und dient zugleich als Mail-
 * Versand-Allowlist. Reine Logik, voll testbar.
 */

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * Zerlegt eine Freitext-Eingabe (durch Komma, Semikolon, Leerzeichen oder
 * Zeilenumbruch getrennt) in eine bereinigte, deduplizierte Liste grob plausibler
 * E-Mail-Adressen. Unplausibles (ohne @ oder ohne Punkt danach) fällt weg.
 */
export function parseEmails(input: string): string[] {
  const teile = input
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const gueltig = teile.filter((e) => EMAIL_RE.test(e))
  return Array.from(new Set(gueltig))
}

/**
 * Stellt einen kontakt_emails-Wert (Array oder JSON-String, wie Directus ihn vor
 * liefert) als kommagetrennten Text für das Eingabefeld dar.
 */
export function formatEmails(value: unknown): string {
  let arr: unknown = value
  if (typeof value === 'string') {
    try {
      arr = JSON.parse(value)
    } catch {
      return value
    }
  }
  return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').join(', ') : ''
}
