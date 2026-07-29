/**
 * outbox.ts — Typen und reine Helfer fuer die Freigabe-Zentrale.
 * Gate-Prinzip: jede Aussenwirkung ist eine agent_outbox-Zeile; «Senden»
 * fuehrt sie ueber den Adapter aus (Allowlist wird dort hart geprueft).
 */
export type OutboxTyp = 'mail' | 'slack' | 'gesuch_final'
export type OutboxStatus = 'vorbereitet' | 'entwurf' | 'freigegeben' | 'versendet' | 'verworfen' | 'fehler'

export interface OutboxEintrag {
  id: string
  ts: string | null
  typ: OutboxTyp
  anlass: string
  status: OutboxStatus
  medium_id: string
  application_id: string | null
  stiftung_id: number | null
  empfaenger: string | null
  betreff: string | null
  inhalt: string
  anhang: unknown
  erstellt_von: string | null
  fehler_text: string | null
}

export const ANLASS_LABEL: Record<string, string> = {
  matching_liste: 'Matching-Liste',
  datensuppe_erinnerung: 'Unterlagen-Erinnerung',
  willkommensmail: 'Willkommensmail',
  nachfassen: 'Nachfassen',
  gesuch: 'Gesuch',
  onboarding_canvas: 'Onboarding-Canvas',
  foerderpaket: 'Förderempfehlung',
  sonstiges: 'Mitteilung',
}

export function gruppiereNachMedium(
  eintraege: OutboxEintrag[]
): { medium: string; eintraege: OutboxEintrag[] }[] {
  const map = new Map<string, OutboxEintrag[]>()
  for (const e of eintraege) {
    const liste = map.get(e.medium_id) ?? []
    liste.push(e)
    map.set(e.medium_id, liste)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([medium, eintraege]) => ({ medium, eintraege }))
}

/** Senden nur fuer Entwuerfe mit Empfaenger; gesuch_final laeuft ueber «Final markieren» (Phase 3). */
export function kannSenden(e: OutboxEintrag): boolean {
  return e.status === 'entwurf' && e.typ !== 'gesuch_final' && !!e.empfaenger
}
