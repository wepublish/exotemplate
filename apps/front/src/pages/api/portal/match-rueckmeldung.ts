/**
 * /api/portal/match-rueckmeldung: das Medium meldet zu einem Treffer, dass er
 * nicht passt (Entscheid der Nutzerin 29.07.2026).
 *
 * POST { stiftung_id, notiz }
 *   → 200 { status: 'ok', freigabe_noetig: true }
 *     Die Rückmeldung wird als agent_lessons-Zeile mit `aktiv: false`
 *     gespeichert: sie liegt sicher in Directus, wirkt aber NICHT, bis
 *     We.Publish sie freigibt (/api/match-rueckmeldung, aktion freigeben).
 *     Zusätzlich entsteht ein agent_vorschlaege-Eintrag, damit die Freigabe im
 *     Operator-Cockpit und über den Wächter-Push in Slack auftaucht.
 *   → 400 { error }  stiftung_id/notiz fehlen oder sind zu kurz
 *   → 403 { grund: 'noch_nicht_freigeschaltet' }  Matching noch nicht frei
 *        (ohne Freischaltung sieht das Medium keine Treffer, zu denen es sich
 *        äussern könnte — dasselbe Gate wie /api/portal/nicht-relevant)
 *   → 404 { error }  Medium der Session existiert nicht (mehr)
 *   → 502 { error }  Directus nicht erreichbar
 *   → 401/503        wie requirePortalSession
 *   → 405            bei anderer Methode
 *
 * Das Medium kommt ausschliesslich aus der Portal-Session, nie aus dem Body.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import {
  requirePortalSession,
  ladePortalMedium,
  ladeStiftungName,
  legeAgentLessonAn,
  legeAgentVorschlagAn,
} from '@/lib/portal-guard'
import { parseRueckmeldung, bauRueckmeldungLesson, bauFreigabeVorschlag } from '@/lib/match-rueckmeldung'
import { schreibeMediumEvent } from '@/lib/medium-events'
import { tenant } from '../../../../config/tenant'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const session = requirePortalSession(req, res)
  if (!session) return

  const geprueft = parseRueckmeldung(req.body)
  if (!geprueft.ok) {
    return res.status(400).json({ error: geprueft.fehler })
  }

  try {
    const medium = await ladePortalMedium(session.mediumSlug)
    if (!medium) {
      return res.status(404).json({ error: 'Medium nicht gefunden.' })
    }
    if (!medium.matchingFreigeschaltet) {
      return res.status(403).json({ grund: 'noch_nicht_freigeschaltet' })
    }

    const stiftungName = geprueft.eingabe.stiftungName || (await ladeStiftungName(geprueft.eingabe.stiftungId))

    const lesson = await legeAgentLessonAn(
      bauRueckmeldungLesson({
        mediumId: session.mediumSlug,
        mandant: tenant.key,
        eingabe: geprueft.eingabe,
        quelle: 'portal',
      }),
      { mitId: true },
    )

    // Freigabe-Vorschlag für den Operator (fire-and-forget: die Rückmeldung ist
    // gespeichert, auch wenn die Benachrichtigung scheitert — sie erscheint
    // ohnehin in der Freigabe-Liste von /api/match-rueckmeldung).
    try {
      await legeAgentVorschlagAn(
        bauFreigabeVorschlag({
          mediumId: session.mediumSlug,
          mandant: tenant.key,
          stiftungName,
          stiftungId: geprueft.eingabe.stiftungId,
          notiz: geprueft.eingabe.notiz,
          lessonId: lesson?.id ?? `${session.mediumSlug}-${geprueft.eingabe.stiftungId}`,
        }),
      )
    } catch (err: unknown) {
      console.error('portal/match-rueckmeldung: Freigabe-Vorschlag nicht anlegbar', err)
    }

    void schreibeMediumEvent({
      medium_id: session.mediumSlug,
      typ: 'match_rueckmeldung',
      titel: `Rückmeldung zum Treffer ${stiftungName}`,
      detail: geprueft.eingabe.notiz.slice(0, 200),
      actor: session.email,
    })

    return res.status(200).json({ status: 'ok', freigabe_noetig: true })
  } catch (err: unknown) {
    console.error('portal/match-rueckmeldung POST: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}
