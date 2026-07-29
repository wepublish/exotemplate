/**
 * /api/portal/anschreiben: Medium fordert ein Gesuch für eine Stiftung an (Task 9).
 *
 * POST { stiftung_id, consent_bestaetigt?: boolean }
 *   → 200 { status: 'ok', application_id }
 *   → 409 { consent_noetig: true, text: CONSENT_TEXT }  Voll-Consent nötig
 *        (siehe brauchtVollConsent in consent.ts), aber consent_bestaetigt
 *        fehlt oder ist nicht true. Schreibt NICHTS; das Medium bestätigt im
 *        ConsentDialog (voll=true) und postet erneut mit consent_bestaetigt:true.
 *   → 409 { consent_kurz: true }  Voll-Consent liegt bereits in der aktuellen
 *        Textversion vor (Folge-Gesuch), aber consent_bestaetigt fehlt oder
 *        ist nicht true. Schreibt NICHTS; das Medium bestätigt im
 *        ConsentDialog (voll=false, Kurzfassung) und postet erneut mit
 *        consent_bestaetigt:true. So bekommt JEDES Gesuch (erstes = Volltext,
 *        jedes weitere = Kurzfassung) eine eigene protokollierte Bestätigung
 *        (Fix-Runde 1: vorher ging ein Folge-Gesuch ohne jede Rückfrage durch).
 *   → 409 { bereits_vorhanden: true }  für dieses Medium+Stiftung-Paar
 *        existiert schon eine nicht-ausgeblendete Application.
 *   → 400 { error }  stiftung_id fehlt oder ist keine gültige Zahl
 *   → 404 { error }  Medium der Session existiert nicht (mehr)
 *   → 403 { grund: 'noch_nicht_freigeschaltet' }  Matching noch nicht frei
 *        (dasselbe Gate wie /api/portal/treffer: ohne Freischaltung gibt es
 *        für dieses Medium noch keine geprüften Treffer, die es anschreiben
 *        könnte)
 *   → 502 { error }  Directus nicht erreichbar
 *   → 401 { error } / 503 { error }  wie requirePortalSession
 *   → 405            bei anderer Methode
 *
 * Das Medium kommt ausschliesslich aus der Portal-Session
 * (`session.mediumSlug`), nie aus Query oder Body.
 *
 * Ablauf bei Erfolg, SELBSTHEILEND in zwei durablen Schritten (Fix-Runde 1;
 * siehe consent.ts: Modul-Kommentar zu baueGesuchAuftrag). Vorher wurde erst
 * die Application angelegt und danach per PATCH um das `portal`-json ergänzt,
 * schlug der PATCH fehl, blieb eine Application OHNE consent_id liegen, die
 * der Doppel-Schutz (existiertOffeneApplication) beim Retry als
 * `bereits_vorhanden` blockiert hätte. Jetzt:
 *   1. consent_log-Zeile schreiben (kontext 'erstgesuch', wenn dies das
 *      allererste Gesuch dieses Mediums ist, keine consent_log-Zeile
 *      existierte vor diesem Request, sonst `gesuch:<stiftung_id>`; siehe
 *      Report für die Begründung der Abweichung vom Brief-`gesuch:<app-id>`).
 *      Schlägt dieser Schritt fehl, ist NICHTS angelegt, ein Retry startet sauber.
 *   2. Application MIT eingebettetem `portal`-json (inkl. der echten
 *      `consent_id` aus Schritt 1) in EINEM Create anlegen. Schlägt dieser
 *      Schritt fehl, bleibt höchstens eine verwaiste consent_log-Zeile übrig
 *      (harmlos, keine Application), ein Retry legt sauber neu an, weil
 *      existiertOffeneApplication keine Application findet.
 *   3. agent_vorschlaege-Zeile für den Operator (dedupliziert über einen
 *      festen Schlüssel je Medium+Stiftung: diese Aktion ist ohnehin durch
 *      den Doppel-Schutz auf höchstens einmal pro Paar begrenzt).
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import {
  requirePortalSession,
  ladePortalMedium,
  existiertOffeneApplication,
  ladeConsentLogs,
  legeApplicationAn,
  legeConsentLogAn,
  ladeStiftungName,
  leseStiftungIdAusBody,
  ladeEigenesProjektFuerPortal,
  legeAgentVorschlagAn,
  existiertVorschlagMitDedupKey,
} from '@/lib/portal-guard'
import { CONSENT_TEXT, CONSENT_TEXT_VERSION, brauchtVollConsent, baueGesuchAuftrag } from '@/lib/consent'
import { schreibeMediumEvent } from '@/lib/medium-events'
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
  const stiftungIdStr = String(stiftungId)
  const consentBestaetigt = (req.body as { consent_bestaetigt?: unknown } | null)?.consent_bestaetigt === true
  // Optionales Projekt (29.07.2026): ein Gesuch kann für das Medium als Ganzes
  // ODER für ein Projekt des Mediums angefordert werden. Ohne projekt_id
  // bleibt alles wie bisher.
  const projektIdRoh = (req.body as { projekt_id?: unknown } | null)?.projekt_id
  const projektId =
    typeof projektIdRoh === 'number'
      ? projektIdRoh
      : typeof projektIdRoh === 'string' && projektIdRoh.trim()
        ? parseInt(projektIdRoh, 10)
        : null
  if (projektIdRoh != null && (!Number.isFinite(projektId) || (projektId as number) <= 0)) {
    return res.status(400).json({ error: 'projekt_id muss eine gültige Nummer sein.' })
  }

  try {
    const medium = await ladePortalMedium(session.mediumSlug)
    if (!medium) {
      return res.status(404).json({ error: 'Medium nicht gefunden.' })
    }

    // Projekt-Gesuche brauchen KEINE Matching-Freischaltung: die Projekt-Treffer
    // entstehen erst, wenn das Medium den Mess-Lauf selbst angestossen hat
    // (siehe /api/portal/projekt-treffer). Für Medium-Gesuche bleibt das Gate.
    let projekt: { id: number; name: string } | null = null
    if (projektId) {
      projekt = await ladeEigenesProjektFuerPortal(projektId, session.mediumSlug)
      if (!projekt) {
        return res.status(404).json({ error: 'Projekt nicht gefunden.' })
      }
    } else if (!medium.matchingFreigeschaltet) {
      return res.status(403).json({ grund: 'noch_nicht_freigeschaltet' })
    }

    if (await existiertOffeneApplication(session.mediumSlug, stiftungId, projektId)) {
      return res.status(409).json({ bereits_vorhanden: true })
    }

    const logs = await ladeConsentLogs(session.mediumSlug)
    if (!consentBestaetigt) {
      if (brauchtVollConsent(logs)) {
        return res.status(409).json({ consent_noetig: true, text: CONSENT_TEXT })
      }
      return res.status(409).json({ consent_kurz: true })
    }

    const jetzt = new Date()
    const istErstesGesuch = logs.length === 0
    const kontext = istErstesGesuch ? 'erstgesuch' : `gesuch:${stiftungIdStr}`

    // Schritt 1 (durabel, siehe Modul-Kommentar oben): consent_log-Zeile
    // ZUERST schreiben. Schlägt dieser Aufruf fehl, ist noch nichts angelegt.
    const consentRow = await legeConsentLogAn({
      medium_slug: session.mediumSlug,
      email: session.email,
      mandant: tenant.key,
      text_version: CONSENT_TEXT_VERSION,
      bestaetigt_am: jetzt.toISOString(),
      kontext,
    })

    // Schritt 2: Application MIT der echten consent_id in EINEM Create
    // anlegen (kein PATCH mehr nötig). stiftung_name ist Pflichtfeld auf
    // applications (nicht Teil von baueGesuchAuftrag, siehe consent.ts: die
    // reine Funktion kennt den Namen nicht) und wird hier ergänzt.
    const stiftungName = await ladeStiftungName(stiftungId)
    const { applicationDaten, portalJson } = baueGesuchAuftrag(session, stiftungIdStr, String(consentRow.id), jetzt)
    const neueApp = await legeApplicationAn({
      ...applicationDaten,
      stiftung_name: stiftungName,
      portal: portalJson,
      ...(projektId ? { projekt_id: projektId } : {}),
    })

    // Roadmap-Ereignis (fire-and-forget): die Stiftungswahl durchs Medium ist
    // eine Station der Slack-Roadmap im Medien-Channel.
    void schreibeMediumEvent({
      medium_id: session.mediumSlug,
      typ: 'stiftung_gewaehlt',
      titel: projekt
        ? `Stiftung ausgewählt für Projekt «${projekt.name}»: ${stiftungName}`
        : `Stiftung ausgewählt: ${stiftungName}`,
      actor: session.email,
    })

    const dedupKey = `portal|anschreiben|${session.mediumSlug}|${stiftungId}`
    if (!(await existiertVorschlagMitDedupKey(dedupKey))) {
      await legeAgentVorschlagAn({
        typ: 'portal',
        status: 'offen',
        prioritaet: 'mittel',
        medium_id: session.mediumSlug,
        stiftung_id: stiftungIdStr,
        stiftung_name: stiftungName,
        titel: `Gesuch angefordert: ${medium.name} × ${stiftungName}`,
        beschreibung: `${medium.name} hat über das Portal ein Gesuch für «${stiftungName}» angefordert.`,
        begruendung: '',
        frist: null,
        artefakt_link: null,
        quelle_modell: 'portal',
        erstellt_von: 'portal',
        mandant: tenant.key,
        dedup_key: dedupKey,
      })
    }

    return res.status(200).json({ status: 'ok', application_id: neueApp.id })
  } catch (err: unknown) {
    console.error('portal/anschreiben POST: Directus nicht erreichbar', err)
    return res.status(502).json({ error: 'Daten momentan nicht verfügbar' })
  }
}
