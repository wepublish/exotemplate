/**
 * /api/medium-logo-setzen: Operator lädt ein Logo für ein Medium hoch bzw.
 * wechselt es aus (Wunsch Jolanda 29.07.2026: «bei zwölf ist ein falsches Logo
 * gespeichert, das müsste ich noch auswechseln können»).
 *
 * Bisher konnte nur das Medium selbst ein Logo hochladen (/api/portal/logo);
 * im Cockpit gab es keinen Weg. `/api/medium-logo` ist etwas anderes: es holt
 * automatisch ein Favicon und liefert Bytes aus.
 *
 * Operator-only, bewusst NICHT unter /api/portal/* (Cloudflare-Access-Präfix).
 *
 * POST multipart/form-data:
 *   - medium_slug: string (required)
 *   - file: PNG oder JPG (required, max 5 MB, Magic Bytes massgeblich)
 *   → 200 { logoUrl }
 *   → 400 / 422 / 502 wie /api/portal/logo
 *   → 403 { error }  Portal-Session ohne Access-Header
 *   → 405
 *
 * Setzt wie der Portal-Weg BEIDE Felder (`logo_url` + `logo_hochgeladen`), damit
 * das automatische Favicon-Nachladen (medium-logo.ts) das Logo nicht später
 * überschreibt und das Logo-Gate im Portal erfüllt ist.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs'
import { IncomingForm, type Fields, type Files } from 'formidable'
import { istPortalZugriffAufProxy } from '@/lib/portal-guard'
import { erkenneLogoTyp } from '@/lib/portal-logo'

export const config = { api: { bodyParser: false } }

const MAX_BYTES = 5 * 1024 * 1024
const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const authHeaders = () => ({ Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}` })

async function uploadZuDirectus(buffer: Buffer, dateiname: string, contentType: string): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), dateiname)
  const res = await fetch(`${base()}/files`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Directus-Files-Upload fehlgeschlagen (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as { data?: { id?: string } }
  const fileId = json?.data?.id
  if (!fileId) throw new Error('Directus-Files: Kein id in der Antwort')
  return fileId
}

async function setzeLogo(slug: string, fileId: string): Promise<void> {
  const res = await fetch(`${base()}/items/faas_medien`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: { filter: { slug: { _eq: slug } } },
      data: { logo_url: fileId, logo_hochgeladen: true },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Logo setzen fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`)
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const cfEmailHeader = req.headers['cf-access-authenticated-user-email'] as string | undefined
  if (istPortalZugriffAufProxy(req.headers.cookie, cfEmailHeader, process.env.PORTAL_SESSION_SECRET)) {
    return res.status(403).json({ error: 'Operator-Route, kein Portal-Zugriff.' })
  }

  let fields: Fields
  let files: Files
  try {
    const form = new IncomingForm({ maxFileSize: MAX_BYTES, keepExtensions: true })
    ;[fields, files] = await form.parse(req)
  } catch (err: unknown) {
    return res.status(400).json({ error: `Datei konnte nicht gelesen werden: ${err instanceof Error ? err.message : 'unbekannt'}` })
  }

  const slugRoh = fields.medium_slug
  const slug = (Array.isArray(slugRoh) ? slugRoh[0] : slugRoh)?.trim() ?? ''
  if (!slug) return res.status(400).json({ error: 'medium_slug erforderlich.' })

  const roh = files.file
  const datei = Array.isArray(roh) ? roh[0] : roh
  if (!datei) return res.status(400).json({ error: 'Feld «file» erforderlich.' })

  try {
    const buffer = await fs.promises.readFile(datei.filepath)
    // Magic Bytes entscheiden, nicht der Client-Mimetype (wie /api/portal/logo):
    // der Word-Export kann nur echte PNG/JPG einbetten.
    const typ = erkenneLogoTyp(buffer)
    if (!typ) {
      return res.status(422).json({ error: 'Nur PNG oder JPG (die Datei ist keins von beidem).' })
    }
    const contentType = typ === 'png' ? 'image/png' : 'image/jpeg'
    const dateiname = (datei.originalFilename ?? `logo_${slug}.${typ}`).trim()
    const fileId = await uploadZuDirectus(buffer, dateiname, contentType)
    await setzeLogo(slug, fileId)
    return res.status(200).json({ logoUrl: fileId })
  } catch (err: unknown) {
    console.error('medium-logo-setzen: Fehler', err)
    return res.status(502).json({ error: 'Logo konnte nicht gespeichert werden' })
  }
}
