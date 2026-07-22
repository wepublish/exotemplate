/**
 * /api/portal/nicht-relevant: Medium markiert einen Treffer als nicht relevant (Task 9).
 *
 * POST { stiftung_id, grund, freitext?: string }
 *   → 200 { status: 'ok' }
 *   → 400 { error }  stiftung_id fehlt/ungültig, ODER grund ist keiner der
 *        AUSBLENDE_GRUENDE-Schlüssel
 *   → 404 { error }  Medium der Session existiert nicht (mehr)
 *   → 403 { grund: 'noch_nicht_freigeschaltet' }  Matching noch nicht frei
 *        (Defense-in-depth: die Treffer-Seite selbst zeigt ohne Freischaltung
 *        ohnehin nichts anzuklicken, siehe /api/portal/treffer)
 *   → 502 { error }  Directus nicht erreichbar
 *   → 401 { error } / 503 { error }  wie requirePortalSession
 *   → 405            bei anderer Methode
 *
 * Legt, wie das bestehende Operator-seitige Ausblenden (MatchRow.tsx,
 * handleAusblenden), eine Marker-Application mit status 'ausgeblendet' an
 * (offene Treffer haben noch keine Application, siehe kuratiereTreffer in
 * portal-treffer.ts: eine ausgeblendet-Application lässt die Stiftung aus der
 * Treffer-Liste verschwinden) und schreibt eine agent_lessons-Zeile
 * (bauAusblendeLesson) für den Lern-Loop.
 *
 * Abweichung vom Operator-Weg (dokumentiert, siehe Task-9-Report): hier
 * tragen `verantwortung` und `zuletzt_geaendert_quelle` 'portal' statt der
 * Bediener-E-Mail bzw. 'matching-app', und die Lesson bekommt `quelle:
 * 'portal'` statt bauAusblendeLessons Default 'ausgeblendet'. So bleibt im
 * Lern-Loop unterscheidbar, ob ein Medium selbst ausgeblendet hat oder ein
 * Operator.
 *
 * Das Medium kommt ausschliesslich aus der Portal-Session
 * (`session.mediumSlug`), nie aus Query oder Body.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import {
  requirePortalSession,
  ladePortalMedium,
  ladeStiftungName,
  legeApplicationAn,
  legeAgentLessonAn,
  leseStiftungIdAusBody,
} from '@/lib/portal-guard'
import { AUSBLENDE_GRUENDE, bauAusblendeNotiz, bauAusblendeLesson } from '@/lib/ausblenden'
import { STATUS_STATION } from '@/graphql/applications.mutations'
import { tenant } from '../../../../config/tenant'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const session = requirePortalSession(req, res)
  if (!session) return

  const stiftungId = leseStiftungIdAusBody(req.body)
  if (stiftungId === null) {
    return res.status(400).json({ error: 'stiftung_id (gültige Zahl) erforderlich.' })
  }

  const grundRoh = (req.body as { grund?: unknown } | null)?.grund
  const grund = AUSBLENDE_GRUENDE.find((g) => g.key === grundRoh)
  if (!grund) {
    return res.status(400).json({ error: 'grund ungültig.' })
  }
  const freitextRoh = (req.body as { freitext?: unknown } | null)?.freitext
  const freitext = typeof freitextRoh === 'string' ? freitextRoh : undefined

  try {
    const medium = await ladePortalMedium(session.mediumSlug)
    if (!medium) {
      return res.status(404).json({ error: 'Medium nicht gefunden.' })
    }
    if (!medium.matchingFreigeschaltet) {
      return res.status(403).json({ grund: 'noch_nicht_freigeschaltet' })
    }

    const stiftungName = await ladeStiftungName(stiftungId)
    const bemerkung = bauAusblendeNotiz(stiftungName, grund.label, freitext)

    await legeApplicationAn({
      medium_id: session.mediumSlug,
      stiftung_id: stiftungId,
      stiftung_name: stiftungName,
      status: 'ausgeblendet',
      station: STATUS_STATION.ausgeblendet,
      mandant: tenant.key,
      verantwortung: session.email,
      zuletzt_geaendert_quelle: 'portal',
      bemerkung,
    })

    await legeAgentLessonAn({
      ...bauAusblendeLesson({
        mediumId: session.mediumSlug,
        stiftungId: String(stiftungId),
        stiftungName,
        grundKey: grund.key,
        grundLabel: grund.label,
        freitext,
      }),
      quelle: 'portal',
    })

    return res.status(200).json({ status: 'ok' })
  } catch (err: unknown) {
    console.error('portal/nicht-relevant POST: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}
