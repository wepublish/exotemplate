import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Stösst die DNA-Messung + das Matching eines Projekts auf dem Spark an (async, ~5-6 Min).
 * Leitet an den Host-Adapter (FAAS-Chat-Adapter, /projekt-messen) weiter, der den
 * projekt_matcher als Hintergrund-Prozess startet. Die UI pollt danach den DNA-Stand.
 *
 * POST { projekt: <slug> }  →  200 { status: 'gestartet' | 'läuft bereits' | ... }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ status: 'error', note: 'Nur POST.' })
  const projekt = typeof req.body?.projekt === 'string' ? req.body.projekt.trim() : ''
  if (!projekt) return res.status(400).json({ status: 'error', note: 'projekt (slug) erforderlich.' })

  const base = process.env.HERMES_API_URL
  if (process.env.FAAS_AGENT_ENABLED !== 'true' || !base) {
    return res.status(200).json({ status: 'inactive', note: 'Mess-Dienst nicht aktiv.' })
  }
  try {
    const resp = await fetch(`${base.replace(/\/$/, '')}/projekt-messen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projekt }),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await resp.json()
    return res.status(200).json({ status: data.status ?? 'unbekannt' })
  } catch (err) {
    return res.status(200).json({
      status: 'error',
      note: 'Mess-Dienst nicht erreichbar: ' + (err instanceof Error ? err.message : 'unbekannt'),
    })
  }
}
