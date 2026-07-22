/**
 * /api/gesuch-freigeben: Operator gibt das erfasste Gesuch fürs Medium frei (Task 11).
 *
 * POST { id }
 *   → 200 { status: 'ok' }
 *   → 400 { error }  id fehlt
 *   → 404 { error }  Application nicht gefunden
 *   → 422 { error }  portal.gesuch_text ist (noch) leer, ohne Text gibt es
 *        nichts freizugeben (erst gesuch-text-erfassen.ts aufrufen)
 *   → 502 { error }  Directus nicht erreichbar
 *   → 403 { error }  bei Portal-Session ohne Cloudflare-Access (Operator-only,
 *        istPortalZugriffAufProxy: Defense-in-depth)
 *   → 405            bei anderer Methode als POST
 *
 * Setzt `portal.freigegeben_am` (jetzt) + `portal.freigegeben_von`
 * (CF-Access-E-Mail, Fallback 'team'), read-modify-write des `portal`-json
 * (bestehende Felder wie angefordert_am/gesuch_text/beilagen bleiben
 * erhalten). Ab diesem Zeitpunkt sieht das Medium Gesuchtext und Beilagen im
 * Portal (siehe gesuchPortalStatus/GESUCH_STATUS_AB_BEREIT in portal-status.ts:
 * `freigegeben_am` gesetzt → Portal-Status 'bereit').
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { istPortalZugriffAufProxy } from '@/lib/portal-guard'
import { parsePortal } from '@/lib/portal-status'

const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const authHeaders = () => ({ Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}` })
const schreibHeaders = () => ({ ...authHeaders(), 'Content-Type': 'application/json' })

function leseId(body: unknown): string {
  const roh = (body as { id?: unknown } | null)?.id
  if (typeof roh === 'string') return roh.trim()
  if (typeof roh === 'number') return String(roh)
  return ''
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const cfEmailHeader = req.headers['cf-access-authenticated-user-email'] as string | undefined
  if (istPortalZugriffAufProxy(req.headers.cookie, cfEmailHeader, process.env.PORTAL_SESSION_SECRET)) {
    return res.status(403).json({ error: 'Operator-Route, kein Portal-Zugriff.' })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const id = leseId(req.body)
  if (!id) {
    return res.status(400).json({ error: 'id erforderlich.' })
  }

  try {
    const appRes = await fetch(`${base()}/items/applications/${encodeURIComponent(id)}?fields=id,portal`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(15_000),
    })
    if (appRes.status === 404) {
      return res.status(404).json({ error: 'Antrag nicht gefunden.' })
    }
    if (!appRes.ok) {
      throw new Error(`applications/${id}: Directus antwortete ${appRes.status}`)
    }
    const appJson = (await appRes.json()) as { data?: { portal?: unknown } | null }
    if (!appJson.data) {
      return res.status(404).json({ error: 'Antrag nicht gefunden.' })
    }
    const portal = parsePortal(appJson.data.portal)

    if (!portal.gesuch_text || !portal.gesuch_text.trim()) {
      return res.status(422).json({ error: 'Gesuchtext fehlt noch, zuerst erfassen.' })
    }

    const wer = cfEmailHeader ?? 'team'
    const jetztIso = new Date().toISOString()

    const patchRes = await fetch(`${base()}/items/applications/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: schreibHeaders(),
      body: JSON.stringify({
        portal: { ...portal, freigegeben_am: jetztIso, freigegeben_von: wer },
        verantwortung: wer,
        zuletzt_geaendert_quelle: 'matching-app',
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!patchRes.ok) {
      const text = await patchRes.text().catch(() => '')
      return res.status(502).json({ error: `Freigabe fehlgeschlagen (${patchRes.status}): ${text.slice(0, 200)}` })
    }

    return res.status(200).json({ status: 'ok' })
  } catch (err: unknown) {
    console.error('gesuch-freigeben POST: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}
