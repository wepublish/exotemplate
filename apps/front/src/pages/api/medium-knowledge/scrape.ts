/**
 * /api/medium-knowledge/scrape — URL via faas-crawler scrapen + als medium_knowledge speichern.
 *
 * POST { medium_id: string, url: string, category?: string }
 *   → 200 { id, title, category, chars }
 *   → 400 { error }   bei fehlenden Pflichtfeldern
 *   → 502 { error }   bei Crawler- oder Directus-Fehler
 *
 * Token bleibt server-seitig.
 * Schreibt NUR in medium_knowledge (create).
 */

import type { NextApiRequest, NextApiResponse } from 'next'

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

// ─── Titel aus Markdown extrahieren ──────────────────────────────────────────

/**
 * Gibt die erste Markdown-Überschrift (# ...) zurück,
 * oder — falls keine vorhanden — die URL.
 */
function extrahiereTitel(markdown: string, fallbackUrl: string): string {
  const zeilen = markdown.split('\n')
  for (const zeile of zeilen) {
    const match = zeile.match(/^#{1,3}\s+(.+)/)
    if (match && match[1]) {
      return match[1].trim().slice(0, 200)
    }
  }
  // Kein Titel im Markdown — URL als Fallback
  return fallbackUrl.slice(0, 200)
}

// ─── GraphQL-Mutation ─────────────────────────────────────────────────────────

const CREATE_KNOWLEDGE_MUTATION = `
  mutation CreateKnowledge($data: create_medium_knowledge_input!) {
    create_medium_knowledge_item(data: $data) {
      id
    }
  }
`

// ─── Typen ────────────────────────────────────────────────────────────────────

interface ScrapeSuccess {
  id: number
  title: string
  category: string
  chars: number
}

interface ScrapeError {
  error: string
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ScrapeSuccess | ScrapeError>
) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Nur POST erlaubt' })
    return
  }

  const { medium_id, url, category: rawCategory } = req.body ?? {}

  if (!medium_id || typeof medium_id !== 'string') {
    res.status(400).json({ error: 'medium_id (string) erforderlich' })
    return
  }
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url (string) erforderlich' })
    return
  }

  const category: KnowledgeCategory = isValidCategory(rawCategory) ? rawCategory : 'published_article'

  const directusBase = process.env.DIRECTUS_URL || 'http://localhost:8055'
  const directusToken = process.env.DIRECTUS_TOKEN || ''
  const firecrawlBase = process.env.FIRECRAWL_URL || 'http://127.0.0.1:8891'

  // ── 1. URL via faas-crawler scrapen ─────────────────────────────────────────
  let markdown: string
  try {
    const crawlRes = await fetch(`${firecrawlBase}/v1/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['markdown'] }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!crawlRes.ok) {
      const errText = await crawlRes.text()
      res.status(502).json({
        error: `Crawler HTTP ${crawlRes.status}: ${errText.slice(0, 200)}`,
      })
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const crawlJson = await crawlRes.json() as any
    const md: unknown = crawlJson?.data?.markdown ?? crawlJson?.markdown
    if (typeof md !== 'string' || md.length === 0) {
      res.status(502).json({ error: 'Crawler: kein Markdown in der Antwort' })
      return
    }
    markdown = md
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    res.status(502).json({ error: `Crawler nicht erreichbar: ${msg.slice(0, 200)}` })
    return
  }

  // ── 2. Titel + Content aufbereiten ───────────────────────────────────────────
  const title = extrahiereTitel(markdown, url)
  const content = markdown.slice(0, 20_000)

  // ── 3. medium_knowledge anlegen ──────────────────────────────────────────────
  try {
    const directusRes = await fetch(`${directusBase}/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${directusToken}`,
      },
      body: JSON.stringify({
        query: CREATE_KNOWLEDGE_MUTATION,
        variables: {
          data: {
            medium_id,
            category,
            title,
            content,
            source_url: url,
            file_id: null,
            auto_scraped: true,
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!directusRes.ok) {
      const text = await directusRes.text()
      res.status(502).json({ error: `Directus HTTP ${directusRes.status}: ${text.slice(0, 200)}` })
      return
    }

    const directusJson = await directusRes.json() as {
      data?: { create_medium_knowledge_item?: { id: number } }
      errors?: { message: string }[]
    }

    if (directusJson.errors?.length) {
      res.status(502).json({ error: `Directus-Mutation: ${directusJson.errors[0]?.message}` })
      return
    }

    const created = directusJson.data?.create_medium_knowledge_item
    if (!created?.id) {
      res.status(502).json({ error: 'Directus: kein id nach create_medium_knowledge_item' })
      return
    }

    res.status(200).json({ id: created.id, title, category, chars: content.length })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    res.status(502).json({ error: `Directus-Fehler: ${msg.slice(0, 200)}` })
  }
}
