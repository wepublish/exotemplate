/**
 * /api/portal/uebersicht: Fortschritts-Stationen + Nächster-Schritt-Satz +
 * Nachfass-Reminder für die Portal-Startseite.
 *
 * GET → 200 { stationen, naechsterSchritt, reminder }  (Form siehe baueUebersicht,
 *        src/lib/portal-status.ts)
 *   → 401 { error }  ohne gültige Portal-Session
 *   → 404 { error }  wenn das Medium der Session nicht (mehr) existiert
 *   → 502 { error }  wenn Directus nicht erreichbar ist
 *   → 503 { error }  wenn PORTAL_SESSION_SECRET fehlt
 *   → 405            bei falscher Methode
 *
 * Die Route sammelt nur die Rohdaten (Directus REST); die eigentliche
 * Ableitung (Stationen-Status, Reminder-90-Tage-Regel) liegt rein und
 * getestet in src/lib/portal-status.ts.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { requirePortalSession, ladePortalMedium } from '@/lib/portal-guard'
import { baueUebersicht, type ReminderKandidat } from '@/lib/portal-status'

const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const authHeaders = () => ({ Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}` })

/** true, sobald mindestens ein medium_knowledge-Eintrag für dieses Medium existiert. */
async function hatMediumKnowledge(slug: string): Promise<boolean> {
  const filter = encodeURIComponent(JSON.stringify({ medium_id: { _eq: slug } }))
  const res = await fetch(`${base()}/items/medium_knowledge?filter=${filter}&limit=1&fields=id`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`medium_knowledge: Directus antwortete ${res.status}`)
  const json = (await res.json()) as { data?: unknown[] }
  return (json.data?.length ?? 0) > 0
}

type ApplicationRow = {
  id: string
  status: string | null
  zuletzt_geaendert_quelle: string | null
  stiftung_id: number | string | null
  stiftung_name: string | null
  portal: { abgeschickt_am?: string | null } | null
}

/** Alle Anträge dieses Mediums, mit den Feldern, die die Übersicht braucht. */
async function ladeApplications(slug: string): Promise<ApplicationRow[]> {
  const filter = encodeURIComponent(JSON.stringify({ medium_id: { _eq: slug } }))
  const felder = 'id,status,zuletzt_geaendert_quelle,stiftung_id,stiftung_name,portal'
  const res = await fetch(`${base()}/items/applications?filter=${filter}&limit=-1&fields=${felder}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`applications: Directus antwortete ${res.status}`)
  const json = (await res.json()) as { data?: ApplicationRow[] }
  return json.data ?? []
}

/**
 * Best-effort Nachlade der Stiftungsnamen für Anträge OHNE denormalisierten
 * stiftung_name (Batch-Lookup statt N Einzelabfragen). Fehler ergeben eine
 * leere Map statt zu werfen: ein fehlender Name lässt den Reminder trotzdem
 * erscheinen, nur ohne Stiftungsnamen im Text.
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
    console.error('uebersicht: Stiftungsnamen nicht nachladbar', err)
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
    const [medium, hatUnterlagen, applications] = await Promise.all([
      ladePortalMedium(session.mediumSlug),
      hatMediumKnowledge(session.mediumSlug),
      ladeApplications(session.mediumSlug),
    ])
    if (!medium) {
      return res.status(404).json({ error: 'Medium nicht gefunden.' })
    }

    const hatGesuchUeberPortal = applications.some((a) => a.zuletzt_geaendert_quelle === 'portal')

    // Batch-Nachlade nur für Kandidaten mit fehlendem Namen, die meisten
    // Anträge tragen stiftung_name bereits denormalisiert.
    const fehlendeIds = [
      ...new Set(
        applications
          .filter((a) => typeof a.portal?.abgeschickt_am === 'string' && !a.stiftung_name && a.stiftung_id != null)
          .map((a) => Number(a.stiftung_id))
          .filter((n) => Number.isFinite(n)),
      ),
    ]
    const nachgeladeneNamen = await ladeFehlendeStiftungsnamen(fehlendeIds)

    const reminderKandidaten: ReminderKandidat[] = applications
      .filter((a) => typeof a.portal?.abgeschickt_am === 'string')
      .map((a) => ({
        abgeschicktAm: a.portal!.abgeschickt_am as string,
        status: a.status ?? '',
        stiftungName: a.stiftung_name || (a.stiftung_id != null ? nachgeladeneNamen.get(Number(a.stiftung_id)) ?? null : null),
      }))

    const ergebnis = baueUebersicht(
      {
        // Provenienz, nicht blosse Datei-Anwesenheit (Fix-Runde 1, Critical):
        // logo_url kann auch ein automatisch abgerufenes Favicon sein.
        hatLogo: !!medium.logoHochgeladen,
        hatUnterlagen,
        dnaFreigegeben: medium.dnaFreigabe != null,
        freigeschaltet: medium.matchingFreigeschaltet != null,
        hatGesuchUeberPortal,
      },
      reminderKandidaten,
      new Date(),
    )

    // slackKanal geht mit: die Uebersichtsseite verweist auf den Slack-Kanal
    // des Mediums statt auf eine Mailadresse (Wunsch Michael Scheurer,
    // 28.07.2026: alle Kommunikation an einem Ort).
    return res.status(200).json({ ...ergebnis, slackKanal: medium.slackKanal })
  } catch (err: unknown) {
    console.error('uebersicht: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}
