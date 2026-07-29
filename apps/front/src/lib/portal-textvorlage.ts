/**
 * portal-textvorlage.ts: reine Prüf-Logik für die Brief-/Dokumentvorlage, die
 * ein Medium neben dem Logo hochlädt (Wunsch Ramona 29.07.2026).
 *
 * Anders als beim Logo (dort entscheiden Magic Bytes, siehe portal-logo.ts)
 * genügt hier die Endung: eine Vorlage wird nicht gerendert, sondern nur
 * abgelegt und wieder heruntergeladen. Die Endungsliste hält versehentliche
 * Uploads (Bilder, Archive, ausführbare Dateien) draussen, ohne ein
 * Format-Versprechen zu machen, das wir nicht prüfen können.
 */

export const TEXTVORLAGE_MAX_BYTES = 10 * 1024 * 1024

/** Erlaubte Endungen, kleingeschrieben und ohne Punkt. */
export const TEXTVORLAGE_ENDUNGEN = ['docx', 'doc', 'odt', 'pdf', 'rtf', 'txt', 'md'] as const

export function endungVon(dateiname: string): string {
  const teile = (dateiname ?? '').trim().toLowerCase().split('.')
  return teile.length > 1 ? (teile.pop() ?? '') : ''
}

export function istErlaubteVorlage(dateiname: string): boolean {
  return (TEXTVORLAGE_ENDUNGEN as readonly string[]).includes(endungVon(dateiname))
}
