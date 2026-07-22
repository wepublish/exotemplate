import { tenant } from '../../config/tenant'

// ─── Ausblende-Gründe ─────────────────────────────────────────────────────────

export const AUSBLENDE_GRUENDE = [
  { key: 'bereits_gefoerdert', label: 'Erhalten bereits Förderung von dieser Stiftung' },
  { key: 'nicht_einreichen',   label: 'Nach Abklärung: nichts einreichen' },
  { key: 'passt_nicht',        label: 'Passt inhaltlich nicht' },
  { key: 'sonstiges',          label: 'Anderer Grund' },
] as const

export type AusblendeGrundKey = typeof AUSBLENDE_GRUENDE[number]['key']

export interface AusblendeGrund {
  key: AusblendeGrundKey
  label: string
}

// ─── Helfer ───────────────────────────────────────────────────────────────────

/**
 * Baut die Notiz, die als `bemerkung` auf den Antrag geschrieben wird.
 * Format: «Ausgeblendet: {stiftungName}. Grund: {grundLabel}. {freitext}»
 */
export function bauAusblendeNotiz(
  stiftungName: string,
  grundLabel: string,
  freitext?: string,
): string {
  const basis = `Ausgeblendet: ${stiftungName}. Grund: ${grundLabel}.`
  if (freitext && freitext.trim()) {
    return `${basis} ${freitext.trim()}`
  }
  return basis
}

/**
 * Baut das Lesson-Datenobjekt für CREATE_LESSON beim Ausblenden.
 * Spiegelt exakt den Feldsatz von bauLessonDaten (vorschlaege.ts).
 */
export function bauAusblendeLesson({
  mediumId,
  stiftungId,
  stiftungName,
  grundKey,
  grundLabel,
  freitext,
}: {
  mediumId: string
  stiftungId: string
  stiftungName: string
  grundKey: AusblendeGrundKey
  grundLabel: string
  freitext?: string
}) {
  return {
    scope: 'medium',
    mandant: tenant.key,
    medium_id: mediumId || null,
    stiftung_id: stiftungId ?? null,
    kategorie: grundKey,
    quelle: 'ausgeblendet',
    notiz: bauAusblendeNotiz(stiftungName, grundLabel, freitext).slice(0, 1000),
    aktiv: true,
  }
}
