import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Liefert den Gmail-Verbindungsstatus vom FaaS-Adapter (Spark-seitige Wahrheit).
 * GET /api/faas-readiness  ->  { gmail_connected: boolean }
 * Faellt sauber auf false zurück, wenn der Adapter nicht erreichbar/aktiv ist.
 */
export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const base = process.env.HERMES_API_URL
  if (process.env.FAAS_AGENT_ENABLED !== 'true' || !base) {
    return res.status(200).json({ gmail_connected: false })
  }
  try {
    const resp = await fetch(`${base.replace(/\/$/, '')}/faas-status`, {
      signal: AbortSignal.timeout(8_000),
    })
    const d = (await resp.json()) as { gmail_connected?: boolean }
    return res.status(200).json({ gmail_connected: !!d.gmail_connected })
  } catch {
    return res.status(200).json({ gmail_connected: false })
  }
}
