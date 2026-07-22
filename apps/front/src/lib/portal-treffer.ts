/**
 * portal-treffer.ts: reine Kuratierungslogik für die Portal-Treffer-Seite
 * (/api/portal/treffer, src/pages/portal/treffer.tsx, Task 8).
 *
 * Kein IO hier: die Route sammelt die Rohdaten aus Directus (match_results +
 * stiftungen + applications des Session-Mediums) und formt sie zu den drei
 * Roh-Typen unten, bevor sie kuratiereTreffer übergibt.
 *
 * PortalTreffer ist bewusst score-/DNA-frei: das Medium sieht nie den
 * numerischen Score, die Stiftungs-DNA (Sound-Feeling, Schärfe, Tag-Gewichte,
 * Begründung pro Tag) oder die Match-Engine-internen Gewichte. Der Score
 * fliesst nur in uebereinstimmungsLabel und die interne Sortierung ein.
 *
 * Themen (Überschneidungs-Tags): `match_results` hat KEIN `top_tags`-Feld
 * (live gegen Directus verifiziert, siehe Task-8-Report), anders als die
 * separate Collection `sonder_match_results`, die dieses Feld trägt. Die
 * Route extrahiert die Themen darum über extrahiereUeberschneidungsTags aus
 * `score_breakdown.matched`, derselben Struktur, die
 * spark/match_engine.py:compute_math_score schreibt und die
 * spark/sonder_matcher.py für sein eigenes top_tags-Feld verwendet: die Tags,
 * die im Medium UND in der Stiftung vorkommen. Keine Stiftungs-DNA-Felder
 * werden dafür gelesen, nur die bereits im Match vorhandene Überschneidung.
 */

// ─── Typen (Vertrag) ────────────────────────────────────────────────────────────

export type PortalTreffer = {
  stiftungId: string
  name: string
  sitz: string | null
  website: string | null
  label: 'sehr hoch' | 'hoch' | 'gut'
  begruendung: string
  themen: string[]
  status: 'offen' | 'angefordert' | 'in_arbeit' | 'bereit' | 'abgeschickt' | 'nicht_relevant'
}

// ─── Rohformen (von der Route aus Directus-JSON gebaut) ────────────────────────

export interface PortalTrefferMatch {
  stiftungId: string
  score: number
  begruendung: string | null
  /** Bereits extrahierte Überschneidungs-Tags (siehe extrahiereUeberschneidungsTags), unsortiert oder sortiert. */
  topTags: string[] | null
}

export interface PortalTrefferStiftung {
  id: string
  name: string
  sitz: string | null
  website: string | null
}

export interface PortalTrefferApplicationPortal {
  angefordert_am?: string | null
  freigegeben_am?: string | null
  abgeschickt_am?: string | null
}

export interface PortalTrefferApplication {
  stiftungId: string
  status: string | null
  portal?: PortalTrefferApplicationPortal | null
}

/** Default-Limit, wenn die Route kein `PORTAL_TREFFER_LIMIT` aus der Env auflöst. */
export const PORTAL_TREFFER_LIMIT_DEFAULT = 20

// ─── Label ──────────────────────────────────────────────────────────────────────

/** Score → grobes Ampel-Label. Der Score selbst wird dem Medium nie gezeigt. */
export function uebereinstimmungsLabel(score: number): PortalTreffer['label'] {
  if (score >= 70) return 'sehr hoch'
  if (score >= 45) return 'hoch'
  return 'gut'
}

// ─── Tag-Humanisierung ──────────────────────────────────────────────────────────

/** Unterstriche → Leerzeichen, alles klein, nur der erste Buchstabe gross. */
function kapitalisiereEinzeln(teil: string): string {
  const text = teil.replace(/_/g, ' ').trim().toLowerCase()
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Macht aus einem rohen Vokabular-Slug ein lesbares Chip-Label.
 * 'lokaljournalismus' → 'Lokaljournalismus'; 'geo_basel' → 'Region Basel'
 * (geo_-Slugs bekommen das Präfix «Region», der Rest wird gleich behandelt).
 * Bewusst unabhängig vom Vokabular-Lookup (vokabular_v3.json/labelFuerSlug):
 * eine generische Transformation, kein Zugriff auf interne DNA-Labels.
 */
export function humanisiereTag(slug: string): string {
  const roh = (slug ?? '').trim()
  if (!roh) return ''
  if (roh.startsWith('geo_')) {
    return `Region ${kapitalisiereEinzeln(roh.slice(4))}`
  }
  return kapitalisiereEinzeln(roh)
}

// ─── Überschneidungs-Tags aus score_breakdown ──────────────────────────────────

interface RohMatchedTag {
  tag?: unknown
  gewicht?: unknown
  gewicht_stiftung?: unknown
}

function gewichtsProdukt(m: RohMatchedTag): number {
  const g = Number(m.gewicht ?? 0) || 0
  const gs = Number(m.gewicht_stiftung ?? 0) || 0
  return g * gs
}

/**
 * Extrahiert die Überschneidungs-Tags aus dem rohen `score_breakdown`-json
 * eines match_results-Datensatzes (siehe Modul-Kommentar). Absteigend nach
 * gewicht*gewicht_stiftung sortiert; im boolean_fallback-Modus (Stiftung ohne
 * veredelte DNA) fehlt gewicht_stiftung, das Produkt gilt dann als 0, kein
 * Crash, die Tags landen einfach hinten. Robust gegen jede Form: fehlendes
 * oder kein Array `matched`, Einträge ohne `tag`-Feld → werden übersprungen.
 */
export function extrahiereUeberschneidungsTags(scoreBreakdown: unknown): string[] {
  if (!scoreBreakdown || typeof scoreBreakdown !== 'object') return []
  const matched = (scoreBreakdown as { matched?: unknown }).matched
  if (!Array.isArray(matched)) return []
  return matched
    .filter((m): m is RohMatchedTag => !!m && typeof m === 'object' && typeof (m as RohMatchedTag).tag === 'string')
    .sort((a, b) => gewichtsProdukt(b) - gewichtsProdukt(a))
    .map((m) => String(m.tag))
}

// ─── Status-Ableitung ───────────────────────────────────────────────────────────

/**
 * Reihenfolge nach Fortschritt: abgeschickt schlägt bereit schlägt in_arbeit
 * schlägt angefordert schlägt offen. Eine Application ohne jedes Signal
 * (kein passender Eintrag, oder einer ohne portal-Zeitstempel und ohne
 * status=in_arbeit) ergibt 'offen'. 'nicht_relevant' wird hier nie
 * zurückgegeben, ausgeblendete Applications werden in kuratiereTreffer
 * bereits vollständig herausgefiltert (stiller Filter, kein Anzeige-Status).
 */
function leiteStatusAb(app: PortalTrefferApplication | undefined): PortalTreffer['status'] {
  const portal = app?.portal ?? null
  if (portal?.abgeschickt_am) return 'abgeschickt'
  if (portal?.freigegeben_am) return 'bereit'
  if (app?.status === 'in_arbeit') return 'in_arbeit'
  if (portal?.angefordert_am) return 'angefordert'
  return 'offen'
}

// ─── Kuratierung ────────────────────────────────────────────────────────────────

/**
 * Baut die kuratierte Treffer-Liste für die Portal-Ansicht.
 *
 * Reihenfolge: Matches nach Score absteigend sortieren → pro Stiftung nur
 * die stärkste Zeile behalten (eine Stiftung kann mehrere match_results-
 * Zeilen haben, wenn die Medium-DNA mehrfach neu gemessen wurde, live gegen
 * Directus beobachtet, siehe Task-8-Report; ohne diese Dedup-Stufe erschiene
 * dieselbe Stiftung mehrfach in der Liste) → Zeilen mit ausgeblendet-
 * Application UND Zeilen ohne zugehörige Stiftung herausfiltern → auf
 * `limit` begrenzen → auf PortalTreffer abbilden. Die Ausblende-Filterung
 * läuft VOR dem Limit-Schnitt, damit ein niedrigerer Treffer den frei
 * werdenden Platz im Top-N-Fenster einnimmt.
 */
export function kuratiereTreffer(
  matches: PortalTrefferMatch[],
  stiftungen: PortalTrefferStiftung[],
  applications: PortalTrefferApplication[],
  limit: number = PORTAL_TREFFER_LIMIT_DEFAULT,
): PortalTreffer[] {
  const stiftungById = new Map(stiftungen.map((s) => [s.id, s]))
  const appById = new Map(applications.map((a) => [a.stiftungId, a]))

  const sortiert = [...matches].sort((a, b) => b.score - a.score)

  const proStiftungEinmal: PortalTrefferMatch[] = []
  const gesehen = new Set<string>()
  for (const m of sortiert) {
    if (gesehen.has(m.stiftungId)) continue
    gesehen.add(m.stiftungId)
    proStiftungEinmal.push(m)
  }

  const kandidaten = proStiftungEinmal
    .filter((m) => {
      const app = appById.get(m.stiftungId)
      if (app?.status === 'ausgeblendet') return false
      return stiftungById.has(m.stiftungId)
    })
    .slice(0, Math.max(0, limit))

  return kandidaten.map((m) => {
    const stiftung = stiftungById.get(m.stiftungId) as PortalTrefferStiftung
    const app = appById.get(m.stiftungId)
    return {
      stiftungId: m.stiftungId,
      name: stiftung.name,
      sitz: stiftung.sitz,
      website: stiftung.website,
      label: uebereinstimmungsLabel(m.score),
      begruendung: m.begruendung ?? '',
      themen: (m.topTags ?? []).slice(0, 5).map(humanisiereTag),
      status: leiteStatusAb(app),
    }
  })
}
