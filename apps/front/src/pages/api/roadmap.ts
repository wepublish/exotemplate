/**
 * /api/roadmap — liefert die berechnete 8-Stationen-Roadmap eines Mediums.
 *
 * GET ?medium=<slug>
 *   → 200 {
 *       medium,
 *       stationen: BerechneteStation[],
 *       antraege: { id, status, stiftung_name, stiftung_id, drive_link }[],
 *         (NUR Anträge mit gesetztem drive_link = Gesuch erstellt + im Drive-Dossier)
 *       slack: { channel, canvas_id },
 *     }
 *   → 400 { error } bei fehlendem medium
 *
 * Liest die gespeicherte faas_roadmap-Zeile (stationen + Slack-Refs) sowie die
 * Live-Signale (aktive medium_dna, Match-Zahl, Antraege) und leitet die Status
 * mit berechneStationen ab. Fehlt die Roadmap-Zeile, werden die Stationen aus
 * einem leeren gespeichert-Array berechnet (alle Felder null).
 *
 * Mandant = tenant.key. Deterministisch, nur lesend.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import {
  berechneStationen,
  nurErstellteAntraege,
  type GespeicherteStation,
  type RoadmapSignale,
} from '@/lib/roadmap'
import { tenant, MATCH_TIERS, MATCH_MIN_SCORE } from '../../../config/tenant'

// Ein gebuendelter Query holt alles in einem Request.
const QUERY = `
  query RoadmapKontext($medium: String!, $mandant: String!) {
    faas_roadmap(
      filter: { medium_id: { _eq: $medium }, mandant: { _eq: $mandant } }
      limit: 1
    ) {
      id
      stationen
      slack_channel
      canvas_id
    }
    medium_dna_aggregated(
      filter: { medium_id: { _eq: $medium }, is_active: { _eq: true } }
    ) {
      count { id }
    }
    match_results_aggregated(
      filter: {
        medium_id: { _eq: $medium }
        projekt_id: { _null: true }
        dna_quality_tier: { _in: ${JSON.stringify(MATCH_TIERS)} }
        score: { _gte: ${MATCH_MIN_SCORE} }
      }
    ) {
      count { id }
    }
    applications(
      filter: { medium_id: { _eq: $medium }, mandant: { _eq: $mandant } }
      limit: -1
      sort: ["-date_updated"]
    ) {
      id
      status
      stiftung_name
      stiftung_id
      drive_link
    }
  }
`

/** Normalisiert die gespeicherten Stationen aus dem json-Feld. */
function parseGespeichert(roh: unknown): GespeicherteStation[] {
  if (!Array.isArray(roh)) return []
  return roh
    .map((r) => {
      if (!r || typeof r !== 'object') return null
      const o = r as Record<string, unknown>
      if (typeof o.nr !== 'number') return null
      return {
        nr: o.nr,
        freigegeben: typeof o.freigegeben === 'boolean' ? o.freigegeben : null,
        dokument_link: typeof o.dokument_link === 'string' ? o.dokument_link : null,
        notiz: typeof o.notiz === 'string' ? o.notiz : null,
      } as GespeicherteStation
    })
    .filter((s): s is GespeicherteStation => s !== null)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }
  const medium = typeof req.query.medium === 'string' ? req.query.medium : ''
  if (!medium) {
    return res.status(400).json({ error: 'medium erforderlich' })
  }

  const directusBase = process.env.DIRECTUS_URL || 'http://localhost:8055'
  const directusToken = process.env.DIRECTUS_TOKEN || ''

  try {
    const r = await fetch(`${directusBase}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${directusToken}` },
      body: JSON.stringify({ query: QUERY, variables: { medium, mandant: tenant.key } }),
      signal: AbortSignal.timeout(20_000),
    })
    const json = await r.json()
    if (json.errors?.length) {
      return res.status(500).json({ error: 'Directus-Fehler: ' + json.errors[0]?.message })
    }
    const d = json.data ?? {}

    const row = d.faas_roadmap?.[0] ?? null
    const gespeichert = parseGespeichert(row?.stationen)

    const hatAktiveDna = Number(d.medium_dna_aggregated?.[0]?.count?.id ?? 0) > 0
    const anzahlMatches = Number(d.match_results_aggregated?.[0]?.count?.id ?? 0)
    const alleApplications: Array<{
      id: string
      status: string
      stiftung_name: string | null
      stiftung_id: string | null
      drive_link: string | null
    }> = (d.applications ?? []).map(
      (a: {
        id: string
        status?: string
        stiftung_name?: string | null
        stiftung_id?: string | null
        drive_link?: string | null
      }) => ({
        id: a.id,
        status: a.status ?? '',
        stiftung_name: a.stiftung_name ?? null,
        stiftung_id: a.stiftung_id ?? null,
        drive_link: a.drive_link ?? null,
      }),
    )

    // Nur Anträge, deren Gesuch wirklich erstellt + im Drive-Dossier abgelegt ist
    // (drive_link gesetzt). Diese gefilterte Menge speist BEIDES: die angezeigte
    // Liste UND die abgeleiteten Stationen-Status (z.B. St6 «Gesuchsentwürfe»
    // erst erledigt, wenn ein Gesuch real existiert).
    const antraege = nurErstellteAntraege(alleApplications)

    const signale: RoadmapSignale = {
      hatAktiveDna,
      anzahlMatches,
      antraege: antraege.map((a) => ({ status: a.status })),
    }

    return res.status(200).json({
      medium,
      stationen: berechneStationen(gespeichert, signale),
      antraege,
      slack: {
        channel: row?.slack_channel ?? null,
        canvas_id: row?.canvas_id ?? null,
      },
    })
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
}
