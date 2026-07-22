/**
 * /api/portal/me: Stammdaten + Freigabe-Status des eingeloggten Mediums.
 *
 * GET → 200 { email, medium: { slug, name }, freigeschaltet, dnaFreigabe, hatDna, hatLogo }
 *   → 401 { error }  ohne gültige Portal-Session
 *   → 404 { error }  wenn das Medium der Session nicht (mehr) existiert
 *   → 502 { error }  wenn Directus nicht erreichbar ist (statt Next-500)
 *   → 503 { error }  wenn PORTAL_SESSION_SECRET fehlt
 *   → 405            bei falscher Methode
 *
 * hatDna = aktive medium_dna existiert (Grundlage des DNA-Nav-Schlosses im
 * PortalLayout); dnaFreigabe = das Medium hat seine DNA im Portal freigegeben.
 * hatLogo = faas_medien.logo_hochgeladen ist true (echter PNG/JPG-Upload
 * über /api/portal/logo, NICHT nur ein gesetztes logo_url: das automatisch
 * abgerufene Favicon in medium-logo.ts setzt logo_url, aber NIE
 * logo_hochgeladen, siehe Fix-Runde 1): Grundlage des Logo-Pflicht-Erststeps
 * auf /portal/onboarding und des Erzeugungs-Gates auf /portal/dna.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { requirePortalSession, ladePortalMedium, hatAktiveMediumDna, type PortalMedium } from '@/lib/portal-guard'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const session = requirePortalSession(req, res)
  if (!session) return

  // Beide Helfer werfen bei Netz-/Directus-Fehlern (null bzw. false heisst
  // dort nur «nicht gefunden»), darum hier die saubere 502 statt Next-500.
  let medium: PortalMedium | null
  let hatDna: boolean
  try {
    ;[medium, hatDna] = await Promise.all([ladePortalMedium(session.mediumSlug), hatAktiveMediumDna(session.mediumSlug)])
  } catch (err: unknown) {
    console.error('me: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
  if (!medium) {
    return res.status(404).json({ error: 'Medium nicht gefunden.' })
  }

  return res.status(200).json({
    email: session.email,
    medium: { slug: medium.slug, name: medium.name },
    freigeschaltet: !!medium.matchingFreigeschaltet,
    dnaFreigabe: !!medium.dnaFreigabe,
    hatDna,
    hatLogo: !!medium.logoHochgeladen,
  })
}
