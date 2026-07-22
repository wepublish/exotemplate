/**
 * Hilfsfunktionen für die Stiftungsdatenbank-Seite.
 * Ausgelagert für Unit-Tests.
 */

export type Land = 'alle' | 'CH' | 'AT' | 'DE'
export type FoerderFilter = 'alle' | 'nur_foerder'

/**
 * Baut das Directus-Filter-Objekt aus den UI-Zuständen.
 * Gibt undefined zurück, wenn kein Filter aktiv ist.
 */
export function buildFilterForTest(
  land: Land,
  foerder: FoerderFilter,
  suche: string
): Record<string, unknown> | undefined {
  const conditions: unknown[] = []

  if (land !== 'alle') {
    conditions.push({ land: { _eq: land } })
  }
  if (foerder === 'nur_foerder') {
    conditions.push({ ist_foerderstiftung: { _eq: true } })
  }
  if (suche.trim()) {
    conditions.push({ Stiftungsname: { _icontains: suche.trim() } })
  }

  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0] as Record<string, unknown>
  return { _and: conditions }
}

/**
 * Normalisiert Freitext-Felder aus dem Scraper: bekannte Platzhalter
 * («Keine Angabe gefunden» u.ä.) werden wie leer behandelt, damit Karten und
 * Dialog keinen Datenmüll anzeigen. Verändert NICHTS in der Datenbank — rein
 * für die Anzeige.
 */
const PLATZHALTER =
  /^(keine angaben?( gefunden| vorhanden| möglich)?|nicht (gefunden|bekannt|verfügbar|angegeben)|n\/?a|k\.?\s?a\.?|null|undefined|[-–—.\s]+)$/i

export function clean(v?: string | null): string | null {
  if (!v) return null
  const t = v.trim()
  if (!t) return null
  if (PLATZHALTER.test(t)) return null
  return t
}
