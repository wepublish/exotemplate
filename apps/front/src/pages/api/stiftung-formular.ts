/**
 * /api/stiftung-formular — liest und speichert die manuell erfasste
 * Einreichungs-Formularstruktur einer Stiftung (Feld `einreichung`, json).
 *
 * GET  ?stiftung_id=<id>           → 200 { einreichung: EinreichungsFormular | null }
 * PUT  { stiftung_id, einreichung } → 200 { ok: true }
 *
 * Server-seitiger Directus-Token; keine LLM, kein Versand. Die Struktur fliesst
 * in den Gesuch-Prompt (/api/gesuch-prompt), damit Opus den Text feldweise liefert.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import type { EinreichungsFormular } from '@/lib/gesuch-prompt'

const BASE = process.env.DIRECTUS_URL || 'http://localhost:8055'
const TOKEN = process.env.DIRECTUS_TOKEN || ''

function bereinige(roh: unknown): EinreichungsFormular {
  const o = (roh ?? {}) as Record<string, unknown>
  const felderRoh = Array.isArray(o.felder) ? o.felder : []
  const felder = felderRoh
    .map((f) => {
      const x = (f ?? {}) as Record<string, unknown>
      const feld = typeof x.feld === 'string' ? x.feld.trim() : ''
      if (!feld) return null
      const maxNum = Number(x.max)
      const einheit = x.einheit === 'woerter' ? 'woerter' : x.einheit === 'zeichen' ? 'zeichen' : null
      return {
        feld: feld.slice(0, 120),
        max: Number.isFinite(maxNum) && maxNum > 0 ? Math.round(maxNum) : null,
        einheit,
        hinweis: typeof x.hinweis === 'string' ? x.hinweis.trim().slice(0, 300) || null : null,
      }
    })
    .filter(Boolean)
  return {
    art: typeof o.art === 'string' ? o.art.trim().slice(0, 60) || null : null,
    hinweis: typeof o.hinweis === 'string' ? o.hinweis.trim().slice(0, 600) || null : null,
    felder: felder as EinreichungsFormular['felder'],
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const id = typeof req.query.stiftung_id === 'string' ? req.query.stiftung_id : ''
      if (!id) return res.status(400).json({ error: 'stiftung_id erforderlich' })
      const r = await fetch(
        `${BASE}/items/stiftungen/${encodeURIComponent(id)}?fields=einreichung`,
        { headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(15_000) },
      )
      const j = await r.json()
      return res.status(200).json({ einreichung: j?.data?.einreichung ?? null })
    }
    if (req.method === 'PUT') {
      const id = String(req.body?.stiftung_id ?? '')
      if (!id) return res.status(400).json({ error: 'stiftung_id erforderlich' })
      const einreichung = bereinige(req.body?.einreichung)
      const r = await fetch(`${BASE}/items/stiftungen/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ einreichung }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!r.ok) return res.status(500).json({ error: `Directus ${r.status}` })
      return res.status(200).json({ ok: true, einreichung })
    }
    res.setHeader('Allow', 'GET, PUT')
    return res.status(405).json({ error: 'Method Not Allowed' })
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Fehler' })
  }
}
