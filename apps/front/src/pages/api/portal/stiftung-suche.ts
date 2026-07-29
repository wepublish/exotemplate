/**
 * /api/portal/stiftung-suche: Namens-Typeahead für das Förderhistorie-Formular.
 *
 * GET ?q=<suchbegriff>
 *   → 200 { treffer: [{ id, name, sitz }] }  max. 8, alphabetisch; bei
 *        weniger als 2 Zeichen leer (kein Fehler: das Formular fragt bei
 *        jedem Tastendruck an)
 *   → 502 { error }  Directus nicht erreichbar
 *   → 401 { error } / 503 { error }  wie requirePortalSession
 *   → 405            bei anderer Methode
 *
 * Bewusst minimal (siehe sucheStiftungenFuerPortal): nur id/Name/Sitz, keine
 * Beträge, keine DNA, kein Blättern — die Stiftungsdatenbank bleibt hinter
 * den kuratierten Treffern, hier wird nur ein Name wiedergefunden, den das
 * Medium selbst nennt.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { requirePortalSession, sucheStiftungenFuerPortal } from '@/lib/portal-guard'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const session = requirePortalSession(req, res)
  if (!session) return

  res.setHeader('Cache-Control', 'no-store')

  const qRoh = req.query.q
  const q = typeof qRoh === 'string' ? qRoh.trim() : ''
  if (q.length < 2) {
    return res.status(200).json({ treffer: [] })
  }

  try {
    const treffer = await sucheStiftungenFuerPortal(q)
    return res.status(200).json({ treffer })
  } catch (err: unknown) {
    console.error('portal/stiftung-suche GET: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}
