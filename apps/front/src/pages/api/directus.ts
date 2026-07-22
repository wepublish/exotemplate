import type { NextApiRequest, NextApiResponse } from 'next'
import { istPortalZugriffAufProxy } from '@/lib/portal-guard'
import { warneEinmalig } from '@/lib/env-check'

// Server-seitiger GraphQL-Proxy: der Directus-Token bleibt auf dem Server (Spark),
// der Browser spricht nur mit dieser Route (gleicher Origin). Damit ist die App
// hinter Cloudflare gefahrlos exponierbar (kein Token im Browser-Bundle).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Beim ersten API-Aufruf einmalig auf fehlende Pflicht-Envs hinweisen
  // (kein Gate, nur Diagnose - siehe deploy/hetzner/.env.example).
  warneEinmalig()

  // Portal-Sperre ZUERST, bevor irgendetwas an Directus geht: Medien
  // authentifizieren sich nur über die kuratierten Portal-Routen
  // (/api/portal/*), nie über diesen rohen GraphQL-Proxy. Operatoren kommen
  // über Cloudflare Access (cf-access-authenticated-user-email-Header) und
  // bleiben davon unberührt.
  const cfHeaderRoh = req.headers['cf-access-authenticated-user-email']
  const cfHeader = Array.isArray(cfHeaderRoh) ? cfHeaderRoh[0] : cfHeaderRoh
  if (istPortalZugriffAufProxy(req.headers.cookie, cfHeader, process.env.PORTAL_SESSION_SECRET)) {
    return res.status(403).json({ error: 'Portal-Zugriff auf den Datenproxy ist gesperrt' })
  }

  if (req.method !== 'POST') {
    res.status(405).json({ errors: [{ message: 'Only POST' }] })
    return
  }
  const base = process.env.DIRECTUS_URL || 'http://localhost:8055'
  const token = process.env.DIRECTUS_TOKEN || ''
  try {
    const r = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
    })
    const text = await r.text()
    res.status(r.status).setHeader('Content-Type', 'application/json').send(text)
  } catch (e: unknown) {
    res.status(502).json({ errors: [{ message: 'directus proxy failed: ' + (e instanceof Error ? e.message : String(e)) }] })
  }
}
