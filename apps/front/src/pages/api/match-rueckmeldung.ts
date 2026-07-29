/**
 * /api/match-rueckmeldung: Operator-Sicht auf Treffer-Rückmeldungen
 * («diese Stiftung passt überhaupt nicht, weil …»).
 *
 * Bewusst NICHT unter /api/portal/*: Operator-only, muss hinter Cloudflare
 * Access bleiben (Präfix-Regel, siehe zugangsverwaltung.ts).
 *
 * GET → 200 { offen: RueckmeldungZeile[] }
 *   Alle noch nicht freigegebenen Portal-Rückmeldungen des Mandanten
 *   (quelle portal, aktiv false), neueste zuerst — die Freigabe-Liste.
 *
 * POST { aktion: 'anlegen', stiftung_id, stiftung_name?, notiz, medium_id }
 *   → 200 { id }  Operator-Rückmeldung, SOFORT aktiv (wirkt beim nächsten
 *     Engine-Lauf, siehe load_match_rueckmeldungen)
 * POST { aktion: 'freigeben', id }
 *   → 200 { status: 'ok' }  setzt aktiv true (Portal-Rückmeldung wird wirksam)
 * POST { aktion: 'verwerfen', id }
 *   → 200 { status: 'ok' }  löscht die Zeile (nicht freigegeben, nicht wirksam)
 *
 *   → 400 { error }  Aktion/Felder fehlen oder ungültig
 *   → 403 { error }  gültige Portal-Session ohne Access-Header
 *   → 502 { error }  Directus nicht erreichbar
 *   → 405            bei anderer Methode
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { istPortalZugriffAufProxy } from '@/lib/portal-guard'
import {
  parseRueckmeldung,
  bauRueckmeldungLesson,
  MATCH_RUECKMELDUNG_KATEGORIE,
  type RueckmeldungZeile,
} from '@/lib/match-rueckmeldung'
import { tenant } from '../../../config/tenant'

const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const authHeaders = () => ({ Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}` })
const schreibHeaders = () => ({ ...authHeaders(), 'Content-Type': 'application/json' })

async function ladeOffene(): Promise<RueckmeldungZeile[]> {
  const filter = encodeURIComponent(
    JSON.stringify({
      kategorie: { _eq: MATCH_RUECKMELDUNG_KATEGORIE },
      quelle: { _eq: 'portal' },
      aktiv: { _eq: false },
      mandant: { _eq: tenant.key },
    }),
  )
  const res = await fetch(
    `${base()}/items/agent_lessons?filter=${filter}&sort=-ts&limit=100&fields=id,medium_id,stiftung_id,notiz,quelle,aktiv,ts`,
    { headers: authHeaders(), signal: AbortSignal.timeout(15_000) },
  )
  if (!res.ok) throw new Error(`agent_lessons: Directus antwortete ${res.status}`)
  const json = (await res.json()) as {
    data?: Array<{
      id: string
      medium_id?: string | null
      stiftung_id?: string | null
      notiz?: string | null
      quelle?: string | null
      aktiv?: boolean | null
      ts?: string | null
    }>
  }
  return (json.data ?? []).map((r) => ({
    id: String(r.id),
    mediumId: r.medium_id ?? '',
    stiftungId: r.stiftung_id ?? '',
    notiz: r.notiz ?? '',
    quelle: r.quelle ?? '',
    aktiv: !!r.aktiv,
    ts: r.ts ?? '',
  }))
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>
  const aktion = typeof body.aktion === 'string' ? body.aktion : ''

  if (aktion === 'anlegen') {
    const mediumId = typeof body.medium_id === 'string' ? body.medium_id.trim() : ''
    if (!mediumId) return res.status(400).json({ error: 'medium_id erforderlich.' })
    const geprueft = parseRueckmeldung(body)
    if (!geprueft.ok) return res.status(400).json({ error: geprueft.fehler })

    const anlage = await fetch(`${base()}/items/agent_lessons`, {
      method: 'POST',
      headers: schreibHeaders(),
      body: JSON.stringify(
        bauRueckmeldungLesson({ mediumId, mandant: tenant.key, eingabe: geprueft.eingabe, quelle: 'matching-app' }),
      ),
      signal: AbortSignal.timeout(15_000),
    })
    if (!anlage.ok) {
      const text = await anlage.text().catch(() => '')
      throw new Error(`agent_lessons anlegen (${anlage.status}): ${text.slice(0, 200)}`)
    }
    const json = (await anlage.json()) as { data?: { id?: string } }
    return res.status(200).json({ id: json.data?.id ?? null })
  }

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) return res.status(400).json({ error: 'id erforderlich.' })

  if (aktion === 'freigeben') {
    const patch = await fetch(`${base()}/items/agent_lessons/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: schreibHeaders(),
      body: JSON.stringify({ aktiv: true }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!patch.ok) throw new Error(`agent_lessons freigeben: Directus antwortete ${patch.status}`)
    return res.status(200).json({ status: 'ok' })
  }

  if (aktion === 'verwerfen') {
    const del = await fetch(`${base()}/items/agent_lessons/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders(),
      signal: AbortSignal.timeout(15_000),
    })
    if (!del.ok && del.status !== 404) throw new Error(`agent_lessons verwerfen: Directus antwortete ${del.status}`)
    return res.status(200).json({ status: 'ok' })
  }

  return res.status(400).json({ error: 'aktion muss anlegen, freigeben oder verwerfen sein.' })
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const cfEmailHeader = req.headers['cf-access-authenticated-user-email'] as string | undefined
  if (istPortalZugriffAufProxy(req.headers.cookie, cfEmailHeader, process.env.PORTAL_SESSION_SECRET)) {
    return res.status(403).json({ error: 'Operator-Route, kein Portal-Zugriff.' })
  }

  res.setHeader('Cache-Control', 'no-store')

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ offen: await ladeOffene() })
    }
    if (req.method === 'POST') {
      return await handlePost(req, res)
    }
  } catch (err: unknown) {
    console.error('match-rueckmeldung: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'Method Not Allowed' })
}
