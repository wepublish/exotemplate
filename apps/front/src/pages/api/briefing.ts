import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Morgenbriefing — holt vom FaaS-Adapter «Der Gerät» die LLM-formulierte, priorisierte
 * «Guten Morgen, das ist zu tun»-Ansage (1x täglich serverseitig gecacht).
 * GET /api/briefing  (oder ?force=1 für Neuformulierung).
 */

export type BriefingTodo = { text: string; aktion: string; medium: string }
export type Briefing = { gruss: string; todos: BriefingTodo[] }
type Resp = { status: 'ok'; briefing: Briefing } | { status: 'inactive' | 'error'; note: string }

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (process.env.FAAS_AGENT_ENABLED !== 'true') {
    return res.status(200).json({ status: 'inactive', note: 'Briefing nicht aktiv.' })
  }
  const base = process.env.HERMES_API_URL
  if (!base) return res.status(200).json({ status: 'error', note: 'HERMES_API_URL nicht gesetzt' })

  const force = req.query.force === '1' || (typeof req.body === 'object' && !!req.body?.force)
  try {
    const url = base.replace(/\/+$/, '') + '/briefing'
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.HERMES_API_KEY ? { Authorization: `Bearer ${process.env.HERMES_API_KEY}` } : {}),
      },
      body: JSON.stringify({ profile: 'faas', force }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!resp.ok) throw new Error(`Adapter HTTP ${resp.status}`)
    const data = (await resp.json()) as { briefing?: Briefing }
    const briefing: Briefing = data.briefing ?? { gruss: 'Guten Morgen!', todos: [] }
    return res.status(200).json({ status: 'ok', briefing })
  } catch (err) {
    return res.status(200).json({ status: 'error', note: err instanceof Error ? err.message : 'unbekannt' })
  }
}
