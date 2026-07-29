/**
 * /api/portal/projekt-treffer: kuratierte Stiftungs-Treffer EINES Projekts.
 *
 * GET ?projekt_id=<nummer> → 200 { treffer: PortalTreffer[] }
 *   Dieselbe Kuratierung wie die Medium-Treffer (kuratiereTreffer): kein Score,
 *   keine Stiftungs-DNA, Ausschlüsse der Förderhistorie greifen auch hier —
 *   eine Stiftung, die für das Medium nicht in Frage kommt, kommt es für sein
 *   Projekt auch nicht.
 *
 *   Unterschied zur Medium-Route: gefiltert wird auf `projekt_id = <id>` statt
 *   auf `projekt_id: null`, und es gibt KEIN matching_freigeschaltet-Gate.
 *   Projekt-Treffer entstehen erst, wenn das Medium selbst den Mess-/Match-Lauf
 *   angestossen hat — ein zweites Freigabe-Tor davor wäre eine Sperre ohne
 *   Zweck (Entscheid mit dem Auftrag «autonom ermöglichen», 29.07.2026).
 *
 *   → 400 { error }  projekt_id fehlt
 *   → 404 { error }  Projekt gehört nicht zu diesem Medium
 *   → 502 { error }  Directus nicht erreichbar
 *   → 401/503 wie requirePortalSession, 405 sonst
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { requirePortalSession, ladeFoerderhistorie } from '@/lib/portal-guard'
import {
  kuratiereTreffer,
  extrahiereUeberschneidungsTags,
  PORTAL_TREFFER_LIMIT_DEFAULT,
  type PortalTrefferMatch,
  type PortalTrefferStiftung,
} from '@/lib/portal-treffer'
import { bauAusschlussSet, bauHistorieLabels } from '@/lib/foerderhistorie'
import { tenant, MATCH_TIERS, MATCH_MIN_SCORE } from '../../../../config/tenant'

const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const authHeaders = () => ({ Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}` })

async function gehoertZumMedium(projektId: number, mediumSlug: string): Promise<boolean> {
  const res = await fetch(`${base()}/items/projekte/${projektId}?fields=medium_id,mandant`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 404) return false
  if (!res.ok) throw new Error(`projekte/${projektId}: Directus antwortete ${res.status}`)
  const json = (await res.json()) as { data?: { medium_id?: string | null; mandant?: string | null } }
  const row = json.data
  return !!row && (row.medium_id ?? '') === mediumSlug && (row.mandant ?? tenant.key) === tenant.key
}

async function ladeMatches(projektId: number): Promise<PortalTrefferMatch[]> {
  const filter = encodeURIComponent(
    JSON.stringify({
      projekt_id: { _eq: projektId },
      dna_quality_tier: { _in: MATCH_TIERS },
      score: { _gte: MATCH_MIN_SCORE },
    }),
  )
  const res = await fetch(
    `${base()}/items/match_results?filter=${filter}&sort=-score&limit=500&fields=stiftung_id,score,begruendung,score_breakdown`,
    { headers: authHeaders(), signal: AbortSignal.timeout(20_000) },
  )
  if (!res.ok) throw new Error(`match_results: Directus antwortete ${res.status}`)
  const json = (await res.json()) as {
    data?: Array<{ stiftung_id?: unknown; score?: unknown; begruendung?: unknown; score_breakdown?: unknown }>
  }
  return (json.data ?? []).map((row) => ({
    stiftungId: String(row.stiftung_id ?? ''),
    score: Number(row.score ?? 0),
    begruendung: typeof row.begruendung === 'string' ? row.begruendung : null,
    topTags: extrahiereUeberschneidungsTags(row.score_breakdown),
  }))
}

async function ladeStiftungen(ids: string[]): Promise<PortalTrefferStiftung[]> {
  if (ids.length === 0) return []
  const filter = encodeURIComponent(JSON.stringify({ id: { _in: ids } }))
  const res = await fetch(`${base()}/items/stiftungen?filter=${filter}&limit=-1&fields=id,Stiftungsname,webseite,sitz`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`stiftungen: Directus antwortete ${res.status}`)
  const json = (await res.json()) as {
    data?: Array<{ id?: unknown; Stiftungsname?: unknown; webseite?: unknown; sitz?: unknown }>
  }
  return (json.data ?? []).map((row) => ({
    id: String(row.id ?? ''),
    name: typeof row.Stiftungsname === 'string' ? row.Stiftungsname : '',
    sitz: typeof row.sitz === 'string' && row.sitz.trim() ? row.sitz : null,
    website: typeof row.webseite === 'string' && row.webseite.trim() ? row.webseite : null,
  }))
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const session = requirePortalSession(req, res)
  if (!session) return

  res.setHeader('Cache-Control', 'no-store')

  const idRoh = req.query.projekt_id
  const id = typeof idRoh === 'string' ? parseInt(idRoh, 10) : NaN
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'projekt_id (gültige Nummer) erforderlich.' })
  }

  try {
    if (!(await gehoertZumMedium(id, session.mediumSlug))) {
      return res.status(404).json({ error: 'Projekt nicht gefunden.' })
    }

    const [matches, historie] = await Promise.all([ladeMatches(id), ladeFoerderhistorie(session.mediumSlug)])
    const ids = Array.from(new Set(matches.map((m) => m.stiftungId).filter((s) => s)))
    const stiftungen = await ladeStiftungen(ids)

    const treffer = kuratiereTreffer(
      matches,
      stiftungen,
      [], // Projekt-Treffer haben keine eigenen Applications (Gesuche laufen übers Medium)
      PORTAL_TREFFER_LIMIT_DEFAULT,
      bauAusschlussSet(historie),
      bauHistorieLabels(historie),
    )
    return res.status(200).json({ treffer })
  } catch (err: unknown) {
    console.error('portal/projekt-treffer: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}
