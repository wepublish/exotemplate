/**
 * /api/portal/gesuch-text: Medium speichert/überarbeitet seinen Gesuchtext (Task 10).
 *
 * POST { id, text }
 *   → 200 { status: 'ok', versionen: [{ts, von}] }
 *   → 400 { error }  id oder text fehlt/ungültig
 *   → 404 { error }  Application nicht gefunden oder gehört nicht diesem Medium
 *   → 409 { error }  Status ist weder 'bereit' noch 'final' (der Operator hat
 *        noch nicht freigegeben, oder das Gesuch ist bereits abgeschickt/
 *        entschieden: der Text ist dann nicht mehr editierbar)
 *   → 502 { error }  Directus nicht erreichbar
 *   → 401 { error } / 503 { error }  wie requirePortalSession
 *   → 405            bei anderer Methode
 *
 * Das Medium kommt ausschliesslich aus der Portal-Session
 * (`session.mediumSlug`), nie aus Query oder Body; `ladeApplicationFuerPortal`
 * verweigert (liefert null → 404) jede Application, die einem anderen Medium
 * gehört.
 *
 * Read-modify-write des `portal`-json: bestehende Felder (z. B. beilagen,
 * freigegeben_am, angefordert_am) bleiben erhalten, nur `gesuch_text` und
 * `gesuch_versionen` werden ergänzt/überschrieben (siehe
 * fuegeGesuchVersionHinzu, portal-status.ts: älteste Version kippt ab 20).
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { requirePortalSession, ladeApplicationFuerPortal, patchApplication } from '@/lib/portal-guard'
import { gesuchPortalStatus, fuegeGesuchVersionHinzu, type GesuchVersion } from '@/lib/portal-status'

function leseId(body: unknown): string {
  const roh = (body as { id?: unknown } | null)?.id
  if (typeof roh === 'string') return roh.trim()
  if (typeof roh === 'number') return String(roh)
  return ''
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const session = requirePortalSession(req, res)
  if (!session) return

  const id = leseId(req.body)
  const textRoh = (req.body as { text?: unknown } | null)?.text
  if (!id || typeof textRoh !== 'string') {
    return res.status(400).json({ error: 'id und text (String) erforderlich.' })
  }

  try {
    const app = await ladeApplicationFuerPortal(id, session.mediumSlug)
    if (!app) {
      return res.status(404).json({ error: 'Antrag nicht gefunden.' })
    }

    const status = gesuchPortalStatus({ status: app.status, portal: app.portal })
    if (status !== 'bereit' && status !== 'final') {
      return res.status(409).json({ error: 'Der Gesuchstext kann erst ab Status «bereit» bearbeitet werden.' })
    }

    const neueVersion: GesuchVersion = { ts: new Date().toISOString(), von: session.email }
    const versionen = fuegeGesuchVersionHinzu(app.portal.gesuch_versionen ?? [], neueVersion)
    const neuesPortal = { ...app.portal, gesuch_text: textRoh, gesuch_versionen: versionen }

    await patchApplication(id, {
      portal: neuesPortal,
      verantwortung: session.email,
      zuletzt_geaendert_quelle: 'portal',
    })

    return res.status(200).json({ status: 'ok', versionen })
  } catch (err: unknown) {
    console.error('portal/gesuch-text POST: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}
