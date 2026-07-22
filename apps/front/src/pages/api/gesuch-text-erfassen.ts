/**
 * /api/gesuch-text-erfassen: Operator erfasst den Gesuchtext (+ optionale
 * Beilage) für einen vom Medium angeforderten Cowork-Auftrag (Task 11).
 *
 * POST multipart/form-data ODER application/json: { id, text? } + optionale
 * Datei (multipart-Feld `file`).
 *   → 200 { status: 'ok' }
 *   → 400 { error }  id fehlt, oder weder text noch Datei mitgeschickt, oder
 *        die Anfrage konnte nicht gelesen werden
 *   → 404 { error }  Application nicht gefunden
 *   → 502 { error }  Directus nicht erreichbar
 *   → 403 { error }  bei Portal-Session ohne Cloudflare-Access (Operator-only,
 *        istPortalZugriffAufProxy: Defense-in-depth)
 *   → 405            bei anderer Methode als POST
 *
 * Read-modify-write des `portal`-json (bestehende Felder wie angefordert_am,
 * angefordert_von, freigegeben_am bleiben erhalten): `text` (falls
 * mitgeschickt) landet in `portal.gesuch_text` + eine neue Version
 * `{ts, von: 'wepublish'}` in `portal.gesuch_versionen` (siehe
 * fuegeGesuchVersionHinzu, portal-status.ts: älteste Version kippt ab
 * GESUCH_VERSIONEN_MAX). Eine mitgeschickte Datei wird zu Directus-Files
 * hochgeladen und als `{fileId, name}` an `portal.beilagen` angehängt.
 *
 * `bodyParser` ist deaktiviert (Multipart-Support nötig): bei
 * application/json wird der Rohkörper selbst gelesen und geparst
 * (leseJsonBody), bei multipart/form-data übernimmt formidable.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { IncomingForm, Files, Fields } from 'formidable'
import fs from 'fs'
import { istPortalZugriffAufProxy } from '@/lib/portal-guard'
import { parsePortal, fuegeGesuchVersionHinzu, type GesuchVersion } from '@/lib/portal-status'

export const config = {
  api: {
    bodyParser: false,
  },
}

const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const authHeaders = () => ({ Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}` })
const schreibHeaders = () => ({ ...authHeaders(), 'Content-Type': 'application/json' })

type RohApplication = { id: string | number; portal?: unknown }

async function ladeApplication(id: string): Promise<RohApplication | null> {
  const res = await fetch(`${base()}/items/applications/${encodeURIComponent(id)}?fields=id,portal`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`applications/${id}: Directus antwortete ${res.status}`)
  const json = (await res.json()) as { data?: RohApplication | null }
  return json.data ?? null
}

async function patchApplication(id: string, data: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${base()}/items/applications/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: schreibHeaders(),
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Application aktualisieren fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`)
  }
}

/**
 * Lädt eine bereits per formidable geparste Datei zu Directus-Files hoch
 * (schlanker Ausschnitt aus uploadZuDirectusFiles, medium-knowledge/upload.ts:
 * hier ohne Text-Extraktion, nur fileId + Name für portal.beilagen). Löscht
 * die temporäre Datei danach in jedem Fall (auch bei Fehler).
 */
async function ladeBeilageHoch(fileEntry: import('formidable').File): Promise<{ fileId: string; name: string }> {
  const originalName = fileEntry.originalFilename ?? fileEntry.newFilename ?? 'unbekannt'
  const mimeType = fileEntry.mimetype ?? 'application/octet-stream'
  try {
    const buffer = fs.readFileSync(fileEntry.filepath)
    const form = new FormData()
    form.append('file', new Blob([buffer], { type: mimeType }), originalName)

    const res = await fetch(`${base()}/files`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Directus-Files-Upload fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`)
    }
    const json = (await res.json()) as { data?: { id?: string } }
    if (!json.data?.id) throw new Error('Directus-Files: keine id in der Antwort')
    return { fileId: json.data.id, name: originalName }
  } finally {
    try {
      fs.unlinkSync(fileEntry.filepath)
    } catch {
      // Ignorieren, temp-Datei bleibt dann beim nächsten Neustart weg
    }
  }
}

/** Liest den Rohkörper einer application/json-Anfrage selbst (bodyParser ist aus). */
function leseJsonBody(req: NextApiRequest): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => {
      if (!data.trim()) return resolve({})
      try {
        resolve(JSON.parse(data) as Record<string, unknown>)
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const cfEmailHeader = req.headers['cf-access-authenticated-user-email'] as string | undefined
  if (istPortalZugriffAufProxy(req.headers.cookie, cfEmailHeader, process.env.PORTAL_SESSION_SECRET)) {
    return res.status(403).json({ error: 'Operator-Route, kein Portal-Zugriff.' })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const istMultipart = (req.headers['content-type'] || '').includes('multipart/form-data')

  let id = ''
  let textRoh: string | undefined
  let fileEntry: import('formidable').File | undefined

  try {
    if (istMultipart) {
      const form = new IncomingForm({ maxFileSize: 50 * 1024 * 1024, keepExtensions: true })
      const [fields, files]: [Fields, Files] = await form.parse(req)
      const idFeld = Array.isArray(fields.id) ? fields.id[0] : fields.id
      id = typeof idFeld === 'string' ? idFeld.trim() : ''
      const textFeld = Array.isArray(fields.text) ? fields.text[0] : fields.text
      textRoh = typeof textFeld === 'string' ? textFeld : undefined
      const roheDatei = files.file
      fileEntry = Array.isArray(roheDatei) ? roheDatei[0] : roheDatei
    } else {
      const body = await leseJsonBody(req)
      const idRoh = body.id
      id = typeof idRoh === 'string' ? idRoh.trim() : typeof idRoh === 'number' ? String(idRoh) : ''
      textRoh = typeof body.text === 'string' ? body.text : undefined
    }
  } catch (err: unknown) {
    return res
      .status(400)
      .json({ error: `Anfrage konnte nicht gelesen werden: ${err instanceof Error ? err.message : String(err)}` })
  }

  if (!id) {
    return res.status(400).json({ error: 'id erforderlich.' })
  }
  if (textRoh === undefined && !fileEntry) {
    return res.status(400).json({ error: 'text oder Datei erforderlich.' })
  }

  const wer = cfEmailHeader ?? 'team'

  try {
    const app = await ladeApplication(id)
    if (!app) {
      return res.status(404).json({ error: 'Antrag nicht gefunden.' })
    }
    const portal = parsePortal(app.portal)
    const neuesPortal = { ...portal }

    if (textRoh !== undefined) {
      const neueVersion: GesuchVersion = { ts: new Date().toISOString(), von: 'wepublish' }
      neuesPortal.gesuch_text = textRoh
      neuesPortal.gesuch_versionen = fuegeGesuchVersionHinzu(portal.gesuch_versionen ?? [], neueVersion)
    }

    if (fileEntry) {
      const beilage = await ladeBeilageHoch(fileEntry)
      neuesPortal.beilagen = [...(portal.beilagen ?? []), beilage]
    }

    await patchApplication(id, {
      portal: neuesPortal,
      verantwortung: wer,
      zuletzt_geaendert_quelle: 'matching-app',
    })

    return res.status(200).json({ status: 'ok' })
  } catch (err: unknown) {
    console.error('gesuch-text-erfassen POST: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}
