/**
 * /api/portal/textvorlage: Brief-/Dokumentvorlage des Mediums hoch- und
 * wieder herunterladen (Wunsch Ramona 29.07.2026: «neben Logo auch Option
 * Textvorlage hochladen»).
 *
 * Bewusst KEIN medium_knowledge-Eintrag, sondern zwei Felder auf faas_medien
 * (`textvorlage_url`, `textvorlage_name`) — genau wie das Logo: eine
 * Briefvorlage ist ein Gestaltungs-Asset des Mediums, kein Wissen über seine
 * publizistische DNA. Im Korpus würde sie den Verdichtungs-Prompt mit
 * Formularfloskeln verwässern.
 *
 * GET → 200 { url, name }  Directus-Datei-id + Originalname, beide null ohne Vorlage
 *
 * POST multipart/form-data mit `file` (DOCX, DOC, ODT, PDF, RTF, TXT, MD, max 10 MB)
 *   → 200 { url, name }
 *   → 400 { error }  kein file-Feld, Parse-Fehler (u. a. zu gross)
 *   → 422 { error }  Endung nicht erlaubt
 *   → 502 { error }  Upload-/Directus-Fehler
 *
 * DELETE → 200 { status: 'ok' }  Verweis entfernen (die Datei selbst bleibt in
 *   Directus liegen, wie beim Logo-Ersatz: kein Löschen von Dateien aus einer
 *   Portal-Route, damit ein versehentlicher Klick nichts unwiederbringlich macht)
 *
 * 401/503 wie requirePortalSession, 405 sonst. `medium_id` kommt immer aus der
 * Session, nie vom Client.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs'
import { IncomingForm, type Files } from 'formidable'
import { requirePortalSession } from '@/lib/portal-guard'
import { istErlaubteVorlage, TEXTVORLAGE_MAX_BYTES } from '@/lib/portal-textvorlage'

export const config = { api: { bodyParser: false } }

const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const authHeaders = () => ({ Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}` })

async function ladeStand(slug: string): Promise<{ url: string | null; name: string | null }> {
  const filter = encodeURIComponent(JSON.stringify({ slug: { _eq: slug } }))
  const res = await fetch(`${base()}/items/faas_medien?filter=${filter}&limit=1&fields=textvorlage_url,textvorlage_name`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`faas_medien: Directus antwortete ${res.status}`)
  const json = (await res.json()) as { data?: Array<{ textvorlage_url?: string | null; textvorlage_name?: string | null }> }
  const row = json.data?.[0]
  return { url: row?.textvorlage_url ?? null, name: row?.textvorlage_name ?? null }
}

/** Bulk-PATCH mit Filter im Body, wie setzeLogoUrl in logo.ts. */
async function setzeStand(slug: string, url: string | null, name: string | null): Promise<void> {
  const res = await fetch(`${base()}/items/faas_medien`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: { filter: { slug: { _eq: slug } } },
      data: { textvorlage_url: url, textvorlage_name: name },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Textvorlage setzen fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`)
  }
}

async function uploadZuDirectus(buffer: Buffer, dateiname: string): Promise<string> {
  const form = new FormData()
  // Bewusst octet-stream: die Endungsprüfung (istErlaubteVorlage) ist
  // maßgeblich, ein Client-Mimetype wird nicht weitergereicht.
  form.append('file', new Blob([new Uint8Array(buffer)], { type: 'application/octet-stream' }), dateiname)
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = requirePortalSession(req, res)
  if (!session) return

  res.setHeader('Cache-Control', 'no-store')

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await ladeStand(session.mediumSlug))
    }

    if (req.method === 'DELETE') {
      await setzeStand(session.mediumSlug, null, null)
      return res.status(200).json({ status: 'ok' })
    }

    if (req.method === 'POST') {
      let files: Files
      try {
        const form = new IncomingForm({ maxFileSize: TEXTVORLAGE_MAX_BYTES, keepExtensions: true })
        ;[, files] = await form.parse(req)
      } catch (err: unknown) {
        return res.status(400).json({ error: `Datei konnte nicht gelesen werden: ${err instanceof Error ? err.message : 'unbekannt'}` })
      }

      const roh = files.file
      const datei = Array.isArray(roh) ? roh[0] : roh
      if (!datei) return res.status(400).json({ error: 'Feld «file» erforderlich.' })

      const name = (datei.originalFilename ?? 'vorlage').trim()
      if (!istErlaubteVorlage(name)) {
        return res.status(422).json({ error: 'Erlaubt sind Word, ODT, PDF, RTF, Text oder Markdown.' })
      }

      const buffer = await fs.promises.readFile(datei.filepath)
      const fileId = await uploadZuDirectus(buffer, name)
      await setzeStand(session.mediumSlug, fileId, name)
      return res.status(200).json({ url: fileId, name })
    }
  } catch (err: unknown) {
    console.error('portal/textvorlage: Fehler', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }

  res.setHeader('Allow', 'GET, POST, DELETE')
  return res.status(405).json({ error: 'Method Not Allowed' })
}
