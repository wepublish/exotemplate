/**
 * /api/portal/scrape: URL-Übernahme für das Medien-Selbstservice-Portal (Task 6).
 *
 * Gleicher Mechanismus wie /api/medium-knowledge/scrape (Firecrawl → Markdown
 * → medium_knowledge), aber `medium_id` kommt ausschliesslich aus der Portal-
 * Session, nie vom Client, und die Kategorie ist fest `general_info`. Das
 * Portal bietet (bewusst schlank) keine Kategorie-Auswahl für diesen Weg an.
 *
 * POST { url: string }
 *   → 200 { id, title, category, chars }
 *   → 400 { error }  bei fehlender/leerer url
 *   → 401 { error }  ohne gültige Portal-Session
 *   → 502 { error }  bei Crawler- oder Directus-Fehler
 *   → 503 { error }  wenn PORTAL_SESSION_SECRET fehlt
 *   → 405            bei falscher Methode
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { requirePortalSession, legeWissensEintragAn } from '@/lib/portal-guard'

/** Erste Markdown-Überschrift, sonst die URL (identisch zur Operator-Route). */
function extrahiereTitel(markdown: string, fallbackUrl: string): string {
  const zeilen = markdown.split('\n')
  for (const zeile of zeilen) {
    const match = zeile.match(/^#{1,3}\s+(.+)/)
    if (match && match[1]) {
      return match[1].trim().slice(0, 200)
    }
  }
  return fallbackUrl.slice(0, 200)
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const session = requirePortalSession(req, res)
  if (!session) return

  const { url } = (req.body ?? {}) as { url?: unknown }
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url (string) erforderlich' })
  }

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
      return res.status(502).json({ error: `Crawler HTTP ${crawlRes.status}: ${errText.slice(0, 200)}` })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const crawlJson = (await crawlRes.json()) as any
    const md: unknown = crawlJson?.data?.markdown ?? crawlJson?.markdown
    if (typeof md !== 'string' || md.length === 0) {
      return res.status(502).json({ error: 'Crawler: kein Markdown in der Antwort' })
    }
    markdown = md
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return res.status(502).json({ error: `Crawler nicht erreichbar: ${msg.slice(0, 200)}` })
  }

  // ── 2. Titel + Content aufbereiten ───────────────────────────────────────────
  const title = extrahiereTitel(markdown, url)
  const content = markdown.slice(0, 20_000)

  // ── 3. medium_knowledge anlegen ──────────────────────────────────────────────
  try {
    const created = await legeWissensEintragAn({
      medium_id: session.mediumSlug,
      category: 'general_info',
      title,
      content,
      source_url: url,
      file_id: null,
      auto_scraped: true,
    })
    return res.status(200).json({ id: created.id, title, category: 'general_info', chars: content.length })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('portal/scrape: Directus-Eintrag fehlgeschlagen', e)
    return res.status(502).json({ error: `Directus-Fehler: ${msg.slice(0, 200)}` })
  }
}
