/**
 * foerderhistorie.ts: reine Logik für die Förderhistorie und Stiftungs-
 * Ausschlüsse je Medium (Collection `medium_foerderhistorie`).
 *
 * Ein Medium erfasst hier, was es selbst am besten weiss: welche Stiftungen
 * es früher gefördert haben (wann, wie viel, wofür), wo ein Gesuch abgelehnt
 * wurde, und welche Stiftungen für künftige Gesuche nicht (mehr) in Frage
 * kommen. Kein IO: die Portal-Route (/api/portal/foerderhistorie) und die
 * Treffer-Route (/api/portal/treffer) rufen diese Funktionen mit bereits
 * gelesenen Daten auf.
 *
 * Wirkung (siehe docs/superpowers/specs/2026-07-29-foerderhistorie-und-
 * ausschluesse-design.md): Ausschlüsse filtern die Portal-Treffer und die
 * Match-Engine (pipeline/spark/match_engine.py, load_medium_ausschluesse);
 * `erhalten`/`abgelehnt` erzeugen zusätzlich einen medium_knowledge-Eintrag
 * (Kategorie previous_application), damit die Historie ohne neue Pipeline in
 * die Ein-Knopf-DNA und den Wissens-Score fliesst.
 */

// ─── Typen ────────────────────────────────────────────────────────────────────

export const FOERDERHISTORIE_TYPEN = [
  { key: 'erhalten', label: 'Förderung erhalten' },
  { key: 'abgelehnt', label: 'Gesuch wurde abgelehnt' },
  { key: 'ausgeschlossen', label: 'Kommt für uns nicht in Frage' },
] as const

export type FoerderhistorieTyp = typeof FOERDERHISTORIE_TYPEN[number]['key']

export function foerderhistorieTypLabel(typ: string): string {
  return FOERDERHISTORIE_TYPEN.find((t) => t.key === typ)?.label ?? typ
}

/** Validierte Eingabe aus dem Portal-Formular (POST-Body). */
export interface FoerderhistorieEingabe {
  typ: FoerderhistorieTyp
  stiftungId: number | null
  stiftungName: string
  jahr: number | null
  betrag: number | null
  zweck: string | null
  ausgeschlossen: boolean
  ausschlussGrund: string | null
}

/** Eine gespeicherte Zeile, wie die Routen sie aus Directus formen. */
export interface FoerderhistorieZeile {
  id: number
  stiftungId: string | null
  stiftungName: string
  typ: string
  jahr: number | null
  betrag: number | null
  zweck: string | null
  ausgeschlossen: boolean
  ausschlussGrund: string | null
}

// ─── Eingabe-Validierung ──────────────────────────────────────────────────────

const NAME_MAX = 200
const TEXT_MAX = 500
const BETRAG_MAX = 100_000_000
const JAHR_MIN = 1900

function leseGanzzahl(roh: unknown): number | null {
  if (typeof roh === 'number' && Number.isFinite(roh)) return Math.trunc(roh)
  if (typeof roh === 'string' && roh.trim()) {
    const n = parseInt(roh.trim(), 10)
    return Number.isNaN(n) ? null : n
  }
  return null
}

function leseText(roh: unknown, max: number): string | null {
  if (typeof roh !== 'string') return null
  const text = roh.trim()
  if (!text) return null
  return text.slice(0, max)
}

export type ParseErgebnis =
  | { ok: true; eingabe: FoerderhistorieEingabe }
  | { ok: false; fehler: string }

/**
 * Prüft und normalisiert den POST-Body des Portal-Formulars. `jetztJahr`
 * kommt vom Aufrufer (testbar ohne Uhr); Jahre ausserhalb
 * [1900, jetztJahr+1] werden abgewiesen, nicht stillschweigend korrigiert.
 */
export function parseFoerderhistorieEingabe(body: unknown, jetztJahr: number): ParseErgebnis {
  const b = (body ?? {}) as Record<string, unknown>

  const typ = FOERDERHISTORIE_TYPEN.find((t) => t.key === b.typ)?.key
  if (!typ) {
    return { ok: false, fehler: 'typ muss erhalten, abgelehnt oder ausgeschlossen sein.' }
  }

  const stiftungName = leseText(b.stiftung_name, NAME_MAX)
  if (!stiftungName || stiftungName.length < 2) {
    return { ok: false, fehler: 'stiftung_name (mindestens 2 Zeichen) erforderlich.' }
  }

  const stiftungIdRoh = leseGanzzahl(b.stiftung_id)
  const stiftungId = stiftungIdRoh !== null && stiftungIdRoh > 0 ? stiftungIdRoh : null

  let jahr: number | null = null
  if (b.jahr !== undefined && b.jahr !== null && b.jahr !== '') {
    jahr = leseGanzzahl(b.jahr)
    if (jahr === null || jahr < JAHR_MIN || jahr > jetztJahr + 1) {
      return { ok: false, fehler: `jahr muss zwischen ${JAHR_MIN} und ${jetztJahr + 1} liegen.` }
    }
  }

  let betrag: number | null = null
  if (b.betrag !== undefined && b.betrag !== null && b.betrag !== '') {
    betrag = leseGanzzahl(b.betrag)
    if (betrag === null || betrag < 0 || betrag > BETRAG_MAX) {
      return { ok: false, fehler: 'betrag muss eine Zahl in CHF sein (0 bis 100 Mio.).' }
    }
  }

  const ausgeschlossen = typ === 'ausgeschlossen' ? true : b.ausgeschlossen === true

  return {
    ok: true,
    eingabe: {
      typ,
      stiftungId,
      stiftungName,
      // Beim reinen Ausschluss gibt es kein Förder-Ereignis: Jahr/Betrag/Zweck
      // bleiben leer, damit die Zeile nicht wie eine Förderung aussieht.
      jahr: typ === 'ausgeschlossen' ? null : jahr,
      betrag: typ === 'erhalten' ? betrag : null,
      zweck: typ === 'ausgeschlossen' ? null : leseText(b.zweck, TEXT_MAX),
      ausgeschlossen,
      ausschlussGrund: ausgeschlossen ? leseText(b.ausschluss_grund, TEXT_MAX) : null,
    },
  }
}

// ─── Ausschluss-Ableitung (Treffer-Filter) ────────────────────────────────────

/** true, wenn die Zeile die Stiftung für künftige Gesuche ausschliesst. */
export function istAusschluss(zeile: Pick<FoerderhistorieZeile, 'typ' | 'ausgeschlossen'>): boolean {
  return zeile.typ === 'ausgeschlossen' || zeile.ausgeschlossen === true
}

/**
 * Menge der ausgeschlossenen stiftung_ids (als String, wie PortalTreffer sie
 * führt). Zeilen ohne verknüpfte Stiftung können nichts filtern – der
 * Freitext-Name reicht dafür nicht (Namens-Matching wäre zu unscharf).
 */
export function bauAusschlussSet(zeilen: FoerderhistorieZeile[]): Set<string> {
  const set = new Set<string>()
  for (const z of zeilen) {
    if (istAusschluss(z) && z.stiftungId) set.add(z.stiftungId)
  }
  return set
}

// ─── Badge-Labels für die Trefferkarte ────────────────────────────────────────

export function formatBetragChf(betrag: number): string {
  return `CHF ${betrag.toLocaleString('de-CH')}`
}

function historieLabel(zeile: FoerderhistorieZeile): string | null {
  if (zeile.typ === 'erhalten') {
    const teile = ['Frühere Förderung']
    if (zeile.jahr) teile.push(String(zeile.jahr))
    const basis = teile.join(' ')
    return zeile.betrag ? `${basis} · ${formatBetragChf(zeile.betrag)}` : basis
  }
  if (zeile.typ === 'abgelehnt') {
    return zeile.jahr ? `Gesuch ${zeile.jahr} abgelehnt` : 'Gesuch früher abgelehnt'
  }
  return null
}

/**
 * Map stiftungId → Badge-Text für die Trefferkarte. Bei mehreren Zeilen pro
 * Stiftung gewinnt `erhalten` vor `abgelehnt`, innerhalb desselben Typs das
 * jüngste Jahr (null-Jahre zuletzt).
 */
export function bauHistorieLabels(zeilen: FoerderhistorieZeile[]): Map<string, string> {
  const rang = (z: FoerderhistorieZeile) => (z.typ === 'erhalten' ? 2 : z.typ === 'abgelehnt' ? 1 : 0)
  const beste = new Map<string, FoerderhistorieZeile>()
  for (const z of zeilen) {
    if (!z.stiftungId || rang(z) === 0) continue
    const bisher = beste.get(z.stiftungId)
    if (!bisher || rang(z) > rang(bisher) || (rang(z) === rang(bisher) && (z.jahr ?? 0) > (bisher.jahr ?? 0))) {
      beste.set(z.stiftungId, z)
    }
  }
  const labels = new Map<string, string>()
  for (const [id, z] of beste) {
    const label = historieLabel(z)
    if (label) labels.set(id, label)
  }
  return labels
}

// ─── medium_knowledge-Eintrag (DNA + Wissens-Score) ───────────────────────────

/**
 * Baut den medium_knowledge-Eintrag für `erhalten`/`abgelehnt`-Zeilen
 * (Kategorie previous_application, siehe Modul-Kommentar). Für reine
 * Ausschlüsse gibt es keinen Wissens-Eintrag: sie beschreiben eine
 * Beziehungs-Grenze, nicht die publizistische DNA des Mediums.
 */
export function bauKnowledgeEintrag(eingabe: FoerderhistorieEingabe): { title: string; content: string } | null {
  if (eingabe.typ !== 'erhalten' && eingabe.typ !== 'abgelehnt') return null

  const titelTeile = ['Förderhistorie:', eingabe.stiftungName]
  if (eingabe.jahr) titelTeile.push(String(eingabe.jahr))
  const title = titelTeile.join(' ').slice(0, NAME_MAX)

  const saetze = [
    'Bisherige Förderbeziehung, vom Medium im Portal erfasst.',
    `Stiftung: ${eingabe.stiftungName}.`,
    eingabe.typ === 'erhalten' ? 'Ergebnis: Förderung erhalten.' : 'Ergebnis: Gesuch abgelehnt.',
  ]
  if (eingabe.jahr) saetze.push(`Jahr: ${eingabe.jahr}.`)
  if (eingabe.betrag !== null) saetze.push(`Betrag: ${formatBetragChf(eingabe.betrag)}.`)
  if (eingabe.zweck) saetze.push(`Zweck: ${eingabe.zweck}.`)
  if (eingabe.ausgeschlossen) {
    saetze.push(
      eingabe.ausschlussGrund
        ? `Kommt für künftige Gesuche nicht mehr in Frage (${eingabe.ausschlussGrund}).`
        : 'Kommt für künftige Gesuche nicht mehr in Frage.',
    )
  }
  return { title, content: saetze.join(' ') }
}
