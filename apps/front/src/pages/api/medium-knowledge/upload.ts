/**
 * /api/medium-knowledge/upload: Datei-Upload + Text-Extraktion + Directus-Eintrag.
 *
 * Ablauf:
 *   1. Multipart-Datei mit formidable parsen (bodyParser deaktiviert).
 *   2. Datei server-seitig zu Directus-Files hochladen → file_id.
 *   3. Text-Extraktion nach Endung:
 *      - .docx → mammoth (Word)
 *      - .xlsx / .xls → xlsx-Bibliothek
 *      - .pdf → pdf-parse
 *      - .txt / .csv / .md → direkt UTF-8
 *      - andere (Bilder etc.) → kein Text (qwen3.6 text-only)
 *   4. medium_knowledge-Eintrag in Directus anlegen.
 *   5. Rückgabe: { id, category, title, chars }
 *
 * Token bleibt server-seitig, wird nie im Browser-Bundle exponiert.
 *
 * POST multipart/form-data:
 *   - file: Datei (required)
 *   - medium_id: string (required)
 *   - category: string (optional, Default: general_info)
 *   - title: string (optional, Default: Dateiname)
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { IncomingForm, Files, Fields } from 'formidable'
import fs from 'fs'
import { extrahiereText } from '@/lib/text-extraktion'

// ─── Next.js Config ───────────────────────────────────────────────────────────

export const config = {
  api: {
    bodyParser: false,
  },
}

// ─── Typen ────────────────────────────────────────────────────────────────────

interface UploadSuccess {
  id: number
  category: string
  title: string
  chars: number
}

interface UploadError {
  error: string
}

// ─── Gültige Kategorien ───────────────────────────────────────────────────────

const VALID_CATEGORIES = [
  'previous_application',
  'tax_exemption',
  'budget',
  'published_article',
  'newsletter',
  'testimonial',
  'general_info',
] as const

type KnowledgeCategory = typeof VALID_CATEGORIES[number]

function isValidCategory(v: unknown): v is KnowledgeCategory {
  return VALID_CATEGORIES.includes(v as KnowledgeCategory)
}

// ─── Directus-Helpers ─────────────────────────────────────────────────────────

/** Lädt eine Datei via REST nach Directus-Files hoch. Gibt die file_id (UUID) zurück. */
async function uploadZuDirectusFiles(
  directusBase: string,
  token: string,
  filePath: string,
  originalName: string,
  mimeType: string
): Promise<string> {
  // Natives FormData + Blob (undici-kompatibel). Das form-data-Paket funktioniert
  // mit Node-fetch NICHT zuverlässig → Directus quittiert mit «Unexpected end of form».
  const buffer = fs.readFileSync(filePath)
  const form = new FormData()
  form.append('file', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), originalName)

  const res = await fetch(`${directusBase}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      // KEIN Content-Type, fetch setzt die Multipart-Boundary selbst.
    },
    body: form,
    signal: AbortSignal.timeout(60_000),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Directus-Files-Upload fehlgeschlagen (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }

  const json = await res.json() as { data?: { id?: string } }
  const fileId = json?.data?.id
  if (!fileId) {
    throw new Error('Directus-Files: Kein id in der Antwort')
  }
  return fileId
}

/** Legt einen medium_knowledge-Eintrag in Directus an. */
async function createKnowledgeEintrag(
  directusBase: string,
  token: string,
  data: {
    medium_id: string
    category: KnowledgeCategory
    title: string
    content: string
    file_id: string
    auto_scraped: boolean
  }
): Promise<{ id: number }> {
  const mutation = `
    mutation CreateKnowledge($data: create_medium_knowledge_input!) {
      create_medium_knowledge_item(data: $data) {
        id
      }
    }
  `

  const res = await fetch(`${directusBase}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query: mutation, variables: { data } }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Directus-GraphQL-Fehler (HTTP ${res.status}): ${text.slice(0, 200)}`)
  }

  const json = await res.json() as {
    data?: { create_medium_knowledge_item?: { id: number } }
    errors?: { message: string }[]
  }

  if (json.errors?.length) {
    throw new Error(`Directus-Mutation fehlgeschlagen: ${json.errors[0]?.message}`)
  }

  const created = json.data?.create_medium_knowledge_item
  if (!created?.id) {
    throw new Error('Directus: Kein id nach create_medium_knowledge_item')
  }
  return { id: created.id }
}

// ─── Verarbeitungs-Kern (geteilt mit /api/portal/upload) ──────────────────────

/**
 * Verarbeitet eine bereits per formidable geparste Datei vollständig: Upload
 * zu Directus-Files, Text-Extraktion, medium_knowledge-Eintrag anlegen.
 *
 * Extrahiert aus dem ursprünglichen Handler, damit /api/portal/upload
 * (Task 6, Medien-Selbstservice) exakt denselben Kern nutzt. Nur die
 * `medium_id` kommt dort aus der Portal-Session statt aus einem Formularfeld,
 * nie vom Client. Die Validierung der Pflichtfelder (medium_id/file vorhanden)
 * bleibt in den jeweiligen Handlern, weil sich die Fehlerformen dort
 * unterscheiden können.
 *
 * Wirft bei jedem Fehler (Upload, Extraktion, Directus-Schreiben): beide
 * Handler fangen das ab und antworten mit 502 statt einem Next-500.
 */
export async function verarbeiteUpload(
  medium_id: string,
  fileEntry: import('formidable').File,
  felder: { title?: string; category?: string }
): Promise<UploadSuccess> {
  const directusBase = process.env.DIRECTUS_URL || 'http://localhost:8055'
  const token = process.env.DIRECTUS_TOKEN || ''

  const category: KnowledgeCategory = isValidCategory(felder.category) ? felder.category : 'general_info'
  const originalName = fileEntry.originalFilename ?? fileEntry.newFilename ?? 'unbekannt'
  const title = felder.title && felder.title.trim() ? felder.title.trim() : originalName
  const mimeType = fileEntry.mimetype ?? 'application/octet-stream'
  const tempPath = fileEntry.filepath

  let fileId: string
  let content: string

  try {
    // Datei zu Directus-Files hochladen
    fileId = await uploadZuDirectusFiles(directusBase, token, tempPath, originalName, mimeType)

    // Text extrahieren
    content = await extrahiereText(tempPath, originalName)
  } finally {
    // Temporäre Datei immer löschen (auch bei Fehler)
    try {
      fs.unlinkSync(tempPath)
    } catch {
      // Ignorieren, temp-Datei bleibt dann beim nächsten Neustart weg
    }
  }

  const created = await createKnowledgeEintrag(directusBase, token, {
    medium_id,
    category,
    title,
    content,
    file_id: fileId,
    auto_scraped: false,
  })

  return { id: created.id, category, title, chars: content.length }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UploadSuccess | UploadError>
) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Nur POST erlaubt' })
    return
  }

  // ── 1. Multipart parsen ───────────────────────────────────────────────────
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
    res.status(400).json({ error: `Datei konnte nicht geparst werden: ${msg}` })
    return
  }

  // ── 2. Pflichtfelder validieren ───────────────────────────────────────────
  const medium_id = Array.isArray(fields.medium_id)
    ? fields.medium_id[0]
    : fields.medium_id
  if (!medium_id || typeof medium_id !== 'string') {
    res.status(400).json({ error: 'medium_id (string) erforderlich' })
    return
  }

  const rawCategory = Array.isArray(fields.category) ? fields.category[0] : fields.category
  const rawTitle = Array.isArray(fields.title) ? fields.title[0] : fields.title

  const fileEntries = files.file
  const fileEntry = Array.isArray(fileEntries) ? fileEntries[0] : fileEntries
  if (!fileEntry) {
    res.status(400).json({ error: 'Kein file-Feld in der Anfrage' })
    return
  }

  // ── 3. Verarbeitung ────────────────────────────────────────────────────────
  try {
    const result = await verarbeiteUpload(medium_id, fileEntry, {
      title: typeof rawTitle === 'string' ? rawTitle : undefined,
      category: typeof rawCategory === 'string' ? rawCategory : undefined,
    })
    res.status(200).json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(502).json({ error: `Verarbeitung fehlgeschlagen: ${msg}` })
  }
}
