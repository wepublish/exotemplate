/**
 * /api/portal/gesuch-aktion: Statuswechsel eines Gesuchs durchs Medium (Task 10).
 *
 * POST { id, aktion: 'final'|'abgeschickt'|'zusage'|'absage', datum?, betrag?, grund? }
 *   → 200 { status: 'ok' }
 *   → 400 { error }  id oder aktion fehlt/ungültig
 *   → 404 { error }  Application nicht gefunden oder gehört nicht diesem Medium
 *   → 409 { grund }  aktueller Status (gesuchPortalStatus) erfüllt die
 *        Vorbedingung der Aktion nicht (STATUS_VORAUSSETZUNG, Fix-Runde 1,
 *        Important 1): kein Schreibzugriff.
 *   → 502 { error }  Directus nicht erreichbar
 *   → 401 { error } / 503 { error }  wie requirePortalSession
 *   → 405            bei anderer Methode
 *
 * Das Medium kommt ausschliesslich aus der Portal-Session
 * (`session.mediumSlug`), nie aus Query oder Body; `ladeApplicationFuerPortal`
 * verweigert (liefert null → 404) jede Application, die einem anderen Medium
 * gehört.
 *
 * Vier Aktionen, je EIN PATCH auf die Application (read-modify-write des
 * `portal`-json, bestehende Felder bleiben erhalten, kein Statuswechsel wird
 * hier neu erfunden: `bauStatusPatch`/`bauAbsageBemerkung` aus vorschlaege.ts
 * sind dieselben Helfer, die auch der Operator-Kanban (applications.tsx)
 * nutzt). Jede Aktion hat eine serverseitige Status-Vorbedingung
 * (STATUS_VORAUSSETZUNG unten): ohne sie könnte ein Medium den eigenen Antrag
 * direkt auf zusage/absage/abgeschickt zwingen, ohne dass der Operator je
 * bereit/final gesetzt oder das Gesuch tatsächlich abgeschickt hat. Ein
 * selbstgemeldeter `betrag_zugesagt_chf` würde sonst ungeprüft in die
 * Abrechnung fliessen.
 *   - final:       nur `portal.final_am` setzen, kein Application-Statuswechsel.
 *                   Vorbedingung: Status 'bereit'.
 *   - abgeschickt: `portal.abgeschickt_am` (datum oder jetzt) +
 *                  `portal.betrag_eingereicht_chf` (fehlender/ungültiger
 *                  Betrag lässt einen evtl. schon gesetzten Wert unangetastet)
 *                  + application `status:'eingereicht'` (+`eingereicht_am`
 *                  via bauStatusPatch). Vorbedingung: Status 'bereit' oder 'final'.
 *   - zusage:      application `status:'zugesagt'` + `betrag_zugesagt_chf`
 *                  (fehlender/ungültiger Betrag lässt einen evtl. schon
 *                  gesetzten Wert unangetastet) + `entschieden_am` via
 *                  bauStatusPatch. Vorbedingung: Status 'abgeschickt'.
 *   - absage:      application `status:'abgelehnt'` +
 *                  `bemerkung = bauAbsageBemerkung(alt, grund)` +
 *                  `entschieden_am` via bauStatusPatch. Vorbedingung: Status
 *                  'abgeschickt'.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { requirePortalSession, ladeApplicationFuerPortal, patchApplication } from '@/lib/portal-guard'
import { gesuchPortalStatus, type GesuchPortalStatus } from '@/lib/portal-status'
import { bauStatusPatch, bauAbsageBemerkung } from '@/lib/vorschlaege'
import { STATUS_STATION } from '@/graphql/applications.mutations'

type Aktion = 'final' | 'abgeschickt' | 'zusage' | 'absage'
const AKTIONEN: ReadonlySet<string> = new Set(['final', 'abgeschickt', 'zusage', 'absage'])

/**
 * Vorbedingung je Aktion: `gesuchPortalStatus` der Application MUSS in
 * `erlaubt` liegen, sonst 409 statt Schreibzugriff (siehe Modul-Kommentar).
 * `grund` ist ein stabiler, maschinenlesbarer Schlüssel (kein Fliesstext),
 * analog zu bestehenden `{grund:'...'}`-Antworten wie
 * `noch_nicht_freigeschaltet` in anschreiben.ts.
 */
const STATUS_VORAUSSETZUNG: Record<Aktion, { erlaubt: ReadonlySet<GesuchPortalStatus>; grund: string }> = {
  final: { erlaubt: new Set(['bereit']), grund: 'final_erfordert_status_bereit' },
  abgeschickt: { erlaubt: new Set(['bereit', 'final']), grund: 'abgeschickt_erfordert_status_bereit_oder_final' },
  zusage: { erlaubt: new Set(['abgeschickt']), grund: 'zusage_erfordert_status_abgeschickt' },
  absage: { erlaubt: new Set(['abgeschickt']), grund: 'absage_erfordert_status_abgeschickt' },
}

function leseId(body: unknown): string {
  const roh = (body as { id?: unknown } | null)?.id
  if (typeof roh === 'string') return roh.trim()
  if (typeof roh === 'number') return String(roh)
  return ''
}

/** null bei fehlendem/ungültigem Wert (Aufrufer entscheidet dann selbst über einen Fallback). */
function leseBetrag(roh: unknown): number | null {
  if (typeof roh === 'number' && Number.isFinite(roh)) return roh
  if (typeof roh === 'string' && roh.trim()) {
    const n = Number(roh.trim().replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Gültiges Datum als ISO-String, sonst null (Aufrufer fällt dann auf "jetzt" zurück). */
function leseDatumIso(roh: unknown): string | null {
  if (typeof roh !== 'string' || !roh.trim()) return null
  const d = new Date(roh)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const session = requirePortalSession(req, res)
  if (!session) return

  const body = req.body as { id?: unknown; aktion?: unknown; datum?: unknown; betrag?: unknown; grund?: unknown } | null
  const id = leseId(body)
  const aktionRoh = typeof body?.aktion === 'string' ? body.aktion : ''
  if (!id || !AKTIONEN.has(aktionRoh)) {
    return res.status(400).json({ error: 'id und aktion (final|abgeschickt|zusage|absage) erforderlich.' })
  }
  const aktion = aktionRoh as Aktion

  try {
    const app = await ladeApplicationFuerPortal(id, session.mediumSlug)
    if (!app) {
      return res.status(404).json({ error: 'Antrag nicht gefunden.' })
    }

    const aktuellerStatus = gesuchPortalStatus({ status: app.status, portal: app.portal })
    const voraussetzung = STATUS_VORAUSSETZUNG[aktion]
    if (!voraussetzung.erlaubt.has(aktuellerStatus)) {
      return res.status(409).json({ grund: voraussetzung.grund })
    }

    const jetzt = new Date()
    const jetztIso = jetzt.toISOString()
    const statusZeitstempel = { eingereicht_am: app.eingereichtAm, entschieden_am: app.entschiedenAm }

    if (aktion === 'final') {
      await patchApplication(id, {
        portal: { ...app.portal, final_am: jetztIso },
        verantwortung: session.email,
        zuletzt_geaendert_quelle: 'portal',
      })
      return res.status(200).json({ status: 'ok' })
    }

    if (aktion === 'abgeschickt') {
      const abgeschicktAm = leseDatumIso(body?.datum) ?? jetztIso
      const betrag = leseBetrag(body?.betrag) ?? app.portal.betrag_eingereicht_chf ?? null
      const statusPatch = bauStatusPatch('eingereicht', statusZeitstempel, jetzt)
      await patchApplication(id, {
        portal: { ...app.portal, abgeschickt_am: abgeschicktAm, betrag_eingereicht_chf: betrag },
        status: 'eingereicht',
        station: STATUS_STATION.eingereicht,
        verantwortung: session.email,
        zuletzt_geaendert_quelle: 'portal',
        ...statusPatch,
      })
      return res.status(200).json({ status: 'ok' })
    }

    if (aktion === 'zusage') {
      const betrag = leseBetrag(body?.betrag) ?? app.betragZugesagtChf ?? null
      const statusPatch = bauStatusPatch('zugesagt', statusZeitstempel, jetzt)
      await patchApplication(id, {
        status: 'zugesagt',
        station: STATUS_STATION.zugesagt,
        betrag_zugesagt_chf: betrag,
        verantwortung: session.email,
        zuletzt_geaendert_quelle: 'portal',
        ...statusPatch,
      })
      return res.status(200).json({ status: 'ok' })
    }

    // absage
    const grund = typeof body?.grund === 'string' ? body.grund : ''
    const bemerkung = bauAbsageBemerkung(app.bemerkung, grund)
    const statusPatch = bauStatusPatch('abgelehnt', statusZeitstempel, jetzt)
    await patchApplication(id, {
      status: 'abgelehnt',
      station: STATUS_STATION.abgelehnt,
      bemerkung,
      verantwortung: session.email,
      zuletzt_geaendert_quelle: 'portal',
      ...statusPatch,
    })
    return res.status(200).json({ status: 'ok' })
  } catch (err: unknown) {
    console.error('portal/gesuch-aktion POST: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}
