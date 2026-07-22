/**
 * pakete.ts — Typen und reine Helfer für den Sichtungs-Stapel.
 *
 * Das `paket`-Feld auf applications enthält ein JSON-Objekt, das der
 * Paket-Builder nachts befüllt. Hier werden es defensiv geparst und
 * Anzeige-Checks daraus abgeleitet.
 */

export interface PaketBetrag {
  suggested_amount: number
  reasoning: string
}

export interface PaketEinreichungsCheck {
  formular_erfasst: boolean
  hinweis: string
}

export interface Paket {
  score: number
  begruendung_kurz: string
  betrag: PaketBetrag | null
  gold: boolean
  gesuch_prompt: string
  gesuch_ablage: string
  gesuch_entwurf?: string
  gesuch_entwurf_modell?: string
  gesuch_entwurf_quelle?: string
  einreichungs_check: PaketEinreichungsCheck | null
  outbox_ids: string[]
  gebaut_am: string
}

/** Eine application-Zeile wie sie der Sichtungs-Stapel aus Directus erhält. */
export interface PaketApplication {
  id: string
  medium_id: string
  stiftung_id: string | number | null
  stiftung_name: string | null
  status: string
  gesichtet_am: string | null
  paket: Paket | null
}

/**
 * Parst das rohe `paket`-Feld defensiv.
 * Akzeptiert ein Objekt direkt oder einen JSON-String.
 * Gibt null zurück bei fehlenden oder unplausiblen Daten.
 */
export function parsePaket(raw: unknown): Paket | null {
  if (raw == null) return null

  let obj: unknown
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return null
    }
  } else {
    obj = raw
  }

  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null

  // Minimale Plausibilität: score muss numerisch sein
  const p = obj as Record<string, unknown>
  if (typeof p.score !== 'number') return null

  return {
    score: p.score as number,
    begruendung_kurz: typeof p.begruendung_kurz === 'string' ? p.begruendung_kurz : '',
    betrag: (p.betrag != null && typeof p.betrag === 'object' ? p.betrag : null) as PaketBetrag | null,
    gold: p.gold === true,
    gesuch_prompt: typeof p.gesuch_prompt === 'string' ? p.gesuch_prompt : '',
    gesuch_ablage: typeof p.gesuch_ablage === 'string' ? p.gesuch_ablage : '',
    ...(typeof p.gesuch_entwurf === 'string' ? { gesuch_entwurf: p.gesuch_entwurf } : {}),
    ...(typeof p.gesuch_entwurf_modell === 'string' ? { gesuch_entwurf_modell: p.gesuch_entwurf_modell } : {}),
    ...(typeof p.gesuch_entwurf_quelle === 'string' ? { gesuch_entwurf_quelle: p.gesuch_entwurf_quelle } : {}),
    einreichungs_check: (p.einreichungs_check != null && typeof p.einreichungs_check === 'object'
      ? p.einreichungs_check
      : null) as PaketEinreichungsCheck | null,
    outbox_ids: Array.isArray(p.outbox_ids)
      ? (p.outbox_ids as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    gebaut_am: typeof p.gebaut_am === 'string' ? p.gebaut_am : '',
  }
}

/**
 * Anzeige-Label für den Gesuch-Entwurf: leitet das Modell aus dem paket ab,
 * statt es hartkodiert «(Sonnet)» zu nennen (Loop-Entwürfe sind Opus-Klasse).
 */
export function entwurfLabel(p: Paket): string {
  const modell = (p.gesuch_entwurf_modell ?? '').toLowerCase()
  const quelle =
    p.gesuch_entwurf_quelle === 'studio-gesuch-loop'
      ? 'Gesuch-Loop'
      : p.gesuch_entwurf_quelle === 'app-knopf'
        ? 'Sofort-Entwurf'
        : null
  let name = ''
  if (modell.includes('opus')) name = 'Opus'
  else if (modell.includes('sonnet')) name = 'Sonnet'
  else if (modell.includes('haiku')) name = 'Haiku'
  else if (p.gesuch_entwurf_modell) name = p.gesuch_entwurf_modell
  const teile = [name, quelle].filter(Boolean)
  return teile.length ? `Gesuch-Entwurf (${teile.join(', ')})` : 'Gesuch-Entwurf'
}

/**
 * Parst applications.sonder_ref («<collection>:<id>», z.B. «kirchen:60») für
 * Sonder-Anträge (Kirchen/Förderer/Lotteriefonds/Sponsoren) — deren Gesuch-Prompt
 * läuft über den ziel-Parameter statt über stiftung_id.
 */
export function parseSonderRef(ref: unknown): { ziel: string; id: string } | null {
  if (typeof ref !== 'string') return null
  const m = ref.trim().match(/^(kirchen|foerderer|lotteriefonds|sponsoren):(\d+)$/)
  if (!m) return null
  return { ziel: m[1], id: m[2] }
}

/**
 * Stufe eines Pakets in der Gesuch-Warteschlange:
 *  - wartet: Prompt da, aber noch kein Entwurf (Loop oder «Entwurf jetzt» fällig)
 *  - review: Entwurf liegt vor, noch nicht final markiert
 *  - final:  Stiftungs-Ordner gesetzt (Gesuch erstellt und abgelegt)
 */
export type GesuchStufe = 'wartet' | 'review' | 'final'

export function gesuchStufe(a: {
  drive_link: string | null
  paket: Paket | null
}): GesuchStufe | null {
  if (!a.paket) return null
  if (typeof a.drive_link === 'string' && a.drive_link.trim()) return 'final'
  if (a.paket.gesuch_entwurf) return 'review'
  return 'wartet'
}

/**
 * Leitet vier Anzeige-Checks aus einem geparsten Paket ab.
 * Reihenfolge ist Teil des Vertrags (Tests abhängig).
 */
export function paketChecks(p: Paket): { label: string; ok: boolean }[] {
  return [
    {
      label: 'Betrag berechnet',
      ok: p.betrag != null,
    },
    {
      label: p.gold ? 'Gold-Prompt bereit' : 'Gesuch-Prompt bereit',
      ok: !!p.gesuch_prompt,
    },
    {
      label: 'Mitteilung vorbereitet',
      ok: p.outbox_ids.length > 0,
    },
    {
      label: 'Einreichung erfasst',
      ok: p.einreichungs_check?.formular_erfasst === true,
    },
  ]
}
