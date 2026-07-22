/**
 * /api/outbox-send — fuehrt einen Outbox-Entwurf ueber den Host-Adapter aus.
 * Der Klick ist die Freigabe: der Adapter prueft Status + Allowlist hart und
 * versendet (Slack jetzt, Mail ab Phase 3). Slack-/Mail-Tokens bleiben
 * agentseitig — die App haelt keine Versand-Credentials.
 *
 * POST { id } → 200 { ok, status?, fehler? }
 */
import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, fehler: 'Nur POST.' })
  }
  const id = typeof req.body?.id === 'string' ? req.body.id.trim() : ''
  if (!id) return res.status(400).json({ ok: false, fehler: 'id erforderlich.' })

  const base = process.env.HERMES_API_URL
  if (process.env.FAAS_AGENT_ENABLED !== 'true' || !base) {
    return res.status(200).json({ ok: false, fehler: 'Versand-Dienst nicht aktiv.' })
  }
  const user =
    (req.headers['cf-access-authenticated-user-email'] as string | undefined) ?? 'team'
  try {
    const resp = await fetch(`${base.replace(/\/$/, '')}/outbox-senden`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, user }),
      signal: AbortSignal.timeout(25_000),
    })
    return res.status(200).json(await resp.json())
  } catch (err) {
    return res.status(200).json({
      ok: false,
      fehler: 'Versand-Dienst nicht erreichbar: ' + (err instanceof Error ? err.message : 'unbekannt'),
    })
  }
}
