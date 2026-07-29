/**
 * portal-projekte.ts: reine Logik für die Projekte, die ein Medium selbst
 * eröffnet (Wunsch Jolanda 29.07.2026: «projekte eröffnen und die dna der
 * projekte messen und matchen lassen müsste für die medien auch noch autonom
 * ermöglicht werden»).
 *
 * Ein Projekt ist ein eigener Antragsgegenstand mit eigener DNA: eine
 * Recherchereihe, ein Podcast, ein Schwerpunkt. Es wird gegen dieselben
 * Stiftungen gematcht wie das Medium, aber mit dem Projekt-Profil — darum
 * eigene Treffer (match_results mit gesetzter projekt_id).
 *
 * Der Mess- und Match-Lauf ist derselbe wie im Operator-Cockpit
 * (projekt_matcher auf dem Spark, angestossen über /api/projekt-messen). Das
 * Portal ruft ihn nur mit einer Zugehörigkeitsprüfung davor.
 */

export const PROJEKT_NAME_MIN = 3
export const PROJEKT_NAME_MAX = 120
export const PROJEKT_BESCHREIBUNG_MIN = 40
export const PROJEKT_BESCHREIBUNG_MAX = 4000

export interface ProjektEingabe {
  name: string
  beschreibung: string
}

export type ProjektParse = { ok: true; eingabe: ProjektEingabe } | { ok: false; fehler: string }

/**
 * Prüft den POST-Body. Die Beschreibung hat eine Mindestlänge, weil sie die
 * ganze Grundlage der Projekt-DNA ist: aus zwei Wörtern entsteht kein Profil,
 * mit dem sich Stiftungen finden lassen — das Medium würde eine leere
 * Trefferliste bekommen und uns dafür verantwortlich machen.
 */
export function parseProjektEingabe(body: unknown): ProjektParse {
  const b = (body ?? {}) as Record<string, unknown>

  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (name.length < PROJEKT_NAME_MIN) {
    return { ok: false, fehler: `Der Projektname braucht mindestens ${PROJEKT_NAME_MIN} Zeichen.` }
  }

  const beschreibung = typeof b.beschreibung === 'string' ? b.beschreibung.trim() : ''
  if (beschreibung.length < PROJEKT_BESCHREIBUNG_MIN) {
    return {
      ok: false,
      fehler: `Beschreibt das Projekt in mindestens ${PROJEKT_BESCHREIBUNG_MIN} Zeichen — daraus entsteht das Profil, mit dem wir Stiftungen suchen.`,
    }
  }

  return {
    ok: true,
    eingabe: { name: name.slice(0, PROJEKT_NAME_MAX), beschreibung: beschreibung.slice(0, PROJEKT_BESCHREIBUNG_MAX) },
  }
}

/**
 * Slug aus Medium und Projektname. Das Medium-Präfix hält Slugs über Medien
 * hinweg eindeutig (zwei Redaktionen dürfen beide ein «klimaserie» haben) und
 * macht am Slug ablesbar, wem das Projekt gehört — der Spark-Matcher bekommt
 * nur den Slug.
 */
export function baueProjektSlug(mediumSlug: string, name: string): string {
  const kern = name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${mediumSlug}-${kern || 'projekt'}`
}

/** Macht einen bereits belegten Slug eindeutig: «-2», «-3», … */
export function eindeutigerSlug(basis: string, belegt: readonly string[]): string {
  if (!belegt.includes(basis)) return basis
  for (let n = 2; n < 100; n++) {
    const kandidat = `${basis}-${n}`
    if (!belegt.includes(kandidat)) return kandidat
  }
  return `${basis}-${Date.now()}`
}

// ─── Anzeige-Zustand ───────────────────────────────────────────────────────────

export type ProjektZustand = 'neu' | 'wird_gemessen' | 'bereit' | 'treffer_da'

export interface ProjektZeile {
  id: number
  name: string
  slug: string
  beschreibung: string
  /** projekte.directus_aktive_dna_version_id — gesetzt, sobald die DNA gemessen ist. */
  hatDna: boolean
  /** Anzahl match_results-Zeilen mit dieser projekt_id. */
  treffer: number
  /** true, solange ein Mess-/Match-Lauf für dieses Projekt läuft (Client-Zustand). */
  laeuft?: boolean
}

/**
 * Ableitung für die Anzeige. Reihenfolge der Prüfung: ein laufender Lauf
 * schlägt alles (das Medium hat gerade geklickt), dann Treffer, dann DNA.
 */
export function projektZustand(p: ProjektZeile): ProjektZustand {
  if (p.laeuft) return 'wird_gemessen'
  if (p.treffer > 0) return 'treffer_da'
  if (p.hatDna) return 'bereit'
  return 'neu'
}

export const PROJEKT_ZUSTAND_LABEL: Record<ProjektZustand, string> = {
  neu: 'Noch nicht gemessen',
  wird_gemessen: 'Wird gemessen und gematcht',
  bereit: 'Profil erstellt, Treffer folgen',
  treffer_da: 'Treffer bereit',
}
