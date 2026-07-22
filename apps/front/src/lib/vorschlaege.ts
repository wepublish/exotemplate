import { tenant } from '../../config/tenant'

export type Prioritaet = 'hoch' | 'mittel' | 'tief'
export type VorschlagTyp = 'frist' | 'match' | 'entwurf' | 'hygiene'
export type SortBar = { typ: VorschlagTyp; prioritaet: Prioritaet; frist: string | null }

const RANG: Record<Prioritaet, number> = { hoch: 0, mittel: 1, tief: 2 }

export function prioritaetRang(p: Prioritaet): number {
  return RANG[p] ?? 99
}

/**
 * Sortiert: echte To-dos (frist/entwurf/hygiene) IMMER oben, Match-Vorschläge
 * IMMER zuhinterst (unabhängig vom Score). Innerhalb jeder Gruppe nach
 * Priorität, dann Frist (früheste zuerst, null ans Ende).
 */
export function sortVorschlaege<T extends SortBar>(list: T[]): T[] {
  const ms = (f: string | null) => {
    if (!f) return Number.POSITIVE_INFINITY
    const t = new Date(f).getTime()
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
  }
  const istMatch = (t: VorschlagTyp) => (t === 'match' ? 1 : 0)
  return [...list].sort(
    (a, b) =>
      istMatch(a.typ) - istMatch(b.typ) ||
      prioritaetRang(a.prioritaet) - prioritaetRang(b.prioritaet) ||
      ms(a.frist) - ms(b.frist),
  )
}

export function typMeta(typ: VorschlagTyp): { label: string; akzent: string } {
  switch (typ) {
    case 'frist':
      return { label: 'Frist', akzent: 'border-rose-400' }
    case 'match':
      return { label: 'Match', akzent: 'border-emerald-400' }
    case 'entwurf':
      return { label: 'Entwurf', akzent: 'border-sky-400' }
    case 'hygiene':
      return { label: 'Hygiene', akzent: 'border-amber-400' }
    default:
      return { label: 'Hinweis', akzent: 'border-slate-300' }
  }
}

// ─── G4: Freigabe → Antrag, Verneinung → Lern-Notiz ───────────────────────────

/** Minimaler Eingang fuer die Aktions-Helfer (entkoppelt vom GraphQL-Typ). */
export type EntscheidBar = {
  typ: VorschlagTyp
  medium_id: string
  stiftung_id: string | null
  stiftung_name: string | null
  titel: string
}

/** Daten fuer create_applications_item bei Freigabe eines Match-Vorschlags.
 *  station 1 = identifiziert (STATUS_STATION); stiftung_id ist in applications int. */
export function bauApplicationDaten(v: EntscheidBar, user?: string) {
  const sid = v.stiftung_id != null ? parseInt(v.stiftung_id, 10) : NaN
  return {
    medium_id: v.medium_id,
    stiftung_id: Number.isNaN(sid) ? undefined : sid,
    stiftung_name: v.stiftung_name ?? undefined,
    status: 'identifiziert',
    station: 1,
    mandant: tenant.key,
    verantwortung: user || 'offen',
    zuletzt_geaendert_quelle: 'assistent-vorschlag',
  }
}

/** Daten fuer create_agent_lessons_item bei Verneinung (Lern-Loop). */
export function bauLessonDaten(v: EntscheidBar, user?: string) {
  return {
    scope: 'medium',
    mandant: tenant.key,
    medium_id: v.medium_id || null,
    stiftung_id: v.stiftung_id ?? null,
    kategorie: v.typ === 'match' ? 'foerderprofil' : v.typ,
    quelle: 'verworfen',
    notiz: `Vorschlag verneint${user ? ` von ${user}` : ''}: ${v.titel}`.slice(0, 1000),
  }
}

// ─── Auto-Stempel beim Statuswechsel ─────────────────────────────────────────

/**
 * Baut das data-Patch-Objekt für einen Statuswechsel.
 * Sendet `eingereicht_am` (nur wenn noch leer) bei Status "eingereicht",
 * `entschieden_am` (nur wenn noch leer) bei "zugesagt"/"abgelehnt".
 * `jetzt` kann für Tests fest gesetzt werden; Standard: neue Date().
 */
export function bauStatusPatch(
  neuerStatus: string,
  app: { eingereicht_am: string | null; entschieden_am: string | null },
  jetzt?: Date,
): Record<string, unknown> {
  const ts = (jetzt ?? new Date()).toISOString()
  const patch: Record<string, unknown> = {}

  if (neuerStatus === 'eingereicht' && !app.eingereicht_am) {
    patch.eingereicht_am = ts
  }
  if ((neuerStatus === 'zugesagt' || neuerStatus === 'abgelehnt') && !app.entschieden_am) {
    patch.entschieden_am = ts
  }

  return patch
}

/**
 * Hängt den Absagegrund an eine bestehende Bemerkung an, statt sie zu
 * überschreiben (Notizen von Ramona/Jolanda dürfen nicht verloren gehen).
 */
export function bauAbsageBemerkung(alt: string | null, grund: string): string {
  const g = grund.trim()
  const a = (alt ?? '').trim()
  if (!g) return a
  return a ? `${a}\nAbsagegrund: ${g}` : `Absagegrund: ${g}`
}

export function fristAmpel(
  frist: string | null,
): { variant: 'rot' | 'amber' | 'gelb'; tage: number } | null {
  if (!frist) return null
  const ziel = new Date(frist)
  if (Number.isNaN(ziel.getTime())) return null
  const heute = new Date()
  const d0 = Date.UTC(heute.getFullYear(), heute.getMonth(), heute.getDate())
  const d1 = Date.UTC(ziel.getFullYear(), ziel.getMonth(), ziel.getDate())
  const tage = Math.round((d1 - d0) / 86400000)
  if (tage <= 2) return { variant: 'rot', tage }
  if (tage <= 7) return { variant: 'amber', tage }
  if (tage <= 14) return { variant: 'gelb', tage }
  return null
}
