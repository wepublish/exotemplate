/**
 * Helfer für den Import bestehender Drive-Anträge: Normalisierung von Namen
 * (Ordnername ↔ Stiftungsname) und Dedup gegen bereits erfasste Anträge.
 * Reine Logik, voll testbar.
 */

export type ScanEintrag = {
  medium: string
  ordner: string
  unterordner: string
  drive_url: string
}

export type AntragSnap = {
  medium_id: string | null
  stiftung_name: string | null
  drive_link: string | null
}

/** Normalisiert einen Namen: klein, Umlaute gefaltet, nur a-z0-9. */
export function normName(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[äàâ]/g, 'a')
    .replace(/[öô]/g, 'o')
    .replace(/[üû]/g, 'u')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '')
}

/** Vorgeschlagener Status je nach Drive-Unterordner. */
export function defaultStatus(unterordner: string): string {
  return unterordner === '04_archiv' ? 'archiviert' : 'in_arbeit'
}

/** True, wenn ein Scan-Eintrag bereits als Antrag erfasst ist. */
export function istErfasst(e: ScanEintrag, apps: AntragSnap[]): boolean {
  const en = normName(e.ordner)
  return apps.some((a) => {
    if (a.drive_link && a.drive_link.trim() === e.drive_url) return true
    if ((a.medium_id ?? '') !== e.medium) return false
    const an = normName(a.stiftung_name)
    if (!an || !en) return false
    if (an === en) return true
    // Ordnername wird in ablagePfad auf 60 Zeichen gekürzt → Präfix-Match (mit Guard).
    return (an.length >= 6 && en.length >= 6) && (an.startsWith(en) || en.startsWith(an))
  })
}

/** Filtert die noch nicht erfassten Scan-Einträge. */
export function nichtErfasst(eintraege: ScanEintrag[], apps: AntragSnap[]): ScanEintrag[] {
  return eintraege.filter((e) => !istErfasst(e, apps))
}
