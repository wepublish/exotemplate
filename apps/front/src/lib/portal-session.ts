import crypto from 'node:crypto'
import { LOGIN_TTL_STUNDEN_STANDARD } from './portal-texte'

// Grundlage des Medien-Portals: signierte Login-Tokens (Magic Link) und
// langlebige Session-Cookies. HMAC-signiert mit node:crypto, ohne
// zusätzliche Abhängigkeit (kein jose, kein jsonwebtoken).
//
// Format: base64url(JSON-Payload) + '.' + HMAC-SHA256(base64url-Teil, secret)
// Der Payload trägt immer `exp` (Unix-Sekunden) und `typ`.
//
// ENTSCHEID (28.07.2026, nach Sicherheitseinwand von Michael Scheurer): der
// Login-Link ist KURZLEBIG. Am Vormittag desselben Tages galt kurz das
// Gegenteil (dauerhaft gültiger Link, in der Einladungsmail mitgeschickt) —
// das ist zurückgenommen, aus zwei Gründen:
//   1. Ein dauerhaft gültiger Link in einer Mail ist ein Dauerschlüssel. Mails
//      werden weitergeleitet, landen in Archiven, Postfächer werden übernommen.
//   2. Die Einladungsmail trägt gar keinen Link mehr (siehe mail-vorlagen.ts):
//      sie verweist auf die Login-Seite, wo das Medium sich selbst einen Link
//      anfordert. Ein Link entsteht damit nur auf aktive Anforderung.
// Widerruf läuft zusätzlich über Daten: ein neu erzeugter Link ersetzt das
// gespeicherte login_jti, und ein gesperrter Zugang wird beim Einlösen
// abgewiesen. Die Session nach dem Einlösen bleibt 30 Tage bestehen, das
// Medium muss also nicht bei jedem Besuch einen neuen Link holen.

export type PortalSession = { email: string; mediumSlug: string; rolle: 'medium' }

export const PORTAL_COOKIE = 'faas_portal_session'

const DREISSIG_TAGE_SEKUNDEN = 30 * 24 * 60 * 60

/**
 * Gültigkeit des Login-Links in Sekunden, aus `PORTAL_LOGIN_TTL_STUNDEN`.
 *
 * Warum 8 Stunden und nicht 2: solange SMTP fehlt, wird ein angeforderter Link
 * nicht gemailt, sondern von einer Person aus dem Cockpit weitergeleitet. Ein
 * 2-Stunden-Link ist dann oft schon tot, bevor ihn jemand sieht. 8 Stunden
 * deckt einen Arbeitstag ab. Sobald der Versand automatisch läuft, gehört der
 * Wert auf 2 gestellt — dafür genügt die Umgebungsvariable, kein Code.
 *
 * Grenzen: mindestens 1 Stunde, höchstens 24. Ein unsinniger oder fehlender
 * Wert fällt auf die Vorgabe zurück, statt eine unbegrenzte Gültigkeit zu
 * erzeugen.
 */
// Record statt NodeJS.ProcessEnv, damit Tests ein kleines Objekt uebergeben
// koennen, ohne NODE_ENV mitzuschleppen; process.env erfuellt den Typ.
export function loginTokenTtlSekunden(env: Record<string, string | undefined> = process.env): number {
  const roh = Number(env.PORTAL_LOGIN_TTL_STUNDEN)
  const stunden = Number.isFinite(roh) && roh >= 1 && roh <= 24 ? roh : LOGIN_TTL_STUNDEN_STANDARD
  return Math.round(stunden * 60 * 60)
}

function erzeugeSignatur(payloadB64: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url')
}

/**
 * Signiert einen Payload. `exp` wird aus `ttlSeconds` berechnet und in den
 * Payload geschrieben (überschreibt ein evtl. vorhandenes `exp`-Feld).
 */
export function signToken(payload: Record<string, unknown>, secret: string, ttlSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const vollstaendigerPayload = { ...payload, exp }
  const payloadB64 = Buffer.from(JSON.stringify(vollstaendigerPayload), 'utf8').toString('base64url')
  const signatur = erzeugeSignatur(payloadB64, secret)
  return `${payloadB64}.${signatur}`
}

/**
 * Prüft Signatur (timingSafeEqual) und Ablauf (`exp`). Liefert den Payload
 * oder null bei ungültiger Signatur, kaputtem Format oder Ablauf.
 */
export function verifyToken<T = Record<string, unknown>>(token: string, secret: string): T | null {
  if (!token || typeof token !== 'string') return null
  const punktIndex = token.indexOf('.')
  if (punktIndex === -1) return null
  const payloadB64 = token.slice(0, punktIndex)
  const signatur = token.slice(punktIndex + 1)
  if (!payloadB64 || !signatur) return null

  const erwarteteSignatur = erzeugeSignatur(payloadB64, secret)
  const signaturBuf = Buffer.from(signatur, 'utf8')
  const erwarteteBuf = Buffer.from(erwarteteSignatur, 'utf8')
  // Längen-Check ZUERST: timingSafeEqual wirft bei unterschiedlicher Länge.
  if (signaturBuf.length !== erwarteteBuf.length) return null
  if (!crypto.timingSafeEqual(signaturBuf, erwarteteBuf)) return null

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    return null
  }

  // Number.isFinite statt typeof === 'number': lehnt auch NaN/Infinity ab.
  // Ein überdimensionierter Exponent im JSON (z. B. 1e400) parst in JS zu
  // Infinity, wäre mit dem reinen typeof-Check aber ein "number" gewesen und
  // hätte wegen `Infinity < jetzt === false` NIE ablaufen können
  // (ein praktisch nie ablaufender Token).
  if (!Number.isFinite(payload.exp as number)) return null
  const jetzt = Math.floor(Date.now() / 1000)
  if ((payload.exp as number) < jetzt) return null

  return payload as T
}

/** Magic-Link-Login-Token: kurzlebig (siehe Entscheid oben), typ 'login'. */
export function erzeugeLoginToken(email: string, mediumSlug: string, jti: string, secret: string): string {
  return signToken({ email, mediumSlug, jti, typ: 'login' }, secret, loginTokenTtlSekunden())
}

/** Session-Token: langlebig (30 Tage), typ 'session'. */
export function erzeugeSessionToken(email: string, mediumSlug: string, secret: string): string {
  return signToken({ email, mediumSlug, typ: 'session' }, secret, DREISSIG_TAGE_SEKUNDEN)
}

/**
 * Liest den Portal-Session-Cookie aus einem Cookie-Header und verifiziert ihn.
 * Akzeptiert NUR typ 'session' (ein Login-Token wird abgelehnt).
 */
export function leseSessionAusCookie(cookieHeader: string | undefined, secret: string): PortalSession | null {
  if (!cookieHeader) return null

  let tokenWert: string | undefined
  for (const teil of cookieHeader.split(';')) {
    const getrimmt = teil.trim()
    const gleichIndex = getrimmt.indexOf('=')
    if (gleichIndex === -1) continue
    const name = getrimmt.slice(0, gleichIndex)
    if (name === PORTAL_COOKIE) {
      tokenWert = getrimmt.slice(gleichIndex + 1)
      break
    }
  }
  if (!tokenWert) return null

  const payload = verifyToken<Record<string, unknown>>(tokenWert, secret)
  if (!payload) return null
  if (payload.typ !== 'session') return null
  if (typeof payload.email !== 'string' || typeof payload.mediumSlug !== 'string') return null

  return { email: payload.email, mediumSlug: payload.mediumSlug, rolle: 'medium' }
}

// Ein gültiger Token ist immer base64url(JSON) + '.' + base64url(HMAC): beide
// Teile bestehen nur aus [A-Za-z0-9_-]. Diese Prüfung schützt vor Cookie-
// Injection über den Token-Parameter (z. B. ein Aufrufer, der versehentlich
// oder böswillig `; Max-Age=0` oder Zeilenumbrüche in den Token schmuggelt).
const TOKEN_FORMAT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

/** Set-Cookie-String für die Session (Login setzt sie). */
export function baueSetCookie(token: string, maxAgeSeconds: number): string {
  if (!TOKEN_FORMAT.test(token)) {
    throw new Error('baueSetCookie: Token entspricht nicht dem erwarteten Format (base64url.base64url).')
  }
  return `${PORTAL_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Secure; Max-Age=${maxAgeSeconds}`
}

/** Set-Cookie-String zum Löschen der Session (Logout). */
export function baueLoeschCookie(): string {
  return `${PORTAL_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Secure; Max-Age=0`
}
