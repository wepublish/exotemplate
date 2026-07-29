/**
 * medium-events.ts — Ereignis-Protokoll je Medium (Collection `medium_events`).
 *
 * Jede Station des Workflows (Onboarding, DNA, Freigaben, Stiftungswahl,
 * Gesuche, Zusage) schreibt hier einen Eintrag. Zwei Konsumenten:
 *   1. Die Slack-Roadmap auf dem Spark (faas_roadmap_slack.py) zeichnet den
 *      Stand automatisch im Medien-Channel nach (Entscheid Jolanda 28.07.2026:
 *      «das alles soll automatisch im slack-channel in einer roadmap
 *      aufgezeichnet werden»).
 *   2. Auswertungen/Debugging: wann hat welches Medium welchen Schritt erreicht.
 *
 * Bewusst fire-and-forget: ein fehlgeschlagener Protokoll-Schreiber darf NIE
 * die eigentliche Aktion (Freischalten, Freigeben, Upload) scheitern lassen.
 * Fehler landen im Server-Log, sonst nirgends.
 */

import { tenant } from '../../config/tenant'

export type MediumEventTyp =
  | 'medium_aufgenommen'
  | 'zugang_erstellt'
  | 'portal_login'
  | 'dna_aktiv'
  | 'dna_freigegeben'
  | 'matching_freigegeben'
  | 'stiftung_gewaehlt'
  | 'gesuch_freigegeben'
  | 'gesuch_final'
  | 'gesuch_eingereicht'
  | 'zusage'
  | 'absage'
  | 'foerderhistorie_erfasst'
  | 'match_rueckmeldung'
  | 'projekt_eroeffnet'
  | 'projekt_messung_gestartet'

export interface MediumEvent {
  medium_id: string
  typ: MediumEventTyp
  titel: string
  detail?: string
  actor?: string
}

const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')

/**
 * Schreibt ein Ereignis, ohne zu werfen. Bewusst KEIN await-Zwang beim
 * Aufrufer: `void schreibeMediumEvent(...)` ist das vorgesehene Muster,
 * die Antwortzeit der eigentlichen Route bleibt unberührt.
 */
export async function schreibeMediumEvent(ev: MediumEvent): Promise<void> {
  const token = process.env.DIRECTUS_TOKEN || ''
  if (!token) return
  try {
    const res = await fetch(`${base()}/items/medium_events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        medium_id: ev.medium_id,
        mandant: tenant.key,
        typ: ev.typ,
        titel: ev.titel,
        detail: ev.detail ?? null,
        actor: ev.actor ?? null,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      console.error(`medium_events: Directus antwortete ${res.status} für ${ev.typ}/${ev.medium_id}`)
    }
  } catch (err) {
    console.error(`medium_events: Schreiben fehlgeschlagen (${ev.typ}/${ev.medium_id})`, err)
  }
}
