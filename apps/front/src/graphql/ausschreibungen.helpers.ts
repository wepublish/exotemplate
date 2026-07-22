/**
 * Hilfsfunktionen für die Ausschreibungen-Seite.
 * Ausgelagert für Unit-Tests.
 */

/**
 * Formatiert ein ISO-Timestamp-Feld («2026-06-15T00:00:00») auf «15.06.2026».
 * Gibt null zurück wenn kein gültiges Datum.
 */
export function formatDeadline(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * Gibt einen relativen Text zurück («in 3 Tagen», «heute», «abgelaufen», «in X Tagen»).
 * Basis: Mitternacht UTC heute.
 */
export function relativeDeadline(iso: string | null | undefined): {
  text: string
  variant: 'normal' | 'amber' | 'red' | 'gray'
} | null {
  if (!iso) return null
  const deadline = new Date(iso)
  if (isNaN(deadline.getTime())) return null

  // Mitternacht heute (UTC, vereinfacht)
  const now = new Date()
  const todayMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
  const deadlineMidnight = new Date(
    Date.UTC(deadline.getUTCFullYear(), deadline.getUTCMonth(), deadline.getUTCDate())
  )

  const diffMs = deadlineMidnight.getTime() - todayMidnight.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 0) {
    return { text: 'abgelaufen', variant: 'gray' }
  }
  if (diffDays === 0) {
    return { text: 'heute', variant: 'red' }
  }
  if (diffDays <= 14) {
    return { text: `in ${diffDays} Tag${diffDays === 1 ? '' : 'en'}`, variant: 'amber' }
  }
  return { text: `in ${diffDays} Tagen`, variant: 'normal' }
}

/**
 * Vergleichsfunktion zum Sortieren von Ausschreibungen nach deadline.
 * null-Deadlines kommen ans Ende (grösster Wert).
 */
export function sortByDeadline<T extends { deadline?: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const da = a.deadline ? new Date(a.deadline).getTime() : Infinity
    const db = b.deadline ? new Date(b.deadline).getTime() : Infinity
    return da - db
  })
}

/**
 * Ist eine Ausschreibung abgelaufen? Deadline liegt vor heute (Mitternacht UTC).
 * Ohne Deadline = laufend/wiederkehrend → gilt NIE als abgelaufen (bleibt sichtbar).
 */
export function istAbgelaufen(iso: string | null | undefined): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (isNaN(d.getTime())) return false
  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const dd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return dd < today
}
