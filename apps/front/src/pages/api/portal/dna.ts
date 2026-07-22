/**
 * /api/portal/dna: aktive DNA + Freigabe-Status des Session-Mediums (Task 7).
 *
 * GET → 200 { dna, freigegeben, freigegebenAm, pdfDaten }
 *   dna: {soundFeeling, tags:[{slug,label}], schaerfe, aktivSeit} | null,
 *     eigene Daten des Mediums, darum voll sichtbar (anders als Stiftungs-DNA
 *     /-Scores, die einem Medium nie gezeigt werden). null, solange keine
 *     aktive medium_dna existiert. Das ist KEIN Fehler.
 *   pdfDaten: GenerateDnaResult | null, Erweiterung über den Brief-Vertrag
 *     hinaus (siehe Task-7-Report, «DnaPdf-Klippe»): ein für die bestehende
 *     DnaPdf-Komponente passendes Objekt, rekonstruiert aus der aktiven
 *     medium_dna + faas_medien.arbeits_dna. null, wenn `dna` null ist.
 *   → 404 { error }  wenn das Medium nicht (mehr) existiert
 *   → 502 { error }  wenn Directus nicht erreichbar ist
 *
 * POST { aktion: 'freigeben' } → PATCH faas_medien.dna_medium_freigabe (+_von)
 *   + agent_vorschlaege-Zeile («DNA freigegeben: <medium>», Hinweis auf die
 *     Matching-Freischaltung) → 200 { status: 'ok', freigegebenAm }
 *   → 409 { error }  keine aktive DNA vorhanden, nichts freizugeben, auch
 *     nicht über einen direkten API-Aufruf (serverseitiges Gate spiegelt die
 *     UI-Bedingung: der Knopf existiert nur, wenn `dna` nicht null ist)
 *   → 422 { error }  aktion fehlt oder ist nicht 'freigeben'
 *   → 502 { error }  wenn Directus nicht erreichbar ist
 *
 *   → 401 { error }  ohne gültige Portal-Session
 *   → 503 { error }  wenn PORTAL_SESSION_SECRET fehlt
 *   → 405            bei anderer Methode
 *
 * Das Medium kommt in BEIDEN Richtungen ausschliesslich aus der Portal-
 * Session (`session.mediumSlug`), nie aus Query oder Body.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import {
  requirePortalSession,
  ladePortalMedium,
  ladeAktiveDnaDetails,
  ladeArbeitsDnaProfil,
  setzeDnaFreigabe,
  legeAgentVorschlagAn,
} from '@/lib/portal-guard'
import { baueDnaAnsicht, bauePdfDaten } from '@/lib/portal-dna'

async function handleGet(req: NextApiRequest, res: NextApiResponse, mediumSlug: string) {
  try {
    const [medium, dnaRoh] = await Promise.all([ladePortalMedium(mediumSlug), ladeAktiveDnaDetails(mediumSlug)])
    if (!medium) {
      return res.status(404).json({ error: 'Medium nicht gefunden.' })
    }
    if (!dnaRoh) {
      return res.status(200).json({ dna: null, freigegeben: false, freigegebenAm: null, pdfDaten: null })
    }

    const profil = await ladeArbeitsDnaProfil(mediumSlug)
    return res.status(200).json({
      dna: baueDnaAnsicht(dnaRoh),
      freigegeben: !!medium.dnaFreigabe,
      freigegebenAm: medium.dnaFreigabe,
      pdfDaten: bauePdfDaten(dnaRoh, profil),
    })
  } catch (err: unknown) {
    console.error('portal/dna GET: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse, mediumSlug: string, email: string) {
  const aktion = (req.body as { aktion?: unknown } | null)?.aktion
  if (aktion !== 'freigeben') {
    return res.status(422).json({ error: 'aktion muss "freigeben" sein.' })
  }

  try {
    const dnaRoh = await ladeAktiveDnaDetails(mediumSlug)
    if (!dnaRoh) {
      return res.status(409).json({ error: 'Keine aktive DNA vorhanden, es gibt nichts freizugeben.' })
    }

    const jetzt = new Date().toISOString()
    await setzeDnaFreigabe(mediumSlug, email, jetzt)
    await legeAgentVorschlagAn({
      typ: 'portal',
      status: 'offen',
      prioritaet: 'mittel',
      medium_id: mediumSlug,
      stiftung_id: null,
      titel: `DNA freigegeben: ${mediumSlug}`,
      beschreibung: `${mediumSlug} hat seine Fundraising-DNA im Portal freigegeben. Matching-Freischaltung prüfen.`,
      begruendung: '',
      frist: null,
      artefakt_link: null,
      quelle_modell: 'portal',
      erstellt_von: 'portal',
      mandant: 'wepublish',
      dedup_key: `portal|dna_freigabe|${mediumSlug}|${jetzt.slice(0, 10)}`,
    })

    return res.status(200).json({ status: 'ok', freigegebenAm: jetzt })
  } catch (err: unknown) {
    console.error('portal/dna POST: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = requirePortalSession(req, res)
  if (!session) return

  if (req.method === 'GET') return handleGet(req, res, session.mediumSlug)
  if (req.method === 'POST') return handlePost(req, res, session.mediumSlug, session.email)

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'Method Not Allowed' })
}
