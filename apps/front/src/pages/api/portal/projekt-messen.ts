/**
 * /api/portal/projekt-messen: das Medium stösst DNA-Messung UND Matching für
 * eines seiner Projekte an (Wunsch Jolanda 29.07.2026, autonom ohne Operator).
 *
 * Derselbe Lauf wie im Cockpit (/api/projekt-messen → Spark-Adapter →
 * projekt_matcher, ~5–6 Minuten), davor aber eine Zugehörigkeitsprüfung: ein
 * Medium darf nur eigene Projekte messen lassen, nie ein fremdes — der Adapter
 * selbst kennt nur den Slug und würde jeden akzeptieren.
 *
 * POST { projekt_id }
 *   → 200 { status }        Status des Adapters ('gestartet', 'läuft bereits', …)
 *   → 400 { error }         projekt_id fehlt
 *   → 404 { error }         Projekt gehört nicht zu diesem Medium (oder weg)
 *   → 200 { status: 'inactive', note } wenn der Mess-Dienst aus ist — bewusst
 *        200: die Oberfläche zeigt den Grund, das ist kein Client-Fehler
 *   → 401/503 wie requirePortalSession, 405 sonst
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { requirePortalSession } from '@/lib/portal-guard'
import { schreibeMediumEvent } from '@/lib/medium-events'
import { tenant } from '../../../../config/tenant'

const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const authHeaders = () => ({ Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}` })

/** Lädt Slug + Name des Projekts, aber NUR wenn es dem Session-Medium gehört. */
async function ladeEigenesProjekt(id: number, mediumSlug: string): Promise<{ slug: string; name: string } | null> {
  const res = await fetch(`${base()}/items/projekte/${id}?fields=id,slug,name,medium_id,mandant,status`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 404 || res.status === 403) return null
  if (!res.ok) throw new Error(`projekte/${id}: Directus antwortete ${res.status}`)
  const json = (await res.json()) as {
    data?: { slug?: string | null; name?: string | null; medium_id?: string | null; mandant?: string | null; status?: string | null }
  }
  const row = json.data
  if (!row) return null
  if ((row.medium_id ?? '') !== mediumSlug) return null
  if ((row.mandant ?? tenant.key) !== tenant.key) return null
  if (row.status === 'archiviert') return null
  if (!row.slug) return null
  return { slug: row.slug, name: row.name ?? row.slug }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const session = requirePortalSession(req, res)
  if (!session) return

  const idRoh = (req.body as { projekt_id?: unknown } | null)?.projekt_id
  const id = typeof idRoh === 'number' ? idRoh : typeof idRoh === 'string' ? parseInt(idRoh, 10) : NaN
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'projekt_id (gültige Nummer) erforderlich.' })
  }

  let projekt: { slug: string; name: string } | null
  try {
    projekt = await ladeEigenesProjekt(id, session.mediumSlug)
  } catch (err: unknown) {
    console.error('portal/projekt-messen: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
  if (!projekt) {
    return res.status(404).json({ error: 'Projekt nicht gefunden.' })
  }

  const adapter = process.env.HERMES_API_URL
  if (process.env.FAAS_AGENT_ENABLED !== 'true' || !adapter) {
    return res.status(200).json({ status: 'inactive', note: 'Der Mess-Dienst ist gerade nicht aktiv. Wir melden uns.' })
  }

  try {
    const resp = await fetch(`${adapter.replace(/\/$/, '')}/projekt-messen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projekt: projekt.slug }),
      signal: AbortSignal.timeout(20_000),
    })
    const data = (await resp.json()) as { status?: string }

    void schreibeMediumEvent({
      medium_id: session.mediumSlug,
      typ: 'projekt_messung_gestartet',
      titel: `Projekt-Messung gestartet: ${projekt.name}`,
      detail: data.status ?? undefined,
      actor: session.email,
    })

    return res.status(200).json({ status: data.status ?? 'unbekannt' })
  } catch (err) {
    return res.status(200).json({
      status: 'error',
      note: 'Mess-Dienst nicht erreichbar: ' + (err instanceof Error ? err.message : 'unbekannt'),
    })
  }
}
