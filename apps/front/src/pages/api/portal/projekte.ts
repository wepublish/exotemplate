/**
 * /api/portal/projekte: das Medium eröffnet und verwaltet eigene Projekte
 * (Wunsch Jolanda 29.07.2026: Projekte anlegen, DNA messen, matchen — autonom).
 *
 * Ein Projekt ist ein eigener Antragsgegenstand mit eigener DNA und eigenen
 * Treffern (match_results mit gesetzter projekt_id). Fachlich derselbe Weg wie
 * im Operator-Cockpit, nur dass `medium_id` ausschliesslich aus der
 * Portal-Session kommt.
 *
 * GET → 200 { projekte: ProjektZeile[] }  mit DNA-Stand und Trefferzahl
 * POST { name, beschreibung }
 *   → 200 { id, slug }   Projekt angelegt (Status 'aktiv'), Slug aus Medium +
 *        Name, bei Kollision hochgezählt
 *   → 422 { error }      Eingabe zu dünn (parseProjektEingabe)
 * DELETE ?id=<nummer>
 *   → 200 { status: 'ok' }  Projekt auf Status 'archiviert' (Soft-Delete: die
 *        gemessene DNA und die Treffer bleiben nachvollziehbar)
 *   → 404 { error }      Projekt existiert nicht oder gehört einem anderen Medium
 *
 * 401/503 wie requirePortalSession, 502 bei Directus-Fehlern, 405 sonst.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { requirePortalSession } from '@/lib/portal-guard'
import {
  parseProjektEingabe,
  baueProjektSlug,
  eindeutigerSlug,
  type ProjektZeile,
} from '@/lib/portal-projekte'
import { schreibeMediumEvent } from '@/lib/medium-events'
import { tenant } from '../../../../config/tenant'

const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const authHeaders = () => ({ Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}` })
const schreibHeaders = () => ({ ...authHeaders(), 'Content-Type': 'application/json' })

type RohProjekt = {
  id: number
  name?: string | null
  slug?: string | null
  beschreibung?: string | null
  directus_aktive_dna_version_id?: string | null
}

async function ladeProjekte(mediumSlug: string): Promise<RohProjekt[]> {
  const filter = encodeURIComponent(
    JSON.stringify({ medium_id: { _eq: mediumSlug }, mandant: { _eq: tenant.key }, status: { _neq: 'archiviert' } }),
  )
  const felder = 'id,name,slug,beschreibung,directus_aktive_dna_version_id'
  const res = await fetch(`${base()}/items/projekte?filter=${filter}&limit=-1&sort=-ts&fields=${felder}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`projekte: Directus antwortete ${res.status}`)
  const json = (await res.json()) as { data?: RohProjekt[] }
  return json.data ?? []
}

/**
 * Trefferzahl je Projekt in EINEM Aufruf: alle match_results-Zeilen des
 * Mediums mit gesetzter projekt_id holen und im Code zählen. Ein
 * groupBy-Aggregat wäre knapper, aber Directus liefert es je Filter-Kombination
 * unterschiedlich — die Liste ist pro Medium klein (wenige hundert Zeilen).
 */
async function ladeTrefferZahlen(mediumSlug: string): Promise<Map<string, number>> {
  const zahlen = new Map<string, number>()
  const filter = encodeURIComponent(JSON.stringify({ medium_id: { _eq: mediumSlug }, projekt_id: { _nnull: true } }))
  const res = await fetch(`${base()}/items/match_results?filter=${filter}&limit=-1&fields=projekt_id`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) return zahlen
  const json = (await res.json()) as { data?: Array<{ projekt_id?: unknown }> }
  for (const row of json.data ?? []) {
    if (row.projekt_id == null) continue
    const key = String(row.projekt_id)
    zahlen.set(key, (zahlen.get(key) ?? 0) + 1)
  }
  return zahlen
}

async function handleGet(res: NextApiResponse, mediumSlug: string) {
  res.setHeader('Cache-Control', 'no-store')
  const [roh, trefferZahlen] = await Promise.all([ladeProjekte(mediumSlug), ladeTrefferZahlen(mediumSlug)])
  const projekte: ProjektZeile[] = roh.map((p) => ({
    id: Number(p.id),
    name: p.name ?? '',
    slug: p.slug ?? '',
    beschreibung: p.beschreibung ?? '',
    hatDna: !!p.directus_aktive_dna_version_id,
    treffer: trefferZahlen.get(String(p.id)) ?? 0,
  }))
  return res.status(200).json({ projekte })
}

async function handlePost(req: NextApiRequest, res: NextApiResponse, mediumSlug: string, email: string) {
  const geprueft = parseProjektEingabe(req.body)
  if (!geprueft.ok) {
    return res.status(422).json({ error: geprueft.fehler })
  }

  const bestehende = await ladeProjekte(mediumSlug)
  const slug = eindeutigerSlug(
    baueProjektSlug(mediumSlug, geprueft.eingabe.name),
    bestehende.map((p) => p.slug ?? ''),
  )

  const anlage = await fetch(`${base()}/items/projekte`, {
    method: 'POST',
    headers: schreibHeaders(),
    body: JSON.stringify({
      name: geprueft.eingabe.name,
      slug,
      medium_id: mediumSlug,
      mandant: tenant.key,
      status: 'aktiv',
      beschreibung: geprueft.eingabe.beschreibung,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!anlage.ok) {
    const text = await anlage.text().catch(() => '')
    throw new Error(`Projekt anlegen fehlgeschlagen (${anlage.status}): ${text.slice(0, 200)}`)
  }
  const json = (await anlage.json()) as { data?: { id?: number } }

  void schreibeMediumEvent({
    medium_id: mediumSlug,
    typ: 'projekt_eroeffnet',
    titel: `Projekt eröffnet: ${geprueft.eingabe.name}`,
    actor: email,
  })

  return res.status(200).json({ id: json.data?.id ?? null, slug })
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse, mediumSlug: string) {
  const idRoh = req.query.id
  const id = typeof idRoh === 'string' ? parseInt(idRoh, 10) : NaN
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'id (gültige Nummer) erforderlich.' })
  }

  const eigene = await ladeProjekte(mediumSlug)
  if (!eigene.some((p) => Number(p.id) === id)) {
    return res.status(404).json({ error: 'Projekt nicht gefunden.' })
  }

  const patch = await fetch(`${base()}/items/projekte/${id}`, {
    method: 'PATCH',
    headers: schreibHeaders(),
    body: JSON.stringify({ status: 'archiviert' }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!patch.ok) throw new Error(`Projekt archivieren fehlgeschlagen (${patch.status})`)
  return res.status(200).json({ status: 'ok' })
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = requirePortalSession(req, res)
  if (!session) return

  try {
    if (req.method === 'GET') return await handleGet(res, session.mediumSlug)
    if (req.method === 'POST') return await handlePost(req, res, session.mediumSlug, session.email)
    if (req.method === 'DELETE') return await handleDelete(req, res, session.mediumSlug)
  } catch (err: unknown) {
    console.error('portal/projekte: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }

  res.setHeader('Allow', 'GET, POST, DELETE')
  return res.status(405).json({ error: 'Method Not Allowed' })
}
