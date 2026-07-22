import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * /api/drive-ordner — legt den Stiftungs-Ordner im Anträge-Ordner des Mediums an
 * (über den Host-Adapter via rclone) und gibt dessen Drive-URL zurück. Die App
 * speichert die URL anschliessend als applications.drive_link.
 *
 * POST { ablage } → 200 { ok, url? , fehler? }
 * `ablage` ist der relative Pfad <medium>/02_antraege_work_in_progress/<stiftung>.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, fehler: 'Nur POST.' })
  }
  const ablage = typeof req.body?.ablage === 'string' ? req.body.ablage.trim() : ''
  if (!ablage) return res.status(400).json({ ok: false, fehler: 'ablage erforderlich.' })

  const base = process.env.HERMES_API_URL
  if (process.env.FAAS_AGENT_ENABLED !== 'true' || !base) {
    return res.status(200).json({ ok: false, fehler: 'Drive-Dienst nicht aktiv.' })
  }
  try {
    const resp = await fetch(`${base.replace(/\/$/, '')}/drive-ordner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ablage }),
      signal: AbortSignal.timeout(90_000),
    })
    return res.status(200).json(await resp.json())
  } catch (err) {
    return res.status(200).json({
      ok: false,
      fehler: 'Drive-Dienst nicht erreichbar: ' + (err instanceof Error ? err.message : 'unbekannt'),
    })
  }
}
