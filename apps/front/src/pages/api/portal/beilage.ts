/**
 * /api/portal/beilage: liefert eine Gesuch-Beilage des Session-Mediums aus (Task 10).
 *
 * GET ?app=<application_id>&file=<fileId>
 *   → 200  Datei-Stream (Content-Disposition: attachment; filename=<name>)
 *   → 400 { error }  app oder file (Query-Parameter) fehlt
 *   → 403 { error }  fileId gehört nicht zu den Beilagen dieser Application
 *   → 404 { error }  Application nicht gefunden/gehört nicht diesem Medium,
 *        ODER Directus liefert für das Asset selbst 404 (z. B. gelöscht)
 *   → 409 { error }  Gesuch ist (noch) nicht freigegeben: Status ist nicht
 *        mindestens 'bereit'. Dasselbe Freigabe-Gate wie gesuch-export.ts
 *        (GESUCH_STATUS_AB_BEREIT): Beilagen dürfen ebenso wenig wie der
 *        Gesuchtext vor der Operator-Freigabe abrufbar sein.
 *   → 502 { error }  Directus/Netz-Fehler beim Laden des Assets
 *   → 401 { error } / 503 { error }  wie requirePortalSession
 *   → 405            bei anderer Methode
 *
 * Das Medium kommt ausschliesslich aus der Portal-Session
 * (`session.mediumSlug`), nie aus Query oder Body; `ladeApplicationFuerPortal`
 * verweigert (liefert null → 404) jede Application, die einem anderen Medium
 * gehört. Zusätzlich muss `file` unter `portal.beilagen` dieser konkreten
 * Application stehen (403 sonst), ein Medium kann so keine fremde
 * Directus-file_id erraten und sich eine andere Beilage herunterladen.
 *
 * Buffert das Asset vollständig (kein Streaming-Pipe): Beilagen sind
 * Gesuchsdokumente, keine grossen Medien-Dateien, und dieselbe
 * Buffer-Strategie nutzt bereits medium-logo.ts für Directus-Assets.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { requirePortalSession, ladeApplicationFuerPortal } from '@/lib/portal-guard'
import { gesuchPortalStatus, GESUCH_STATUS_AB_BEREIT } from '@/lib/portal-status'

const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const authHeaders = () => ({ Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}` })

/** Entfernt Zeichen, die einen Content-Disposition-Header brechen oder injizieren könnten. */
function saeubereDateiname(name: string): string {
  return name.replace(/["\r\n]/g, '').trim()
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const session = requirePortalSession(req, res)
  if (!session) return

  const appId = typeof req.query.app === 'string' ? req.query.app.trim() : ''
  const fileId = typeof req.query.file === 'string' ? req.query.file.trim() : ''
  if (!appId || !fileId) {
    return res.status(400).json({ error: 'app und file (Query-Parameter) erforderlich.' })
  }

  try {
    const app = await ladeApplicationFuerPortal(appId, session.mediumSlug)
    if (!app) {
      return res.status(404).json({ error: 'Antrag nicht gefunden.' })
    }

    const status = gesuchPortalStatus({ status: app.status, portal: app.portal })
    if (!GESUCH_STATUS_AB_BEREIT.has(status)) {
      return res.status(409).json({ error: 'Der Gesuchstext ist noch nicht verfügbar.' })
    }

    const beilage = (app.portal.beilagen ?? []).find((b) => b.fileId === fileId)
    if (!beilage) {
      return res.status(403).json({ error: 'Diese Datei gehört nicht zu diesem Antrag.' })
    }

    const assetRes = await fetch(`${base()}/assets/${encodeURIComponent(fileId)}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(20_000),
    })
    if (!assetRes.ok) {
      return res.status(assetRes.status === 404 ? 404 : 502).json({ error: 'Datei momentan nicht verfügbar.' })
    }

    const buffer = Buffer.from(await assetRes.arrayBuffer())
    const contentType = assetRes.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream'
    const dateiname = saeubereDateiname(beilage.name || fileId)

    res
      .status(200)
      .setHeader('Content-Type', contentType)
      .setHeader('Content-Disposition', `attachment; filename="${dateiname}"`)
      .setHeader('Content-Length', String(buffer.length))
      .send(buffer)
  } catch (err: unknown) {
    console.error('portal/beilage GET: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}
