/**
 * /api/portal/unterlage: das Medium bearbeitet oder entfernt EINE eigene
 * Unterlage (Wunsch Ramona 29.07.2026: «Dokumente im Nachhinein bearbeiten
 * (Titel ändern, Dokumente löschen)» und «Möglichkeit, die Dokumente zu taggen»).
 *
 * PATCH { id, title?, category? }
 *   → 200 { status: 'ok' }
 *   → 400 { error }  id fehlt, oder weder title noch category dabei, oder
 *        category ist keine der bekannten Kategorien (PORTAL_KATEGORIEN)
 *   → 404 { error }  Eintrag existiert nicht ODER gehört einem anderen Medium
 *
 * DELETE ?id=<nummer>
 *   → 200 { status: 'ok' }
 *   → 400 / 404 wie oben
 *
 * Gemeinsam: 401/503 wie requirePortalSession, 502 bei Directus-Fehlern, 405
 * sonst. Die Zugehörigkeit wird IMMER serverseitig geprüft
 * (ladeWissensEintragFuerPortal): ein Medium darf nie eine fremde Unterlage
 * anfassen, auch nicht mit geratener id. Automatisch eingelesene Einträge
 * (auto_scraped, von We.Publish) sind schreibgeschützt — sie entstehen bei
 * jedem DNA-Lauf neu, ein Löschen wäre folgenlos und verwirrend.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import {
  requirePortalSession,
  ladeWissensEintragFuerPortal,
  patcheWissensEintrag,
  loescheWissensEintrag,
} from '@/lib/portal-guard'
import { istPortalKategorie, TITEL_MAX_ZEICHEN } from '@/lib/portal-unterlagen'

function leseId(roh: unknown): number | null {
  const str = typeof roh === 'string' ? roh.trim() : typeof roh === 'number' ? String(roh) : ''
  if (!str) return null
  const n = parseInt(str, 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = requirePortalSession(req, res)
  if (!session) return

  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'PATCH' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'PATCH, DELETE')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const id = leseId(req.method === 'PATCH' ? (req.body as { id?: unknown } | null)?.id : req.query.id)
  if (id === null) {
    return res.status(400).json({ error: 'id (gültige Nummer) erforderlich.' })
  }

  try {
    const eintrag = await ladeWissensEintragFuerPortal(id, session.mediumSlug)
    if (!eintrag) {
      return res.status(404).json({ error: 'Unterlage nicht gefunden.' })
    }
    if (eintrag.autoScraped) {
      return res.status(400).json({ error: 'Automatisch eingelesene Einträge können nicht bearbeitet werden.' })
    }

    if (req.method === 'DELETE') {
      await loescheWissensEintrag(id)
      return res.status(200).json({ status: 'ok' })
    }

    const body = (req.body ?? {}) as Record<string, unknown>
    const patch: Record<string, unknown> = {}

    if (typeof body.title === 'string') {
      const titel = body.title.trim().slice(0, TITEL_MAX_ZEICHEN)
      if (!titel) return res.status(400).json({ error: 'title darf nicht leer sein.' })
      patch.title = titel
    }
    if (typeof body.category === 'string') {
      if (!istPortalKategorie(body.category)) {
        return res.status(400).json({ error: 'category ist keine bekannte Kategorie.' })
      }
      patch.category = body.category
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'title oder category erforderlich.' })
    }

    await patcheWissensEintrag(id, patch)
    return res.status(200).json({ status: 'ok' })
  } catch (err: unknown) {
    console.error('portal/unterlage: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}
