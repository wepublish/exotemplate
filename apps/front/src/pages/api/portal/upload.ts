/**
 * /api/portal/upload: Datei-Upload für das Medien-Selbstservice-Portal (Task 6).
 *
 * Identischer Verarbeitungs-Kern wie /api/medium-knowledge/upload
 * (verarbeiteUpload, dort extrahiert): der einzige Unterschied ist, dass
 * `medium_id` NIE vom Client kommt, sondern ausschliesslich aus der
 * Portal-Session (`session.mediumSlug`). Ein evtl. mitgeschicktes
 * medium_id-Feld wird ignoriert.
 *
 * POST multipart/form-data:
 *   - file: Datei (required)
 *   - category: string (optional, Default general_info)
 *   - title: string (optional, Default Dateiname)
 *
 *   → 200 { id, category, title, chars }
 *   → 400 { error }  bei fehlendem file-Feld oder Parse-Fehler
 *   → 401 { error }  ohne gültige Portal-Session
 *   → 502 { error }  bei Upload-/Extraktions-/Directus-Fehler
 *   → 503 { error }  wenn PORTAL_SESSION_SECRET fehlt
 *   → 405            bei falscher Methode
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { IncomingForm, Files, Fields } from 'formidable'
import { requirePortalSession } from '@/lib/portal-guard'
import { verarbeiteUpload } from '@/pages/api/medium-knowledge/upload'

export const config = {
  api: {
    bodyParser: false,
  },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const session = requirePortalSession(req, res)
  if (!session) return

  let fields: Fields
  let files: Files
  try {
    const form = new IncomingForm({
      maxFileSize: 50 * 1024 * 1024, // 50 MB
      keepExtensions: true,
    })
    const result = await form.parse(req)
    fields = result[0]
    files = result[1]
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return res.status(400).json({ error: `Datei konnte nicht geparst werden: ${msg}` })
  }

  const fileEntries = files.file
  const fileEntry = Array.isArray(fileEntries) ? fileEntries[0] : fileEntries
  if (!fileEntry) {
    return res.status(400).json({ error: 'Kein file-Feld in der Anfrage' })
  }

  const rawTitle = Array.isArray(fields.title) ? fields.title[0] : fields.title
  const rawCategory = Array.isArray(fields.category) ? fields.category[0] : fields.category

  try {
    const result = await verarbeiteUpload(session.mediumSlug, fileEntry, {
      title: typeof rawTitle === 'string' ? rawTitle : undefined,
      category: typeof rawCategory === 'string' ? rawCategory : undefined,
    })
    return res.status(200).json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('portal/upload: Verarbeitung fehlgeschlagen', err)
    return res.status(502).json({ error: `Verarbeitung fehlgeschlagen: ${msg}` })
  }
}
