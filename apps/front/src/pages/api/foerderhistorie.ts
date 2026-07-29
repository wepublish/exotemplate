/**
 * /api/foerderhistorie: Operator-Lese-Sicht auf Förderhistorie + Ausschlüsse
 * eines Mediums (Onboarding-Cockpit).
 *
 * Bewusst NICHT unter /api/portal/*: dieser Namensraum gehört den
 * Medium-Session-Routen und liegt vor der Cloudflare-Access-Bypass-Regel
 * (Präfix-Regel, siehe zugangsverwaltung.ts). Diese Route ist Operator-only
 * und muss hinter Cloudflare Access bleiben.
 *
 * GET ?medium=<slug>
 *   → 200 { eintraege: FoerderhistorieZeile[] }  (nur aktive, neueste zuerst)
 *   → 400 { error }  medium fehlt
 *   → 403 { error }  gültige Portal-Session ohne Access-Header (Defense-in-
 *        depth wie zugangsverwaltung.ts: ein Medium darf diese Route nie sehen)
 *   → 502 { error }  Directus nicht erreichbar
 *   → 405            bei anderer Methode
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { istPortalZugriffAufProxy, ladeFoerderhistorie } from '@/lib/portal-guard'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const cfEmailHeader = req.headers['cf-access-authenticated-user-email'] as string | undefined
  if (istPortalZugriffAufProxy(req.headers.cookie, cfEmailHeader, process.env.PORTAL_SESSION_SECRET)) {
    return res.status(403).json({ error: 'Operator-Route, kein Portal-Zugriff.' })
  }

  const mediumRoh = req.query.medium
  const medium = typeof mediumRoh === 'string' ? mediumRoh.trim() : ''
  if (!medium) {
    return res.status(400).json({ error: 'medium (Slug) erforderlich.' })
  }

  res.setHeader('Cache-Control', 'no-store')
  try {
    const eintraege = await ladeFoerderhistorie(medium)
    return res.status(200).json({ eintraege })
  } catch (err: unknown) {
    console.error('foerderhistorie GET (Operator): Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}
