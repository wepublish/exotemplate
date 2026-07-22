/**
 * /api/portal/gesuche: Liste der Gesuche des Session-Mediums (Task 10).
 *
 * GET → 200 { gesuche: PortalGesuch[] }
 *   PortalGesuch = {id, stiftungName, status, angefordertAm, freigegebenAm,
 *     text, versionen, beilagen, abgeschicktAm, betragEingereicht}
 *   `status` kommt aus `gesuchPortalStatus` (portal-status.ts). `text` und
 *   `beilagen` sind NUR ab Status 'bereit' (siehe GESUCH_STATUS_AB_BEREIT)
 *   gefüllt, sonst null bzw. []. `versionen` ist immer gefüllt (in der
 *   Praxis vor 'bereit' ohnehin leer, da gesuch-text.ts erst ab 'bereit'/
 *   'final' schreiben darf).
 *   → 401 { error }  ohne gültige Portal-Session
 *   → 502 { error }  Directus nicht erreichbar
 *   → 503 { error }  wenn PORTAL_SESSION_SECRET fehlt
 *   → 405            bei anderer Methode
 *
 * Das Medium kommt ausschliesslich aus der Portal-Session
 * (`session.mediumSlug`), nie aus Query oder Body.
 *
 * FILTER-REGEL (Fix-Runde 1, Important 2): Zeigt NUR Applications mit
 * Portal-Bezug: `portal.angefordert_am` gesetzt (übers Portal angefordert,
 * anschreiben.ts) ODER `portal.freigegeben_am` gesetzt (vom Operator für den
 * Portal-Workflow freigegeben, Task 11). Applications OHNE portal-json bzw.
 * ohne diese beiden Felder (z. B. vom Operator direkt im Kanban angelegte
 * Anträge ausserhalb des Portal-Workflows) sind KEIN Portal-Gesuch und
 * erscheinen hier nicht (Leitplanke: Medien sehen NUR die kuratierte
 * Portal-Sicht, nie den vollen Operator-Kanban). Ausgeblendete
 * Marker-Applications (nicht-relevant.ts) sind ohnehin schon durch den
 * Directus-Filter (`status ≠ ausgeblendet`) draussen.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { requirePortalSession, type PortalGesuchApplicationPortalRoh } from '@/lib/portal-guard'
import { gesuchPortalStatus, GESUCH_STATUS_AB_BEREIT } from '@/lib/portal-status'
import { tenant } from '../../../../config/tenant'

const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const authHeaders = () => ({ Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}` })

type RohApplication = {
  id: string | number
  stiftung_id: string | number | null
  stiftung_name: string | null
  status: string | null
  portal: PortalGesuchApplicationPortalRoh | null
}

/**
 * true, wenn die Application einen Portal-Bezug hat (siehe FILTER-REGEL im
 * Modul-Kommentar oben): `portal.angefordert_am` ODER `portal.freigegeben_am`
 * gesetzt. Reine Funktion, kein IO, leicht für sich testbar.
 */
function hatPortalBezug(a: RohApplication): boolean {
  return !!(a.portal && (a.portal.angefordert_am || a.portal.freigegeben_am))
}

async function ladeApplications(mediumSlug: string): Promise<RohApplication[]> {
  const filter = encodeURIComponent(
    JSON.stringify({ medium_id: { _eq: mediumSlug }, mandant: { _eq: tenant.key }, status: { _neq: 'ausgeblendet' } }),
  )
  const felder = 'id,stiftung_id,stiftung_name,status,portal'
  const res = await fetch(`${base()}/items/applications?filter=${filter}&sort=-date_updated&limit=-1&fields=${felder}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`applications: Directus antwortete ${res.status}`)
  const json = (await res.json()) as { data?: RohApplication[] }
  return json.data ?? []
}

/**
 * Best-effort Nachlade der Stiftungsnamen für Applications OHNE
 * denormalisierten stiftung_name (Batch-Lookup, analog uebersicht.ts). Fehler
 * ergeben eine leere Map, statt die ganze Route scheitern zu lassen.
 */
async function ladeFehlendeStiftungsnamen(ids: number[]): Promise<Map<number, string>> {
  const namen = new Map<number, string>()
  if (ids.length === 0) return namen
  try {
    const filter = encodeURIComponent(JSON.stringify({ id: { _in: ids } }))
    const res = await fetch(`${base()}/items/stiftungen?filter=${filter}&limit=-1&fields=id,Stiftungsname`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return namen
    const json = (await res.json()) as { data?: Array<{ id: number | string; Stiftungsname?: string | null }> }
    for (const row of json.data ?? []) {
      if (row.Stiftungsname) namen.set(Number(row.id), row.Stiftungsname)
    }
  } catch (err: unknown) {
    console.error('gesuche: Stiftungsnamen nicht nachladbar', err)
  }
  return namen
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const session = requirePortalSession(req, res)
  if (!session) return

  try {
    const applications = (await ladeApplications(session.mediumSlug)).filter(hatPortalBezug)

    const fehlendeIds = [
      ...new Set(
        applications
          .filter((a) => !a.stiftung_name && a.stiftung_id != null)
          .map((a) => Number(a.stiftung_id))
          .filter((n) => Number.isFinite(n)),
      ),
    ]
    const nachgeladeneNamen = await ladeFehlendeStiftungsnamen(fehlendeIds)

    const gesuche = applications.map((a) => {
      const portal = a.portal ?? {}
      const status = gesuchPortalStatus({ status: a.status, portal })
      const abBereit = GESUCH_STATUS_AB_BEREIT.has(status)
      const stiftungName =
        a.stiftung_name || (a.stiftung_id != null ? nachgeladeneNamen.get(Number(a.stiftung_id)) ?? '' : '')

      return {
        id: String(a.id),
        stiftungName,
        status,
        angefordertAm: portal.angefordert_am ?? null,
        freigegebenAm: portal.freigegeben_am ?? null,
        text: abBereit ? portal.gesuch_text ?? '' : null,
        versionen: (portal.gesuch_versionen ?? []).map((v) => ({ ts: v.ts, von: v.von })),
        beilagen: abBereit
          ? (portal.beilagen ?? []).map((b) => ({ fileId: b.fileId ?? '', name: b.name ?? '' }))
          : [],
        abgeschicktAm: portal.abgeschickt_am ?? null,
        betragEingereicht: typeof portal.betrag_eingereicht_chf === 'number' ? portal.betrag_eingereicht_chf : null,
      }
    })

    return res.status(200).json({ gesuche })
  } catch (err: unknown) {
    console.error('portal/gesuche GET: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}
