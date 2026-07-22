/**
 * /api/onboarding-slack — schreibt den Onboarding-Plan eines Mediums in einen
 * Slack-Canvas. Der Slack-Token bleibt agentseitig (Host-Adapter); die App
 * leitet nur den fertigen Markdown weiter (kein Slack-Token in der App).
 *
 * POST { medium_slug, medium_name, website? } → 200 { ok, canvas_id?, neu?, note? }
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { bauOnboardingMarkdown } from '@/lib/onboarding-plan'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, note: 'Nur POST.' })
  }
  const slug = typeof req.body?.medium_slug === 'string' ? req.body.medium_slug.trim() : ''
  const name = typeof req.body?.medium_name === 'string' ? req.body.medium_name.trim() : ''
  const website = typeof req.body?.website === 'string' ? req.body.website.trim() : null
  if (!slug || !name) {
    return res.status(400).json({ ok: false, note: 'medium_slug und medium_name erforderlich.' })
  }

  const base = process.env.HERMES_API_URL
  if (process.env.FAAS_AGENT_ENABLED !== 'true' || !base) {
    return res.status(200).json({ ok: false, note: 'Slack-Dienst nicht aktiv.' })
  }
  try {
    const markdown = bauOnboardingMarkdown({ mediumName: name, website })
    const resp = await fetch(`${base.replace(/\/$/, '')}/onboarding-canvas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ medium_slug: slug, medium_name: name, markdown }),
      signal: AbortSignal.timeout(25_000),
    })
    const data = await resp.json()
    return res.status(200).json(data)
  } catch (err) {
    return res.status(200).json({
      ok: false,
      note: 'Slack-Dienst nicht erreichbar: ' + (err instanceof Error ? err.message : 'unbekannt'),
    })
  }
}
