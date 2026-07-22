// Hilfsfunktionen für die Sonder-Match-Ansicht (Kirchen & Förderer).
// Rein, ohne Seiteneffekte — testbar.

import { tenant } from '../../config/tenant'
import { STATUS_STATION } from './applications.mutations'
import { sonderRef } from '@/lib/sonder-gesuch'
import type { BetragsVorschlag } from '@/data/types'

export type ZielCollection = 'kirchen' | 'foerderer' | 'lotteriefonds' | 'sponsoren'

export interface SonderMatch {
  id: string
  ziel_collection: ZielCollection | string | null
  ziel_id: number | null
  ziel_name: string | null
  score: number | null
  begruendung: string | null
  top_tags: string[] | null
  schaerfe_ziel: number | null
  /** Persistiertes Betrag-Recherche-Ergebnis (suggested_amount, reasoning, …) */
  betrag_recherche?: unknown
}

/** Anzeige-Label für die Ziel-Collection (Singular, für das Badge). */
export function zielLabel(coll: string | null): string {
  if (coll === 'kirchen') return 'Kirche'
  if (coll === 'foerderer') return 'Förderer'
  if (coll === 'lotteriefonds') return 'Lotteriefonds'
  if (coll === 'sponsoren') return 'Sponsor'
  return coll || '—'
}

/** Badge-Farbklasse je Ziel-Typ. */
export function zielBadgeClass(coll: string | null): string {
  if (coll === 'kirchen') return 'bg-violet-100 text-violet-700 border-violet-200'
  if (coll === 'foerderer') return 'bg-sky-100 text-sky-700 border-sky-200'
  if (coll === 'lotteriefonds') return 'bg-amber-100 text-amber-700 border-amber-200'
  if (coll === 'sponsoren') return 'bg-rose-100 text-rose-700 border-rose-200'
  return 'bg-slate-100 text-slate-600 border-slate-200'
}

/** Gruppen-Reihenfolge + Plural-Titel für die Sonder-Match-Ansicht. */
export const SONDER_GRUPPEN: { coll: ZielCollection; titel: string }[] = [
  { coll: 'kirchen', titel: 'Kirchen' },
  { coll: 'foerderer', titel: 'Förderer' },
  { coll: 'lotteriefonds', titel: 'Lotteriefonds' },
  { coll: 'sponsoren', titel: 'Sponsoren' },
]

/** Farbklasse für den Score-Wert (grobe Stufen, kleiner/enger Pool). */
export function scoreFarbe(score: number | null): string {
  const s = score ?? 0
  if (s >= 18) return 'bg-emerald-100 text-emerald-800'
  if (s >= 13) return 'bg-amber-100 text-amber-800'
  return 'bg-slate-100 text-slate-700'
}

/** Tags defensiv zu einer String-Liste normalisieren (json-Feld kann divers sein). */
export function normTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  return tags.filter((t): t is string => typeof t === 'string')
}

/** Persistiertes betrag_recherche-json defensiv auf BetragsVorschlag bringen. */
export function normBetrag(v: unknown): BetragsVorschlag | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const amount = Number(o.suggested_amount)
  if (!isFinite(amount) || amount < 0) return null
  return {
    suggested_amount: Math.round(amount),
    reasoning: typeof o.reasoning === 'string' ? o.reasoning : '',
    currency: 'CHF',
    ...(typeof o.computed_at === 'string' ? { computed_at: o.computed_at } : {}),
  }
}

// ─── Aktionen: Sonder-Match → applications ────────────────────────────────────

/** Antrags-Snapshot eines Sonder-Treffers (Teilmenge von applications). */
export interface SonderApplicationSnap {
  id: string
  sonder_ref: string | null
  status: string | null
  bemerkung?: string | null
}

/** sonder_ref eines Treffers — null, wenn Collection/ID fehlen. */
export function sonderRefVonMatch(t: Pick<SonderMatch, 'ziel_collection' | 'ziel_id'>): string | null {
  if (!t.ziel_collection || t.ziel_id == null) return null
  return sonderRef(t.ziel_collection, t.ziel_id)
}

/**
 * Daten für create_applications_item aus einem Sonder-Treffer.
 * KEIN stiftung_id — Sonder-IDs (kirchen 1..46 etc.) würden mit Stiftungs-IDs
 * kollidieren; die Verknüpfung läuft über sonder_ref.
 */
export function bauSonderApplicationDaten(
  t: Pick<SonderMatch, 'ziel_collection' | 'ziel_id' | 'ziel_name'>,
  medium: string,
  status: 'identifiziert' | 'ausgeblendet' = 'identifiziert',
  bemerkung?: string,
) {
  return {
    medium_id: medium,
    sonder_ref: sonderRefVonMatch(t),
    stiftung_name: t.ziel_name ?? undefined,
    status,
    station: STATUS_STATION[status],
    mandant: tenant.key,
    verantwortung: 'offen',
    zuletzt_geaendert_quelle: 'sonder-matching',
    ...(bemerkung ? { bemerkung } : {}),
  }
}
