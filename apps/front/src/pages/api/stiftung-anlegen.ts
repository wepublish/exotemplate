import type { NextApiRequest, NextApiResponse } from 'next'
import {
  validiereStiftungEingabe,
  baueStiftungDaten,
  type StiftungLand,
} from '@/lib/stiftung-anlegen'

/**
 * /api/stiftung-anlegen — legt eine Stiftung manuell im Pool an und stösst
 * (best effort) sofort eine DNA-Messung auf dem Spark an, damit sie matchbar wird.
 *
 * POST { name, webseite, land, sitz? }
 *   → 200 { id, mess_status }   (mess_status: 'gestartet' | 'inactive' | 'fehler')
 *   → 400 { fehler: [...] }      bei Validierungsfehler
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Nur POST.' })

  const name = typeof req.body?.name === 'string' ? req.body.name : ''
  const webseite = typeof req.body?.webseite === 'string' ? req.body.webseite : ''
  const sitz = typeof req.body?.sitz === 'string' ? req.body.sitz : undefined
  const landRaw = typeof req.body?.land === 'string' ? req.body.land : 'CH'
  const land: StiftungLand = (['CH', 'AT', 'DE', 'INT'].includes(landRaw) ? landRaw : 'CH') as StiftungLand

  const fehler = validiereStiftungEingabe({ name, webseite })
  if (fehler.length > 0) return res.status(400).json({ fehler })

  const base = process.env.DIRECTUS_URL || 'http://localhost:8055'
  const token = process.env.DIRECTUS_TOKEN || ''

  // ── 1. Stiftung anlegen ──────────────────────────────────────────────────
  let neueId: number | null = null
  try {
    const r = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        query: `mutation($data: create_stiftungen_input!) {
          create_stiftungen_item(data: $data) { id Stiftungsname }
        }`,
        variables: { data: baueStiftungDaten({ name, webseite, land, sitz }) },
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const j = await r.json()
    if (j.errors) return res.status(502).json({ error: 'Directus: ' + JSON.stringify(j.errors).slice(0, 300) })
    neueId = Number(j?.data?.create_stiftungen_item?.id)
    if (!neueId || Number.isNaN(neueId)) return res.status(502).json({ error: 'Keine ID zurück.' })
  } catch (e) {
    return res.status(502).json({ error: 'Anlegen fehlgeschlagen: ' + (e instanceof Error ? e.message : 'unbekannt') })
  }

  // ── 2. DNA-Messung anstossen (best effort, async auf dem Spark) ───────────
  let mess_status = 'inactive'
  const adapter = process.env.HERMES_API_URL
  if (process.env.FAAS_AGENT_ENABLED === 'true' && adapter) {
    try {
      const resp = await fetch(`${adapter.replace(/\/$/, '')}/stiftung-messen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: neueId }),
        signal: AbortSignal.timeout(15_000),
      })
      const d = await resp.json()
      mess_status = d.status ?? 'unbekannt'
    } catch (e) {
      mess_status = 'fehler: ' + (e instanceof Error ? e.message : 'unbekannt')
    }
  }

  return res.status(200).json({ id: neueId, mess_status })
}
