/**
 * POST /api/gesuch-entwurf — «Entwurf jetzt»
 *
 * Stösst auf dem Host-Adapter einen sofortigen Sonnet-Gesuch-Entwurf für ein
 * Paket an (Fallback, wenn der nächtliche Studio-Gesuch-Loop nicht lief).
 * Async: der Adapter schreibt den Entwurf ins paket, die App pollt die
 * applications-Query, bis paket.gesuch_entwurf erscheint.
 *
 * Body: { id: string }  — applications-ID
 * Response: { status: 'gestartet' | 'läuft bereits' | ... }
 */

import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Nur POST erlaubt' })
    return
  }
  const base = process.env.HERMES_API_URL
  if (!base) {
    res.status(200).json({ status: 'error', note: 'HERMES_API_URL nicht gesetzt' })
    return
  }
  const { id } = req.body ?? {}
  if (!id || typeof id !== 'string') {
    res.status(400).json({ error: 'id (string) erforderlich' })
    return
  }
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/gesuch-entwurf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(15_000),
    })
    const j = await r.json()
    res.status(200).json(j)
  } catch (e: unknown) {
    res.status(502).json({
      error: 'Adapter nicht erreichbar: ' + (e instanceof Error ? e.message : String(e)),
    })
  }
}
