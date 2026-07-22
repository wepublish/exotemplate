/**
 * Reine Logik für das manuelle Anlegen einer Stiftung.
 * Ausgelagert für Unit-Tests; die API-Route (/api/stiftung-anlegen) und der
 * Dialog in der Stiftungsdatenbank nutzen dieselben Helfer.
 */

export type StiftungLand = 'CH' | 'AT' | 'DE' | 'INT'

export interface StiftungEingabe {
  name: string
  webseite: string
  land: StiftungLand
  sitz?: string
}

export interface StiftungEingabeFehler {
  feld: 'name' | 'webseite'
  meldung: string
}

/**
 * Normalisiert eine vom Nutzer eingegebene Webseite zu einer http(s)-URL.
 * - Leer/Whitespace -> ''
 * - Ohne Schema -> https:// davor
 * - Schema bleibt erhalten (http/https)
 */
export function normalisiereWebseite(roh: string): string {
  const t = (roh || '').trim()
  if (!t) return ''
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t.replace(/^\/+/, '')}`
}

/**
 * Validiert die Eingabe für eine neue Stiftung.
 * Gibt eine Fehlerliste zurück (leer = gültig).
 */
export function validiereStiftungEingabe(e: { name: string; webseite: string }): StiftungEingabeFehler[] {
  const fehler: StiftungEingabeFehler[] = []
  const name = (e.name || '').trim()
  const web = (e.webseite || '').trim()

  if (name.length < 2) {
    fehler.push({ feld: 'name', meldung: 'Name fehlt oder ist zu kurz.' })
  }
  if (!web) {
    fehler.push({ feld: 'webseite', meldung: 'Webseite fehlt — sie wird für die DNA-Messung gebraucht.' })
  } else if (!/[a-z0-9]\.[a-z]{2,}/i.test(web)) {
    fehler.push({ feld: 'webseite', meldung: 'Webseite sieht nicht wie eine gültige Domain aus.' })
  }
  return fehler
}

/**
 * Baut das Directus create_stiftungen_input-Datenobjekt aus der Eingabe.
 * ist_foerderstiftung=true → kommt sofort ins Matching, sobald DNA gemessen ist.
 * datenqualitaet='manuell' markiert die Herkunft.
 */
export function baueStiftungDaten(e: StiftungEingabe): Record<string, unknown> {
  return {
    Stiftungsname: e.name.trim(),
    webseite: normalisiereWebseite(e.webseite) || null,
    land: e.land,
    sitz: e.sitz?.trim() || null,
    ist_foerderstiftung: true,
    datenqualitaet: 'manuell',
    verifiziert: false,
  }
}
