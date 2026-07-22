/**
 * /api/medium-knowledge/wepublish-ingest — Artikel + Newsletter aus We.Publish laden.
 *
 * POST { medium_id: string }
 *   → 200 { artikel_neu, newsletter_neu, uebersprungen }
 *   → 400 { error }   bei fehlendem medium_id oder fehlender API-URL
 *   → 502 { error }   bei We.Publish- oder Directus-Fehler
 *
 * Kein LLM nötig — reiner API-Pull.
 * Schreibt NUR in medium_knowledge (create).
 * Token bleibt server-seitig.
 *
 * Dedup: Überspringt Einträge, deren source_url ODER title bereits in
 * medium_knowledge für dieses Medium vorhanden ist.
 */

import type { NextApiRequest, NextApiResponse } from 'next'

// ─── We.Publish GraphQL-Queries ───────────────────────────────────────────────
// Exaktes Enum-Casing laut Aufgabe: PublishedAt / Descending / CreatedAt

const ARTIKEL_QUERY = `
  query FaasArtikel {
    articles(take: 100, sort: PublishedAt, order: Descending) {
      nodes {
        id
        publishedAt
        latest {
          title
          lead
          blocks {
            ... on RichTextBlock {
              richText
            }
          }
        }
      }
    }
  }
`

const NEWSLETTER_QUERY = `
  query FaasNewsletter {
    mails(take: 50, sort: CreatedAt, order: Descending) {
      nodes {
        id
        createdAt
        subject
        preheader
      }
    }
  }
`

const CREATE_KNOWLEDGE_MUTATION = `
  mutation CreateKnowledge($data: create_medium_knowledge_input!) {
    create_medium_knowledge_item(data: $data) {
      id
    }
  }
`

const EXISTING_KNOWLEDGE_QUERY = `
  query ExistingKnowledge($medium: String!) {
    medium_knowledge(
      filter: { medium_id: { _eq: $medium } }
      sort: ["-date_created"]
      limit: -1
    ) {
      source_url
      title
    }
  }
`

// ─── richText-Flattener ───────────────────────────────────────────────────────

/**
 * Wandelt Slate-JSON (Array von {type, children:[{text}|...]}) rekursiv
 * in Volltext um, indem alle text-Felder eingesammelt werden.
 */
export function flattenRichText(node: unknown): string {
  if (!node) return ''

  if (typeof node === 'string') return node

  if (Array.isArray(node)) {
    return node.map(flattenRichText).join(' ').replace(/\s+/g, ' ').trim()
  }

  if (typeof node === 'object' && node !== null) {
    const obj = node as Record<string, unknown>
    // Blatt-Knoten: hat "text"
    if (typeof obj['text'] === 'string') {
      return obj['text']
    }
    // Innen-Knoten: hat "children"
    if (Array.isArray(obj['children'])) {
      return flattenRichText(obj['children'])
    }
  }

  return ''
}

// ─── Directus-Hilfsfunktion ───────────────────────────────────────────────────

async function directusGraphQL(
  base: string,
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<{ data: Record<string, unknown>; errors?: { message: string }[] }> {
  const res = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Directus HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json() as Promise<{ data: Record<string, unknown>; errors?: { message: string }[] }>
}

// ─── We.Publish-Fetch ─────────────────────────────────────────────────────────

async function wepublishFetch(
  apiUrl: string,
  query: string
): Promise<Record<string, unknown>> {
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apollo-require-preflight': 'true',
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`We.Publish HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = await res.json() as { data?: Record<string, unknown>; errors?: { message: string }[] }
  if (json.errors?.length) {
    throw new Error(`We.Publish GraphQL: ${json.errors[0]?.message}`)
  }
  return json.data ?? {}
}

// ─── Typen ────────────────────────────────────────────────────────────────────

interface IngestResult {
  artikel_neu: number
  newsletter_neu: number
  uebersprungen: number
}

interface IngestError {
  error: string
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<IngestResult | IngestError>
) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Nur POST erlaubt' })
    return
  }

  const { medium_id } = req.body ?? {}
  if (!medium_id || typeof medium_id !== 'string') {
    res.status(400).json({ error: 'medium_id (string) erforderlich' })
    return
  }

  const directusBase = process.env.DIRECTUS_URL || 'http://localhost:8055'
  const directusToken = process.env.DIRECTUS_TOKEN || ''

  // ── 1. We.Publish-API-URL aus faas_medien laden ───────────────────────────
  const medienQuery = `
    query MediumFelder($slug: String!) {
      faas_medien(filter: { slug: { _eq: $slug } }, limit: 1) {
        wepublish_api_url
        website
      }
    }
  `
  let wepublishApiUrl: string | null = null
  let websiteBase: string | null = null

  try {
    const medienR = await directusGraphQL(directusBase, directusToken, medienQuery, { slug: medium_id })
    if (medienR.errors?.length) {
      res.status(502).json({ error: `Directus: ${medienR.errors[0]?.message}` })
      return
    }
    const medienArr = medienR.data?.['faas_medien'] as { wepublish_api_url?: string | null; website?: string | null }[] | undefined
    const medium = medienArr?.[0]
    wepublishApiUrl = medium?.wepublish_api_url ?? null
    websiteBase = medium?.website ?? null
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    res.status(502).json({ error: `Directus-Abfrage fehlgeschlagen: ${msg.slice(0, 200)}` })
    return
  }

  if (!wepublishApiUrl) {
    res.status(400).json({ error: 'Keine We.Publish-API hinterlegt (faas_medien.wepublish_api_url leer)' })
    return
  }

  // ── 2. Bestehende medium_knowledge für Dedup laden ────────────────────────
  const vorhandeneUrls = new Set<string>()
  const vorhandeneTitel = new Set<string>()

  try {
    const existR = await directusGraphQL(directusBase, directusToken, EXISTING_KNOWLEDGE_QUERY, { medium: medium_id })
    const existArr = existR.data?.['medium_knowledge'] as { source_url?: string | null; title?: string }[] | undefined
    for (const e of existArr ?? []) {
      if (e.source_url) vorhandeneUrls.add(e.source_url)
      if (e.title) vorhandeneTitel.add(e.title)
    }
  } catch {
    // Dedup-Fehler ist nicht fatal — wir fahren ohne Dedup fort
  }

  let artikelNeu = 0
  let newsletterNeu = 0
  let uebersprungen = 0

  // ── 3. Artikel holen ─────────────────────────────────────────────────────
  try {
    const artikelData = await wepublishFetch(wepublishApiUrl, ARTIKEL_QUERY)
    const nodes = (artikelData?.['articles'] as { nodes?: unknown[] } | undefined)?.nodes ?? []

    for (const rawNode of nodes) {
      const node = rawNode as {
        id?: string
        publishedAt?: string
        latest?: {
          title?: string
          lead?: string
          blocks?: { richText?: unknown }[]
        }
      }

      const titel = String(node?.latest?.title ?? '').trim()
      if (!titel) continue

      // source_url bauen: <website>/a/<id> falls website vorhanden, sonst nur die id
      const sourceUrl = node.id
        ? (websiteBase ? `${websiteBase.replace(/\/$/, '')}/a/${node.id}` : node.id)
        : null

      // Dedup
      if (sourceUrl && vorhandeneUrls.has(sourceUrl)) {
        uebersprungen++
        continue
      }
      if (vorhandeneTitel.has(titel)) {
        uebersprungen++
        continue
      }

      // Volltext: lead + alle RichTextBlock-Texte
      const lead = String(node?.latest?.lead ?? '').trim()
      const bloecke = Array.isArray(node?.latest?.blocks) ? node.latest!.blocks : []
      const blockTexte = bloecke
        .map(b => (b && typeof b === 'object' && 'richText' in b ? flattenRichText(b.richText) : ''))
        .filter(Boolean)
        .join('\n\n')

      const content = [lead, blockTexte].filter(Boolean).join('\n\n').slice(0, 20_000)
      const publishedDate = node.publishedAt ? node.publishedAt.slice(0, 10) : null

      try {
        await directusGraphQL(directusBase, directusToken, CREATE_KNOWLEDGE_MUTATION, {
          data: {
            medium_id,
            category: 'published_article',
            title: titel,
            content: content || null,
            source_url: sourceUrl,
            file_id: null,
            published_date: publishedDate,
            auto_scraped: true,
          },
        })
        if (sourceUrl) vorhandeneUrls.add(sourceUrl)
        vorhandeneTitel.add(titel)
        artikelNeu++
      } catch {
        // Einzelner Fehler überspringen, weiter mit nächstem
        uebersprungen++
      }
    }
  } catch (e: unknown) {
    // We.Publish-Artikel-Fehler ist nicht fatal — Newsletter noch versuchen
    const msg = e instanceof Error ? e.message : String(e)
    // Wenn wir noch gar nichts haben, ist das ein echter Fehler
    if (artikelNeu === 0 && newsletterNeu === 0) {
      res.status(502).json({ error: `We.Publish Artikel-Fetch: ${msg.slice(0, 200)}` })
      return
    }
  }

  // ── 4. Newsletter holen ───────────────────────────────────────────────────
  try {
    const newsletterData = await wepublishFetch(wepublishApiUrl, NEWSLETTER_QUERY)
    const nodes = (newsletterData?.['mails'] as { nodes?: unknown[] } | undefined)?.nodes ?? []

    for (const rawNode of nodes) {
      const node = rawNode as {
        id?: string
        createdAt?: string
        subject?: string
        preheader?: string
      }

      const subject = String(node?.subject ?? '').trim()
      if (!subject) continue

      // Dedup per Titel (subject)
      if (vorhandeneTitel.has(subject)) {
        uebersprungen++
        continue
      }

      const preheader = String(node?.preheader ?? '').trim()
      const content = [subject, preheader].filter(Boolean).join('\n\n').slice(0, 20_000)
      const createdDate = node.createdAt ? node.createdAt.slice(0, 10) : null

      try {
        await directusGraphQL(directusBase, directusToken, CREATE_KNOWLEDGE_MUTATION, {
          data: {
            medium_id,
            category: 'newsletter',
            title: subject,
            content: content || null,
            source_url: null,
            file_id: null,
            published_date: createdDate,
            auto_scraped: true,
          },
        })
        vorhandeneTitel.add(subject)
        newsletterNeu++
      } catch {
        uebersprungen++
      }
    }
  } catch {
    // Newsletter-Fehler nicht fatal
  }

  res.status(200).json({ artikel_neu: artikelNeu, newsletter_neu: newsletterNeu, uebersprungen })
}
