/**
 * medium-quellen.ts — Automatisches Einsammeln aller DNA-Quellen eines Mediums
 * in die medium_knowledge-Collection. Genutzt vom Ein-Knopf-Orchestrator
 * (/api/medium-knowledge/generate-dna).
 *
 * Drei Quellen, je idempotent (Dedup über source_url ODER title):
 *   1. ingestWepublish  — Artikel + Newsletter über die We.Publish-API.
 *      WARNT (statt still zu überspringen), wenn kein wepublish_api_url hinterlegt.
 *   2. ingestDatensuppe — Dateien aus dem gemounteten Drive-Ordner 01_datensuppe.
 *   3. ingestCrawl      — frischer Web-Crawl der Medien-Website.
 *
 * Bewusst eigenständig (spiegelt die Logik der Einzel-Endpoints upload/scrape/
 * wepublish-ingest), damit die bestehenden Onboarding-Knöpfe unangetastet bleiben.
 */

import { flattenRichText } from '@/pages/api/medium-knowledge/wepublish-ingest'
import { leseDatensuppe } from './datensuppe'

// ─── Directus-Helfer ──────────────────────────────────────────────────────────

interface DirectusResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any
  errors?: { message: string }[]
}

async function directusGraphQL(
  base: string,
  token: string,
  query: string,
  variables: Record<string, unknown>,
  timeoutMs = 20_000
): Promise<DirectusResponse> {
  const res = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Directus HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json() as Promise<DirectusResponse>
}

const CREATE_KNOWLEDGE = `
  mutation CreateKnowledge($data: create_medium_knowledge_input!) {
    create_medium_knowledge_item(data: $data) { id }
  }
`

const EXISTING_KNOWLEDGE = `
  query ExistingKnowledge($medium: String!) {
    medium_knowledge(filter: { medium_id: { _eq: $medium } }, limit: -1) {
      source_url
      title
    }
  }
`

interface DedupSets {
  urls: Set<string>
  titel: Set<string>
}

/** Lädt bestehende medium_knowledge-Einträge für Dedup (source_url + title). */
async function ladeDedup(base: string, token: string, medium_id: string): Promise<DedupSets> {
  const urls = new Set<string>()
  const titel = new Set<string>()
  try {
    const r = await directusGraphQL(base, token, EXISTING_KNOWLEDGE, { medium: medium_id })
    const arr = (r.data?.medium_knowledge ?? []) as { source_url?: string | null; title?: string }[]
    for (const e of arr) {
      if (e.source_url) urls.add(e.source_url)
      if (e.title) titel.add(e.title)
    }
  } catch {
    // Dedup-Fehler ist nicht fatal — ohne Dedup fortfahren.
  }
  return { urls, titel }
}

async function createKnowledge(
  base: string,
  token: string,
  data: Record<string, unknown>
): Promise<boolean> {
  try {
    const r = await directusGraphQL(base, token, CREATE_KNOWLEDGE, { data }, 15_000)
    return !r.errors?.length
  } catch {
    return false
  }
}

// ─── 1. We.Publish ──────────────────────────────────────────────────────────────

const ARTIKEL_QUERY = `
  query FaasArtikel {
    articles(take: 100, sort: PublishedAt, order: Descending) {
      nodes { id publishedAt latest { title lead blocks { ... on RichTextBlock { richText } } } }
    }
  }
`
const NEWSLETTER_QUERY = `
  query FaasNewsletter {
    mails(take: 50, sort: CreatedAt, order: Descending) {
      nodes { id createdAt subject preheader }
    }
  }
`

async function wepublishFetch(apiUrl: string, query: string): Promise<Record<string, unknown>> {
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apollo-require-preflight': 'true' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`We.Publish HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const json = (await res.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] }
  if (json.errors?.length) throw new Error(`We.Publish GraphQL: ${json.errors[0]?.message}`)
  return json.data ?? {}
}

export interface WepublishErgebnis {
  hatApi: boolean
  artikelNeu: number
  newsletterNeu: number
  uebersprungen: number
  fehler: string | null
}

/**
 * Lädt Artikel + Newsletter über die We.Publish-API in medium_knowledge.
 * apiUrl/website kommen vom Aufrufer (aus faas_medien). Ohne apiUrl: hatApi=false
 * (der Orchestrator setzt daraus die sichtbare Warnung).
 */
export async function ingestWepublish(
  base: string,
  token: string,
  medium_id: string,
  apiUrl: string | null,
  website: string | null,
  dedup: DedupSets
): Promise<WepublishErgebnis> {
  if (!apiUrl) {
    return { hatApi: false, artikelNeu: 0, newsletterNeu: 0, uebersprungen: 0, fehler: null }
  }

  let artikelNeu = 0
  let newsletterNeu = 0
  let uebersprungen = 0
  let fehler: string | null = null

  // Artikel
  try {
    const data = await wepublishFetch(apiUrl, ARTIKEL_QUERY)
    const nodes = ((data?.articles as { nodes?: unknown[] } | undefined)?.nodes ?? []) as {
      id?: string
      publishedAt?: string
      latest?: { title?: string; lead?: string; blocks?: { richText?: unknown }[] }
    }[]
    for (const node of nodes) {
      const titel = String(node?.latest?.title ?? '').trim()
      if (!titel) continue
      const sourceUrl = node.id
        ? website
          ? `${website.replace(/\/$/, '')}/a/${node.id}`
          : node.id
        : null
      if ((sourceUrl && dedup.urls.has(sourceUrl)) || dedup.titel.has(titel)) {
        uebersprungen++
        continue
      }
      const lead = String(node?.latest?.lead ?? '').trim()
      const bloecke = Array.isArray(node?.latest?.blocks) ? node.latest!.blocks : []
      const blockTexte = bloecke
        .map(b => (b && typeof b === 'object' && 'richText' in b ? flattenRichText(b.richText) : ''))
        .filter(Boolean)
        .join('\n\n')
      const content = [lead, blockTexte].filter(Boolean).join('\n\n').slice(0, 20_000)
      const ok = await createKnowledge(base, token, {
        medium_id,
        category: 'published_article',
        title: titel,
        content: content || null,
        source_url: sourceUrl,
        file_id: null,
        published_date: node.publishedAt ? node.publishedAt.slice(0, 10) : null,
        auto_scraped: true,
      })
      if (ok) {
        if (sourceUrl) dedup.urls.add(sourceUrl)
        dedup.titel.add(titel)
        artikelNeu++
      } else {
        uebersprungen++
      }
    }
  } catch (e: unknown) {
    fehler = `Artikel: ${e instanceof Error ? e.message : String(e)}`
  }

  // Newsletter
  try {
    const data = await wepublishFetch(apiUrl, NEWSLETTER_QUERY)
    const nodes = ((data?.mails as { nodes?: unknown[] } | undefined)?.nodes ?? []) as {
      id?: string
      createdAt?: string
      subject?: string
      preheader?: string
    }[]
    for (const node of nodes) {
      const subject = String(node?.subject ?? '').trim()
      if (!subject) continue
      if (dedup.titel.has(subject)) {
        uebersprungen++
        continue
      }
      const preheader = String(node?.preheader ?? '').trim()
      const content = [subject, preheader].filter(Boolean).join('\n\n').slice(0, 20_000)
      const ok = await createKnowledge(base, token, {
        medium_id,
        category: 'newsletter',
        title: subject,
        content: content || null,
        source_url: null,
        file_id: null,
        published_date: node.createdAt ? node.createdAt.slice(0, 10) : null,
        auto_scraped: true,
      })
      if (ok) {
        dedup.titel.add(subject)
        newsletterNeu++
      } else {
        uebersprungen++
      }
    }
  } catch (e: unknown) {
    // Newsletter-Fehler an einen evtl. bestehenden Artikel-Fehler anhängen.
    const msg = `Newsletter: ${e instanceof Error ? e.message : String(e)}`
    fehler = fehler ? `${fehler}; ${msg}` : msg
  }

  return { hatApi: true, artikelNeu, newsletterNeu, uebersprungen, fehler }
}

// ─── 2. datensuppe ────────────────────────────────────────────────────────────

export interface DatensuppeIngestErgebnis {
  ordnerGefunden: boolean
  ordnerName: string | null
  dateienNeu: number
  uebersprungen: number
  gekappt: boolean
}

/**
 * Liest den gemounteten datensuppe-Ordner und schreibt neue Dateien in
 * medium_knowledge. Dedup-Schlüssel ist die pseudo-source_url «datensuppe:<relPfad>».
 */
export async function ingestDatensuppe(
  base: string,
  token: string,
  medium_id: string,
  slug: string,
  dedup: DedupSets
): Promise<DatensuppeIngestErgebnis> {
  const gelesen = await leseDatensuppe(slug)
  if (!gelesen.ordnerGefunden) {
    return { ordnerGefunden: false, ordnerName: null, dateienNeu: 0, uebersprungen: gelesen.uebersprungen, gekappt: false }
  }

  let dateienNeu = 0
  let uebersprungen = gelesen.uebersprungen

  for (const e of gelesen.eintraege) {
    const sourceUrl = `datensuppe:${gelesen.ordnerName}/${e.relPfad}`
    if (dedup.urls.has(sourceUrl) || dedup.titel.has(e.title)) {
      uebersprungen++
      continue
    }
    const ok = await createKnowledge(base, token, {
      medium_id,
      category: e.category,
      title: e.title,
      content: e.content.slice(0, 20_000),
      source_url: sourceUrl,
      file_id: null,
      auto_scraped: true,
    })
    if (ok) {
      dedup.urls.add(sourceUrl)
      dedup.titel.add(e.title)
      dateienNeu++
    } else {
      uebersprungen++
    }
  }

  return {
    ordnerGefunden: true,
    ordnerName: gelesen.ordnerName,
    dateienNeu,
    uebersprungen,
    gekappt: gelesen.gekappt,
  }
}

// ─── 3. Web-Crawl ───────────────────────────────────────────────────────────────

export interface CrawlErgebnis {
  gecrawlt: boolean
  fehler: string | null
  /** Roher Crawl-Markdown — wird an die Messung durchgereicht (kein Doppel-Crawl). */
  markdown: string | null
}

/** Crawlt die Medien-Website (eine Seite) und legt sie als medium_knowledge an. */
export async function ingestCrawl(
  base: string,
  token: string,
  medium_id: string,
  website: string | null,
  dedup: DedupSets
): Promise<CrawlErgebnis> {
  if (!website || !website.startsWith('http')) {
    return { gecrawlt: false, fehler: null, markdown: null }
  }
  const firecrawlBase = process.env.FIRECRAWL_URL || 'http://127.0.0.1:8891'
  try {
    const res = await fetch(`${firecrawlBase}/v1/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: website, formats: ['markdown'] }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      return { gecrawlt: false, fehler: `Crawler HTTP ${res.status}`, markdown: null }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await res.json()) as any
    const md: unknown = json?.data?.markdown ?? json?.markdown
    if (typeof md !== 'string' || md.length === 0) {
      return { gecrawlt: false, fehler: 'Crawler: kein Markdown', markdown: null }
    }
    // Titel = erste Markdown-Überschrift, sonst die URL.
    let titel = website
    for (const zeile of md.split('\n')) {
      const m = zeile.match(/^#{1,3}\s+(.+)/)
      if (m && m[1]) {
        titel = m[1].trim().slice(0, 200)
        break
      }
    }
    // Crawl-Markdown geben wir IMMER zurück (für die Messung), auch wenn der
    // medium_knowledge-Eintrag wegen Dedup (Website-URL bereits vorhanden) entfällt.
    if (dedup.urls.has(website)) {
      return { gecrawlt: false, fehler: null, markdown: md }
    }
    const ok = await createKnowledge(base, token, {
      medium_id,
      category: 'general_info',
      title: titel,
      content: md.slice(0, 20_000),
      source_url: website,
      file_id: null,
      auto_scraped: true,
    })
    if (ok) dedup.urls.add(website)
    return { gecrawlt: ok, fehler: ok ? null : 'Directus-Write fehlgeschlagen', markdown: md }
  } catch (e: unknown) {
    return { gecrawlt: false, fehler: `Crawler nicht erreichbar: ${e instanceof Error ? e.message : String(e)}`, markdown: null }
  }
}

export { ladeDedup }
