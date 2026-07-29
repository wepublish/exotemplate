/**
 * /api/einladung-slack: postet die Onboarding-Einladung in den Slack-Kanal des
 * Mediums (Wunsch Ramona 29.07.2026: «via Slack verschicken, damit die
 * Kommunikation von Anfang an dort ist»).
 *
 * Operator-only, bewusst NICHT unter /api/portal/* (Cloudflare-Access-Präfix,
 * siehe zugangsverwaltung.ts).
 *
 * Die App hat KEINEN Slack-Token: sie schickt Slug und fertigen Text an den
 * Spark-Adapter (`/slack-nachricht`, faas_chat_adapter.py), der den Kanal aus
 * `faas_medien.slack_channel` auflöst und postet. Kein Codepfad zu einem
 * anderen Kanal.
 *
 * POST { medium_slug, medium_name }
 *   → 200 { ok: true, channel, ts }        gepostet
 *   → 200 { ok: false, note }              Slack-Dienst aus/nicht erreichbar,
 *        kein Kanal gesetzt (bewusst 200: die Oberfläche zeigt den Grund an und
 *        fällt auf den Mail-Weg zurück, statt einen Fehler zu werfen)
 *   → 400 { ok: false, note }              Felder fehlen
 *   → 403 { ok: false, note }              Portal-Session ohne Access-Header
 *   → 405
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { istPortalZugriffAufProxy } from '@/lib/portal-guard'
import { SLACK_EINLADUNG, LOGIN_TTL_STUNDEN_STANDARD, fuelleText } from '@/lib/portal-texte'
import { ABSENDER_STANDARD } from '@/lib/mail-vorlagen'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, note: 'Nur POST.' })
  }

  const cfEmailHeader = req.headers['cf-access-authenticated-user-email'] as string | undefined
  if (istPortalZugriffAufProxy(req.headers.cookie, cfEmailHeader, process.env.PORTAL_SESSION_SECRET)) {
    return res.status(403).json({ ok: false, note: 'Operator-Route, kein Portal-Zugriff.' })
  }

  const slug = typeof req.body?.medium_slug === 'string' ? req.body.medium_slug.trim() : ''
  const name = typeof req.body?.medium_name === 'string' ? req.body.medium_name.trim() : ''
  if (!slug || !name) {
    return res.status(400).json({ ok: false, note: 'medium_slug und medium_name erforderlich.' })
  }

  const base = process.env.HERMES_API_URL
  if (process.env.FAAS_AGENT_ENABLED !== 'true' || !base) {
    return res.status(200).json({ ok: false, note: 'Slack-Dienst nicht aktiv — bitte den Mail-Weg nutzen.' })
  }

  const portalBasis = (process.env.PORTAL_BASE_URL || '').replace(/\/$/, '')
  const text = fuelleText(SLACK_EINLADUNG, {
    medium: name,
    loginseite: `${portalBasis}/portal/login`,
    stunden: String(LOGIN_TTL_STUNDEN_STANDARD),
    absender: ABSENDER_STANDARD,
  })

  try {
    const resp = await fetch(`${base.replace(/\/$/, '')}/slack-nachricht`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ medium_slug: slug, text }),
      signal: AbortSignal.timeout(25_000),
    })
    const data = (await resp.json()) as { ok?: boolean; note?: string; channel?: string; ts?: string }
    return res.status(200).json(data)
  } catch (err) {
    return res.status(200).json({
      ok: false,
      note: 'Slack-Dienst nicht erreichbar: ' + (err instanceof Error ? err.message : 'unbekannt'),
    })
  }
}
