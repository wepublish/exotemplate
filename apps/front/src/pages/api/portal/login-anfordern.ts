/**
 * /api/portal/login-anfordern: Magic-Link-Login anfordern (Schritt 1 von 2).
 *
 * POST { email: string }
 *   → immer 200 { status: 'ok' }  (kein E-Mail-Enumerieren: die Antwort ist bei
 *     unbekannter Adresse, gesperrtem Zugang oder internem Fehler identisch)
 *   → 503 { error }               wenn PORTAL_SESSION_SECRET fehlt
 *   → 405                          bei falscher Methode
 *
 * Timing-Härtung: nach dem Zugangs-Lookup (genau EIN Directus-Call, in beiden
 * Zweigen) wird SOFORT geantwortet. Die Schreibarbeit bei einem Treffer läuft
 * danach fire-and-forget: Link erzeugen + persistieren (erzeugeZugangsLink,
 * portal-guard.ts, dieselbe Funktion, die auch die Operator-Zugangsverwaltung
 * für «Zugang anlegen» und «neuer Link» nutzt) und ein agent_vorschlaege-
 * Eintrag für den Operator (Link als Text in der Beschreibung, NICHT als
 * klickbares artefakt_link; dedupliziert pro E-Mail und Tag). Fehler in der
 * Nachbearbeitung werden nur geloggt, die Antwort ist dann längst raus.
 *
 * E-Mail-Normalisierung (trim + lowercase) übernimmt findePortalZugang;
 * Zugänge werden per Konvention lowercase angelegt.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import {
  holeSecretOderAntworte503,
  findePortalZugang,
  erzeugeZugangsLink,
  legeAgentVorschlagAn,
  existiertVorschlagMitDedupKey,
  baueLoginDedupKey,
  baueLoginVorschlag,
  type PortalZugang,
} from '@/lib/portal-guard'
import { tenant } from '../../../../config/tenant'

/** Schreibarbeit nach der Antwort: Link erzeugen + persistieren, Operator informieren. */
async function verarbeiteLoginAnfrage(zugang: PortalZugang, secret: string): Promise<void> {
  const link = await erzeugeZugangsLink(zugang.id, zugang.email, zugang.mediumSlug, secret)

  const dedupKey = baueLoginDedupKey(zugang.email, new Date())
  if (!(await existiertVorschlagMitDedupKey(dedupKey))) {
    await legeAgentVorschlagAn(
      baueLoginVorschlag({
        email: zugang.email,
        mediumSlug: zugang.mediumSlug,
        mandant: tenant.key,
        link,
        dedupKey,
      }),
    )
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const secret = holeSecretOderAntworte503(res)
  if (!secret) return

  const email = typeof req.body?.email === 'string' ? req.body.email : ''

  // Lookup VOR der Antwort (findePortalZugang normalisiert und fängt Fehler
  // selbst ab), Schreibarbeit NACH der Antwort: beide Zweige antworten nach
  // genau einem Directus-Call, die Antwortzeit verrät nicht, ob die Adresse
  // einen Zugang hat.
  const zugang = email.trim() ? await findePortalZugang(email, tenant.key) : null

  res.status(200).json({ status: 'ok' })

  if (!zugang) return
  void verarbeiteLoginAnfrage(zugang, secret).catch((err: unknown) => {
    console.error('login-anfordern: Nachbearbeitung fehlgeschlagen', err)
  })
}
