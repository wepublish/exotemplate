/**
 * /api/portal/einloesen: Magic-Link-Login einlösen (Schritt 2 von 2).
 *
 * Zwei-Schritt-Einlösung, damit ein GET den Einmal-Link NIE verbrennt: Mail-
 * Vorschau-Bots, Link-Prefetcher oder ein versehentlicher Operator-Klick auf
 * den Link lösen nichts aus. Erst der bewusste Formular-POST meldet an.
 *
 * GET ?token=<login-token>
 *   → 200 HTML-Bestätigungsseite («Anmelden im FaaS-Portal», Medium-Name,
 *     Formular-Button; method POST auf dieselbe Route, Token als hidden field).
 *     Verifiziert NUR das Token (Signatur, typ 'login', exp), löst nichts ein.
 *   → 302 /portal/login?fehler=1  bei fehlendem/ungültigem/abgelaufenem Token
 *
 * POST { token } (Formular der Bestätigungsseite)
 *   → 302 /portal                 bei Erfolg (Session-Cookie gesetzt)
 *   → 302 /portal/login?fehler=1  bei JEDEM Fehler (ungültiges Token,
 *     jti-Mismatch/schon eingelöst, Zugang nicht gefunden), bewusst ohne
 *     Detail, damit nichts über einzelne Zugänge preisgegeben wird
 *
 * Beide: 503 { error } wenn PORTAL_SESSION_SECRET fehlt, 405 bei anderer Methode.
 *
 * Die Einlösung selbst ist ATOMAR (loeseZugangEin): ein bedingter Directus-
 * PATCH mit Filter auf id UND login_jti aktualisiert genau dann eine Zeile,
 * wenn das jti noch gültig ist; 0 Zeilen heisst «schon eingelöst oder durch
 * einen neueren Link überschrieben» und führt zum Fehler-Redirect. Pro Zugang
 * ist immer nur der zuletzt ausgestellte Link gültig.
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { holeSecretOderAntworte503, findePortalZugang, loeseZugangEin, ladePortalMedium } from '@/lib/portal-guard'
import { verifyToken, erzeugeSessionToken, baueSetCookie } from '@/lib/portal-session'
import { schreibeMediumEvent } from '@/lib/medium-events'
import { tenant } from '../../../../config/tenant'

const FEHLER_REDIRECT = '/portal/login?fehler=1'

type LoginPayload = { email: string; mediumSlug: string; jti: string; typ: string }

/** Verifiziert ein Login-Token und liefert den Payload oder null. */
function leseLoginPayload(token: string, secret: string): LoginPayload | null {
  if (!token) return null
  const payload = verifyToken<LoginPayload>(token, secret)
  if (!payload || payload.typ !== 'login' || !payload.email || !payload.mediumSlug || !payload.jti) {
    return null
  }
  return payload
}

/** Minimales HTML-Escaping für Attribut- und Textkontext. */
function escapeHtml(wert: string): string {
  return wert.replace(/[&<>"']/g, (zeichen) => {
    switch (zeichen) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

/** Die Bestätigungsseite: bewusster Klick statt automatischer Einlösung. */
function baueBestaetigungsSeite(mediumName: string, email: string, token: string): string {
  const name = escapeHtml(mediumName)
  const mail = escapeHtml(email)
  const tokenAttr = escapeHtml(token)
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Anmelden im FaaS-Portal</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #f8f7f5; color: #210115;
         display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
  main { background: #fff; border: 1.5px solid #210115; border-radius: 8px; padding: 2.5rem;
         max-width: 26rem; margin: 1rem; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  p { line-height: 1.5; margin: 0 0 1.5rem; }
  button { background: #EB5851; color: #210115; border: 1.5px solid #210115; border-radius: 6px;
           padding: 0.75rem 1.5rem; font-size: 1rem; font-weight: 600; cursor: pointer; }
  button:hover { filter: brightness(1.05); }
</style>
</head>
<body>
<main>
  <h1>Anmelden im FaaS-Portal</h1>
  <p>Anmeldung für <strong>${name}</strong><br>Zugang: <strong>${mail}</strong></p>
  <form method="post" action="/api/portal/einloesen">
    <input type="hidden" name="token" value="${tokenAttr}">
    <button type="submit">Jetzt anmelden</button>
  </form>
</main>
</body>
</html>`
}

/** GET: Token prüfen und Bestätigungsseite zeigen. Löst NICHTS ein. */
async function zeigeBestaetigung(req: NextApiRequest, res: NextApiResponse, secret: string) {
  const token = typeof req.query.token === 'string' ? req.query.token : ''
  const payload = leseLoginPayload(token, secret)
  if (!payload) {
    return res.redirect(302, FEHLER_REDIRECT)
  }

  // Nur für die Anzeige; wenn Directus gerade nicht antwortet, reicht der Slug.
  const medium = await ladePortalMedium(payload.mediumSlug).catch(() => null)
  const name = medium?.name || payload.mediumSlug

  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  return res.status(200).send(baueBestaetigungsSeite(name, payload.email, token))
}

/** POST: die eigentliche, atomare Einlösung. */
async function loeseEin(req: NextApiRequest, res: NextApiResponse, secret: string) {
  const token = typeof req.body?.token === 'string' ? req.body.token : ''
  const payload = leseLoginPayload(token, secret)
  if (!payload) {
    return res.redirect(302, FEHLER_REDIRECT)
  }

  try {
    const zugang = await findePortalZugang(payload.email, tenant.key)
    if (!zugang || zugang.mediumSlug !== payload.mediumSlug) {
      return res.redirect(302, FEHLER_REDIRECT)
    }

    const eingeloest = await loeseZugangEin(zugang.id, payload.jti, new Date().toISOString())
    if (!eingeloest) {
      return res.redirect(302, FEHLER_REDIRECT)
    }

    // Roadmap-Ereignis (fire-and-forget): der erfolgreiche Login gehört zur
    // nachgezeichneten Geschichte des Mediums (Slack-Roadmap im Medien-Channel).
    void schreibeMediumEvent({
      medium_id: zugang.mediumSlug,
      typ: 'portal_login',
      titel: 'Im Portal angemeldet',
      actor: zugang.email,
    })

    const sessionToken = erzeugeSessionToken(zugang.email, zugang.mediumSlug, secret)
    const sessionPayload = verifyToken<{ exp: number }>(sessionToken, secret)
    const maxAge = sessionPayload ? Math.max(sessionPayload.exp - Math.floor(Date.now() / 1000), 0) : 0
    res.setHeader('Set-Cookie', baueSetCookie(sessionToken, maxAge))

    // Ziel mit eindeutigem Parameter, damit der Login an einer evtl. noch
    // gecachten /portal-Seite vorbei frisch startet (Cloudflare-Cache-Rest,
    // bis er abläuft bzw. gepurgt wird). Die Seite ignoriert den Parameter.
    return res.redirect(302, `/portal?e=${Date.now()}`)
  } catch (err: unknown) {
    console.error('einloesen: Verarbeitung fehlgeschlagen', err)
    return res.redirect(302, FEHLER_REDIRECT)
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const secret = holeSecretOderAntworte503(res)
  if (!secret) return

  if (req.method === 'GET') {
    return zeigeBestaetigung(req, res, secret)
  }
  return loeseEin(req, res, secret)
}
