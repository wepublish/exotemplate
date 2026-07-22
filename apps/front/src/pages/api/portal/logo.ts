/**
 * /api/portal/logo: Logo-Upload für das Medien-Selbstservice-Portal.
 *
 * Pflicht-Erststep im Portal-Onboarding (siehe baueStationen in
 * portal-status.ts, Station 'logo' vor 'unterlagen'): ein Medium muss ein
 * echtes PNG oder JPG hochladen, bevor es weiterkommt. Das behebt zugleich
 * ein bestehendes Problem: das automatisch abgerufene Favicon
 * (/api/medium-logo, .ico) kann der Word-Export (gesuch-docx.ts,
 * erkenneBildTyp) nicht einbetten; ein echtes PNG/JPG erscheint im
 * exportierten Gesuch.
 *
 * Wie /api/portal/upload nimmt die Route `medium_id` NIE vom Client, nur aus
 * der Portal-Session (`session.mediumSlug`).
 *
 * POST multipart/form-data:
 *   - file: Datei (required, PNG oder JPG/JPEG, max 5 MB)
 *
 *   → 200 { logoUrl }  Directus-Datei-id des neuen Logos
 *   → 400 { error }    fehlendes file-Feld, Parse-Fehler (u. a. zu gross)
 *   → 401 { error }    ohne gültige Portal-Session
 *   → 422 { error }    Datei ist kein PNG/JPG (Magic Bytes massgeblich, siehe
 *                      erkenneLogoTyp; der vom Client gesendete Mimetype wird
 *                      nicht mehr als Ablehnungsgrund herangezogen, Fix-Runde 1)
 *   → 502 { error }    Upload-/Directus-Fehler
 *   → 503 { error }    PORTAL_SESSION_SECRET fehlt
 *   → 405              andere Methode als GET/POST
 *
 * GET → 200 { logoUrl }  aktueller Stand (Directus-Datei-id oder null), best effort
 *
 * Bei erfolgreichem Upload setzt die Route ZWEI Felder in EINEM PATCH:
 * logo_url (Anzeige/Word-Export) UND logo_hochgeladen=true (Provenienz-
 * Marker, Grundlage von hatLogo in me.ts/uebersicht.ts/dna-erzeugen.ts,
 * Fix-Runde 1: logo_url allein reicht nicht, weil medium-logo.ts es auch
 * automatisch mit einem Favicon befüllen kann).
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import fs from 'fs'
import { IncomingForm, type Files } from 'formidable'
import { requirePortalSession } from '@/lib/portal-guard'
import { erkenneLogoTyp } from '@/lib/portal-logo'

export const config = {
  api: {
    bodyParser: false,
  },
}

// ─── Konfiguration ────────────────────────────────────────────────────────────

/** Maximale Logo-Grösse: deutlich kleiner als der 50-MB-Deckel von /api/portal/upload, ein Logo ist klein. */
const MAX_BYTES = 5 * 1024 * 1024

const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const authHeaders = () => ({ Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}` })

// ─── Directus-Helfer ──────────────────────────────────────────────────────────

/** Lädt den Logo-Datei-id-Stand eines Mediums (best effort, für GET). */
async function ladeAktuellesLogo(slug: string): Promise<string | null> {
  const filter = encodeURIComponent(JSON.stringify({ slug: { _eq: slug } }))
  const res = await fetch(`${base()}/items/faas_medien?filter=${filter}&limit=1&fields=logo_url`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`faas_medien: Directus antwortete ${res.status}`)
  const json = (await res.json()) as { data?: Array<{ logo_url?: string | null }> }
  return json.data?.[0]?.logo_url ?? null
}

/**
 * Lädt den Bild-Buffer via natives FormData/Blob zu Directus-Files hoch
 * (Muster wie medium-knowledge/upload.ts). Liefert die neue Datei-id.
 *
 * `new Uint8Array(buffer)` statt `buffer` direkt: Node liefert `Buffer` mit
 * einem generischen `ArrayBufferLike`-Unterbau (kann `SharedArrayBuffer`
 * sein), den `BlobPart` nicht annimmt. Die Kopie via `Uint8Array` löst das
 * nicht nur typseitig, sondern ist auch inhaltlich sauber: kleine Buffer
 * teilen sich intern Nodes gepooltes ArrayBuffer, ein blosser Cast auf
 * `buffer.buffer` (wie in medium-logo.ts) könnte darum fremde Bytes aus dem
 * Pool mit hochladen; `new Uint8Array(buffer)` kopiert exakt die logischen
 * Bytes des Buffers.
 */
async function uploadLogoZuDirectus(buffer: Buffer, dateiname: string, contentType: string): Promise<string> {
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

/**
 * Setzt `faas_medien.logo_url` UND `logo_hochgeladen=true` in EINEM PATCH
 * (Bulk-Update-Form wie setzeDnaFreigabe in portal-guard.ts: Filter im Body,
 * nicht in der URL). logo_hochgeladen ist der eigentliche Provenienz-Marker
 * (Fix-Runde 1, Critical): erst er, nicht logo_url allein, macht hatLogo
 * (me.ts/uebersicht.ts/dna-erzeugen.ts) wahr, denn logo_url kann sonst auch
 * ein automatisch abgerufenes Favicon sein (medium-logo.ts). Ersetzt einen evtl.
 * vorher automatisch abgerufenen Favicon-Stand vollständig, ein
 * hochgeladenes Logo hat immer Vorrang (siehe medium-logo.ts: dessen
 * Auto-Fetch überschreibt umgekehrt NIE ein bereits gesetztes logo_url,
 * siehe Modul-Kommentar dort).
 */
async function setzeLogoUrl(slug: string, fileId: string): Promise<void> {
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

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const session = requirePortalSession(req, res)
  if (!session) return

  if (req.method === 'GET') {
    try {
      const logoUrl = await ladeAktuellesLogo(session.mediumSlug)
      return res.status(200).json({ logoUrl })
    } catch (err) {
      console.error('portal/logo (GET): Directus nicht erreichbar', err)
      return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
    }
  }

  // ── POST: Datei parsen ──────────────────────────────────────────────────
  let files: Files
  try {
    const form = new IncomingForm({ maxFileSize: MAX_BYTES, keepExtensions: true })
    const result = await form.parse(req)
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

  const tempPath = fileEntry.filepath

  let buffer: Buffer
  try {
    buffer = fs.readFileSync(tempPath)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return res.status(400).json({ error: `Datei konnte nicht gelesen werden: ${msg}` })
  } finally {
    try {
      fs.unlinkSync(tempPath)
    } catch {
      // Ignorieren, temp-Datei bleibt dann beim nächsten Neustart weg.
    }
  }

  // Magic Bytes sind massgeblich (Fix-Runde 1, Minor): ein vom Client falsch
  // gesetzter Mimetype (z. B. application/octet-stream für ein echtes PNG)
  // darf einen sonst gültigen Upload NICHT ablehnen. .ico/andere Nicht-Bild-
  // Bytes fallen weiterhin durch, egal welchen Mimetype der Client meldet.
  const typ = erkenneLogoTyp(buffer)
  if (!typ) {
    return res.status(422).json({ error: 'Bitte ein PNG oder JPG hochladen.' })
  }

  const dateiname = `logo_${session.mediumSlug}.${typ}`
  const contentType = typ === 'jpg' ? 'image/jpeg' : 'image/png'

  try {
    const fileId = await uploadLogoZuDirectus(buffer, dateiname, contentType)
    await setzeLogoUrl(session.mediumSlug, fileId)
    return res.status(200).json({ logoUrl: fileId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('portal/logo: Upload fehlgeschlagen', err)
    return res.status(502).json({ error: `Upload fehlgeschlagen: ${msg}` })
  }
}
