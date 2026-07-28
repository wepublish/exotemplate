/**
 * POST /api/activate-medium-dna
 *
 * Aktiviert eine bestehende (nicht-aktive) medium_dna-Version.
 * Schritt 1: Alle anderen aktiven Versionen desselben medium_id deaktivieren.
 * Schritt 2: Die übergebene Version auf is_active = true setzen.
 *
 * Body: { id: number }  — die Directus-ID der zu aktivierenden Version
 * Response: { ok: true, aktiv: number }
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { triggerErstMatch } from '@/lib/dna-pipeline'
import { schreibeMediumEvent } from '@/lib/medium-events'

interface ActivateResult {
  ok: true
  aktiv: number
}

interface ActivateError {
  error: string
}

// ─── Directus-Queries und Mutationen ──────────────────────────────────────────

// Lädt die medium_id der zu aktivierenden Version (zur Sicherheit — nie annehmen)
const LOAD_VERSION_QUERY = `
  query LoadVersion($id: ID!) {
    medium_dna_by_id(id: $id) {
      id
      medium_id
      version
      is_active
    }
  }
`

// Alle aktiven Versionen eines Mediums (ausser der neuen)
const AKTIVE_VERSIONEN_QUERY = `
  query AktiveVersionen($mediumId: String!) {
    medium_dna(
      filter: {
        medium_id: { _eq: $mediumId }
        is_active: { _eq: true }
      }
      limit: -1
    ) {
      id
    }
  }
`

const DEACTIVATE_MUTATION = `
  mutation DeactivateDna($id: ID!, $data: update_medium_dna_input!) {
    update_medium_dna_item(id: $id, data: $data) {
      id
      is_active
    }
  }
`

const ACTIVATE_MUTATION = `
  mutation ActivateDna($id: ID!, $data: update_medium_dna_input!) {
    update_medium_dna_item(id: $id, data: $data) {
      id
      is_active
    }
  }
`

// ─── Hilfsfunktion ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DirectusResponse = { data: any; errors?: { message: string }[] }

async function directusFetch(
  base: string,
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<DirectusResponse> {
  const res = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Directus HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json() as Promise<DirectusResponse>
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ActivateResult | ActivateError>
) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Nur POST erlaubt' })
    return
  }

  const { id } = req.body ?? {}
  if (!id || (typeof id !== 'number' && typeof id !== 'string')) {
    res.status(400).json({ error: 'id (number) erforderlich' })
    return
  }

  const numericId = Number(id)
  if (!isFinite(numericId) || numericId <= 0) {
    res.status(400).json({ error: `Ungültige id: ${id}` })
    return
  }

  const directusBase = process.env.DIRECTUS_URL || 'http://localhost:8055'
  const directusToken = process.env.DIRECTUS_TOKEN || ''

  // ── 1. Zu aktivierende Version laden (inklusive medium_id) ───────────────
  interface ZielVersionShape {
    id: number
    medium_id: string
    version: number
    is_active: boolean
  }

  let zielVersion: ZielVersionShape | null = null

  try {
    const r = await directusFetch(directusBase, directusToken, LOAD_VERSION_QUERY, { id: String(numericId) })
    if (r.errors?.length) {
      res.status(502).json({ error: 'Directus-Fehler: ' + r.errors[0]?.message })
      return
    }
    zielVersion = (r.data?.medium_dna_by_id as ZielVersionShape | null) ?? null
  } catch (e: unknown) {
    res.status(502).json({
      error: 'Directus nicht erreichbar: ' + (e instanceof Error ? e.message : String(e)),
    })
    return
  }

  if (!zielVersion) {
    res.status(404).json({ error: `Keine DNA-Version mit id ${numericId} gefunden` })
    return
  }

  if (zielVersion.is_active) {
    // Bereits aktiv — kein Fehler, aber auch kein weiterer Write nötig
    res.status(200).json({ ok: true, aktiv: numericId })
    return
  }

  const mediumId = zielVersion.medium_id

  // ── 2. Alle aktuell aktiven Versionen dieses Mediums laden ───────────────
  let aktivIds: number[] = []

  try {
    const r = await directusFetch(directusBase, directusToken, AKTIVE_VERSIONEN_QUERY, { mediumId })
    if (r.errors?.length) {
      res.status(502).json({ error: 'Directus-Fehler (aktive Versionen): ' + r.errors[0]?.message })
      return
    }
    const arr = (r.data?.medium_dna as { id: number }[]) ?? []
    aktivIds = arr.map(x => Number(x.id)).filter(x => isFinite(x) && x !== numericId)
  } catch (e: unknown) {
    res.status(502).json({
      error: 'Directus nicht erreichbar (aktive Versionen): ' + (e instanceof Error ? e.message : String(e)),
    })
    return
  }

  // ── 3. Alle alten aktiven Versionen deaktivieren ──────────────────────────
  for (const oldId of aktivIds) {
    try {
      const r = await directusFetch(directusBase, directusToken, DEACTIVATE_MUTATION, {
        id: String(oldId),
        data: { is_active: false },
      })
      if (r.errors?.length) {
        res.status(502).json({
          error: `Deaktivierung von Version ${oldId} fehlgeschlagen: ` + r.errors[0]?.message,
        })
        return
      }
    } catch (e: unknown) {
      res.status(502).json({
        error: `Directus-Write (deaktivieren ${oldId}) fehlgeschlagen: ` + (e instanceof Error ? e.message : String(e)),
      })
      return
    }
  }

  // ── 4. Neue Version aktivieren ────────────────────────────────────────────
  try {
    const r = await directusFetch(directusBase, directusToken, ACTIVATE_MUTATION, {
      id: String(numericId),
      data: { is_active: true },
    })
    if (r.errors?.length) {
      res.status(502).json({
        error: `Aktivierung von Version ${numericId} fehlgeschlagen: ` + r.errors[0]?.message,
      })
      return
    }
  } catch (e: unknown) {
    res.status(502).json({
      error: 'Directus-Write (aktivieren) fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)),
    })
    return
  }

  // Roadmap-Ereignis (fire-and-forget): eine manuell aktivierte Version zählt
  // genauso als «DNA aktiv» wie die Ein-Knopf-Pipeline.
  void schreibeMediumEvent({
    medium_id: mediumId,
    typ: 'dna_aktiv',
    titel: `Fundraising-DNA aktiv (Version ${zielVersion.version})`,
  })

  // Erst-Match sofort anstossen, statt auf den 6h-Cron zu warten (best effort)
  await triggerErstMatch(mediumId)

  res.status(200).json({ ok: true, aktiv: numericId })
}
