/**
 * /api/portal/logout: Portal-Session beenden.
 *
 * POST → 200 { status: 'ok' }, löscht den Session-Cookie.
 *   → 503 { error } wenn PORTAL_SESSION_SECRET fehlt
 *   → 405            bei falscher Methode
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { holeSecretOderAntworte503 } from '@/lib/portal-guard'
import { baueLoeschCookie } from '@/lib/portal-session'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  if (!holeSecretOderAntworte503(res)) return

  res.setHeader('Set-Cookie', baueLoeschCookie())
  return res.status(200).json({ status: 'ok' })
}
