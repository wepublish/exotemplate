/**
 * GET /api/medium-logo?medium=<slug>
 *
 * Lazy-Favicon-Route: liefert das gecachte Medien-Logo aus Directus-Files.
 * Wenn noch nicht gecacht, wird das Favicon server-seitig akquiriert
 * (direkt vom Medium, via HTML-Link-Tags, dann Google-Fallback) und
 * einmalig in Directus-Files gespeichert.
 *
 * Der Browser lädt das Bild ausschliesslich von dieser Route (gleicher Origin).
 * Kein direkter Browser-Request zu Google oder Fremd-Domains.
 *
 * Schreibzugriffe: nur faas_medien (logo_url) + Directus-Files (favicon-Upload).
 * Setzt NIE `logo_hochgeladen` (Fix-Runde 1, Critical): dieses Feld markiert
 * ausschliesslich einen echten Upload über /api/portal/logo, ein Auto-Fetch
 * hier bleibt für den Portal-Pflicht-Erststep (hatLogo) wirkungslos.
 */

import type { NextApiRequest, NextApiResponse } from 'next'

// ─── Konfiguration ────────────────────────────────────────────────────────────

/** Maximale Wartezeit pro Favicon-Fetch-Versuch in ms. */
const FETCH_TIMEOUT_MS = 8_000

/** Minimale Dateigrösse — unter diesem Wert (Bytes) gilt das Icon als ungültig. */
const MIN_BYTES = 100

// ─── Domain-Extraktion ────────────────────────────────────────────────────────

/**
 * Extrahiert den Hostnamen aus einer URL.
 * Exportiert für Unit-Tests.
 */
export function domainAusUrl(url: string): string | null {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return u.hostname
  } catch {
    return null
  }
}

// ─── Icon-Parsing ─────────────────────────────────────────────────────────────

/**
 * Parst den HTML-String und gibt die erste gefundene Icon-URL zurück.
 * Unterstützt: icon, shortcut icon, apple-touch-icon.
 * Relative URLs werden mit der Basis-URL aufgelöst.
 * Exportiert für Unit-Tests.
 */
export function parseLinkRelIcon(html: string, basisUrl: string): string | null {
  // Regex für <link rel="...icon..." href="..."> (Attribute in beliebiger Reihenfolge)
  const linkRegex = /<link\b[^>]*>/gi
  const relIconMuster = /rel\s*=\s*["']([^"']*)["']/i
  const hrefMuster = /href\s*=\s*["']([^"']+)["']/i

  let treffer: RegExpExecArray | null
  while ((treffer = linkRegex.exec(html)) !== null) {
    const tag = treffer[0]
    const relMatch = relIconMuster.exec(tag)
    if (!relMatch) continue
    const relWert = relMatch[1].toLowerCase()
    if (
      relWert === 'icon' ||
      relWert === 'shortcut icon' ||
      relWert === 'apple-touch-icon' ||
      relWert === 'apple-touch-icon-precomposed'
    ) {
      const hrefMatch = hrefMuster.exec(tag)
      if (!hrefMatch) continue
      const href = hrefMatch[1].trim()
      if (!href || href.startsWith('data:')) continue
      // Relative URL auflösen
      try {
        return new URL(href, basisUrl).toString()
      } catch {
        continue
      }
    }
  }
  return null
}

// ─── Favicon-Akquise ──────────────────────────────────────────────────────────

/** Führt einen Fetch mit Timeout durch. Gibt null zurück bei Fehler oder Timeout. */
async function fetchMitTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  try {
    return await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FaaS-Favicon-Bot/1.0)',
      },
    })
  } catch {
    return null
  }
}

/** Prüft ob eine Response ein brauchbares Bild ist (image/*, >MIN_BYTES). */
async function validieresBild(
  res: Response
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.startsWith('image/')) return null
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length < MIN_BYTES) return null
  return { buffer: bytes, contentType: ct.split(';')[0].trim() }
}

/**
 * Versucht das Favicon einer Domain zu holen.
 * Reihenfolge: favicon.ico → HTML link-rel → Google S2-Fallback.
 * Gibt Buffer + contentType zurück, oder null wenn nichts gefunden.
 */
async function akquiriereFavicon(
  website: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const domain = domainAusUrl(website)
  if (!domain) return null

  const basisUrl = `https://${domain}`

  // ── 1. /favicon.ico direkt ────────────────────────────────────────────────
  const icoRes = await fetchMitTimeout(`${basisUrl}/favicon.ico`, FETCH_TIMEOUT_MS)
  if (icoRes?.ok) {
    const bild = await validieresBild(icoRes)
    if (bild) return bild
  }

  // ── 2. Homepage HTML → <link rel="icon|..."> ──────────────────────────────
  const htmlRes = await fetchMitTimeout(basisUrl, FETCH_TIMEOUT_MS)
  if (htmlRes?.ok) {
    const htmlText = await htmlRes.text().catch(() => '')
    const iconUrl = parseLinkRelIcon(htmlText, basisUrl)
    if (iconUrl) {
      const iconRes = await fetchMitTimeout(iconUrl, FETCH_TIMEOUT_MS)
      if (iconRes?.ok) {
        const bild = await validieresBild(iconRes)
        if (bild) return bild
      }
    }
  }

  // ── 3. Google S2 Favicon-Dienst (server-seitiger Fallback) ────────────────
  const googleUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`
  const googleRes = await fetchMitTimeout(googleUrl, FETCH_TIMEOUT_MS)
  if (googleRes?.ok) {
    const bild = await validieresBild(googleRes)
    if (bild) return bild
  }

  return null
}

// ─── Directus-Helpers ─────────────────────────────────────────────────────────

interface FaasMedienEintrag {
  id: number
  website: string | null
  logo_url: string | null
  /**
   * true, sobald das Medium selbst ein echtes PNG/JPG über /api/portal/logo
   * hochgeladen hat (Fix-Runde 1, Critical). Verhindert, dass diese Route
   * einen echten Upload nach einem gescheiterten Asset-Fetch stillschweigend
   * mit einem neu akquirierten Favicon überschreibt (siehe Handler unten).
   */
  logo_hochgeladen: boolean | null
}

/** Lädt faas_medien-Eintrag per slug via GraphQL-Proxy. */
async function ladeMediumPerSlug(
  directusBase: string,
  token: string,
  slug: string
): Promise<FaasMedienEintrag | null> {
  const query = `
    query MediumLogo($slug: String!) {
      faas_medien(filter: { slug: { _eq: $slug } }, limit: 1) {
        id
        website
        logo_url
        logo_hochgeladen
      }
    }
  `
  try {
    const res = await fetch(`${directusBase}/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables: { slug } }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const json = await res.json() as {
      data?: { faas_medien?: FaasMedienEintrag[] }
    }
    return json?.data?.faas_medien?.[0] ?? null
  } catch {
    return null
  }
}

/**
 * Lädt das Directus-Asset und gibt Buffer + Content-Type zurück.
 * Kein Caching auf Server-Seite — Cache-Control wird am Response-Header gesetzt.
 */
async function ladeDirectusAsset(
  directusBase: string,
  token: string,
  fileId: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const res = await fetch(`${directusBase}/assets/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? 'image/png'
    const buffer = Buffer.from(await res.arrayBuffer())
    return { buffer, contentType: ct.split(';')[0].trim() }
  } catch {
    return null
  }
}

/** Lädt ein Bild-Buffer zu Directus-Files hoch. Gibt die file_id zurück. */
async function uploadFaviconZuDirectus(
  directusBase: string,
  token: string,
  buffer: Buffer,
  contentType: string,
  dateiname: string
): Promise<string | null> {
  try {
    const form = new FormData()
    // Buffer.buffer ist ArrayBufferLike (kann SharedArrayBuffer sein) → expliziter Cast.
    // Das native Node.js-Buffer ist in der Praxis immer ein ArrayBuffer.
    form.append(
      'file',
      new Blob([buffer.buffer as ArrayBuffer], { type: contentType }),
      dateiname
    )
    const res = await fetch(`${directusBase}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return null
    const json = await res.json() as { data?: { id?: string } }
    return json?.data?.id ?? null
  } catch {
    return null
  }
}

/** Setzt logo_url auf einem faas_medien-Eintrag via GraphQL-Mutation. */
async function setzeLogo(
  directusBase: string,
  token: string,
  mediumId: number,
  fileId: string
): Promise<void> {
  const mutation = `
    mutation SetMediumLogo($id: ID!, $data: update_faas_medien_input!) {
      update_faas_medien_item(id: $id, data: $data) {
        id
        logo_url
      }
    }
  `
  try {
    await fetch(`${directusBase}/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: mutation,
        variables: { id: String(mediumId), data: { logo_url: fileId } },
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    // Fehler beim Setzen der logo_url: nicht kritisch, Bytes werden trotzdem geliefert
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Nur GET erlaubt' })
    return
  }

  const slug = typeof req.query.medium === 'string' ? req.query.medium.trim() : ''
  if (!slug) {
    res.status(400).json({ error: 'Parameter «medium» (slug) fehlt' })
    return
  }

  const directusBase = process.env.DIRECTUS_URL || 'http://localhost:8055'
  const token = process.env.DIRECTUS_TOKEN || ''

  try {
    // ── 1. Medium per slug laden ───────────────────────────────────────────
    const medium = await ladeMediumPerSlug(directusBase, token, slug)
    if (!medium) {
      res.status(404).json({ error: `Medium «${slug}» nicht gefunden` })
      return
    }

    // ── 2. Wenn logo_url bereits gesetzt: Asset streamen ──────────────────
    if (medium.logo_url) {
      const asset = await ladeDirectusAsset(directusBase, token, medium.logo_url)
      if (asset) {
        res
          .status(200)
          .setHeader('Content-Type', asset.contentType)
          .setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600')
          .setHeader('Content-Length', String(asset.buffer.length))
          .send(asset.buffer)
        return
      }
      // Asset-Fetch gescheitert (z.B. gelöscht). Bei einem ECHTEN Portal-
      // Upload (logo_hochgeladen) NIE stillschweigend mit einem neu
      // akquirierten Favicon überschreiben (Fix-Runde 1, Critical): ein
      // hochgeladenes Logo bleibt massgeblich, auch wenn das Asset gerade
      // nicht abrufbar ist. Ohne echten Upload (nur ein früherer Favicon-
      // Auto-Fetch) darf unten neu akquiriert werden.
      if (medium.logo_hochgeladen) {
        res.status(404).json({ error: `Logo-Datei für «${slug}» derzeit nicht abrufbar` })
        return
      }
    }

    // ── 3. Keine gecachte Version: Favicon akquirieren ────────────────────
    if (!medium.website) {
      res.status(404).json({ error: `Medium «${slug}» hat keine Website` })
      return
    }

    const favicon = await akquiriereFavicon(medium.website)
    if (!favicon) {
      res.status(404).json({ error: `Kein Favicon für «${slug}» gefunden` })
      return
    }

    // ── 4. Favicon zu Directus hochladen + logo_url setzen ────────────────
    const ext = favicon.contentType.split('/')[1]?.replace('x-icon', 'ico') ?? 'png'
    const dateiname = `favicon_${slug}.${ext}`

    const fileId = await uploadFaviconZuDirectus(
      directusBase,
      token,
      favicon.buffer,
      favicon.contentType,
      dateiname
    )

    if (fileId) {
      await setzeLogo(directusBase, token, medium.id, fileId)
    }

    // ── 5. Bytes streamen (auch wenn Upload fehlschlug) ───────────────────
    res
      .status(200)
      .setHeader('Content-Type', favicon.contentType)
      .setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600')
      .setHeader('Content-Length', String(favicon.buffer.length))
      .send(favicon.buffer)
  } catch (err) {
    // Kein 500-Crash: 404, UI zeigt Initial-Fallback
    const msg = err instanceof Error ? err.message : String(err)
    res.status(404).json({ error: `Logo-Route Fehler: ${msg}` })
  }
}
