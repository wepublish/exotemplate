import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * /api/drive-antraege-scan — listet die bestehenden Antrags-Ordner je Medium aus
 * dem Drive (über den Host-Adapter via rclone). Read-only.
 *
 * GET → 200 { ok, eintraege: { medium, ordner, unterordner, drive_url }[] }
 */
export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const base = process.env.HERMES_API_URL
  if (process.env.FAAS_AGENT_ENABLED !== 'true' || !base) {
    return res.status(200).json({ ok: false, fehler: 'Drive-Dienst nicht aktiv.', eintraege: [] })
  }
  try {
    const resp = await fetch(`${base.replace(/\/$/, '')}/drive-antraege-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(120_000),
    })
    return res.status(200).json(await resp.json())
  } catch (err) {
    return res.status(200).json({
      ok: false,
      fehler: 'Drive-Dienst nicht erreichbar: ' + (err instanceof Error ? err.message : 'unbekannt'),
      eintraege: [],
    })
  }
}
