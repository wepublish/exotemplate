import crypto from 'node:crypto'
import {
  signToken,
  verifyToken,
  erzeugeLoginToken,
  erzeugeSessionToken,
  leseSessionAusCookie,
  baueSetCookie,
  baueLoeschCookie,
  PORTAL_COOKIE,
} from './portal-session'

const SECRET = 'test-geheimnis-1234'

describe('signToken / verifyToken', () => {
  it('Roundtrip: signierter Token liefert denselben Payload zurück', () => {
    const token = signToken({ email: 'redaktion@bajour.ch', typ: 'session' }, SECRET, 3600)
    const payload = verifyToken<{ email: string; typ: string; exp: number }>(token, SECRET)
    expect(payload).not.toBeNull()
    expect(payload?.email).toBe('redaktion@bajour.ch')
    expect(payload?.typ).toBe('session')
    expect(typeof payload?.exp).toBe('number')
  })

  it('falsches Secret liefert null', () => {
    const token = signToken({ email: 'a@b.ch', typ: 'session' }, SECRET, 3600)
    expect(verifyToken(token, 'ein-anderes-geheimnis')).toBeNull()
  })

  it('abgelaufener Token liefert null', () => {
    const token = signToken({ email: 'a@b.ch', typ: 'session' }, SECRET, -10)
    expect(verifyToken(token, SECRET)).toBeNull()
  })

  it('manipulierter Payload wird erkannt und liefert null', () => {
    const token = signToken({ email: 'echt@medium.ch', typ: 'session' }, SECRET, 3600)
    const punkt = token.indexOf('.')
    const payloadB64 = token.slice(0, punkt)
    const signatur = token.slice(punkt + 1)
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
    payload.email = 'geaendert@boese.ch'
    const manipulierterPayloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const manipulierterToken = `${manipulierterPayloadB64}.${signatur}`
    expect(verifyToken(manipulierterToken, SECRET)).toBeNull()
  })

  it('kaputter Token ohne Punkt-Trenner liefert null', () => {
    expect(verifyToken('keinPunktHierDrin', SECRET)).toBeNull()
  })
})

describe('erzeugeLoginToken / erzeugeSessionToken', () => {
  it('Login-Token trägt typ login, mediumSlug und jti', () => {
    const token = erzeugeLoginToken('redaktion@bajour.ch', 'bajour', 'jti-123', SECRET)
    const payload = verifyToken<{ email: string; mediumSlug: string; jti: string; typ: string }>(token, SECRET)
    expect(payload?.typ).toBe('login')
    expect(payload?.email).toBe('redaktion@bajour.ch')
    expect(payload?.mediumSlug).toBe('bajour')
    expect(payload?.jti).toBe('jti-123')
  })

  it('Login-Token verfällt praktisch nie (Entscheid 28.07.2026: exp weit in der Zukunft)', () => {
    const token = erzeugeLoginToken('redaktion@bajour.ch', 'bajour', 'jti-123', SECRET)
    const payload = verifyToken<{ exp: number }>(token, SECRET)
    const jetzt = Math.floor(Date.now() / 1000)
    const fuenfzigJahre = 50 * 365 * 24 * 60 * 60
    expect(payload!.exp).toBeGreaterThan(jetzt + fuenfzigJahre)
  })

  it('Session-Token trägt typ session mit 30-Tage-TTL', () => {
    const token = erzeugeSessionToken('redaktion@bajour.ch', 'bajour', SECRET)
    const payload = verifyToken<{ typ: string; exp: number }>(token, SECRET)
    expect(payload?.typ).toBe('session')
    const jetzt = Math.floor(Date.now() / 1000)
    const dreissigTage = 30 * 24 * 60 * 60
    expect(payload!.exp).toBeGreaterThan(jetzt + dreissigTage - 60)
    expect(payload!.exp).toBeLessThanOrEqual(jetzt + dreissigTage + 5)
  })
})

describe('leseSessionAusCookie', () => {
  it('gültiger Session-Token im Cookie liefert PortalSession', () => {
    const token = erzeugeSessionToken('redaktion@bajour.ch', 'bajour', SECRET)
    const cookieHeader = `${PORTAL_COOKIE}=${token}`
    const session = leseSessionAusCookie(cookieHeader, SECRET)
    expect(session).toEqual({ email: 'redaktion@bajour.ch', mediumSlug: 'bajour', rolle: 'medium' })
  })

  it('findet den Cookie auch inmitten mehrerer Cookies', () => {
    const token = erzeugeSessionToken('a@b.ch', 'ee-news', SECRET)
    const cookieHeader = `andererCookie=xyz; ${PORTAL_COOKIE}=${token}; nochEiner=1`
    const session = leseSessionAusCookie(cookieHeader, SECRET)
    expect(session?.mediumSlug).toBe('ee-news')
  })

  it('Login-Token (typ login) wird NICHT als Session akzeptiert', () => {
    const token = erzeugeLoginToken('redaktion@bajour.ch', 'bajour', 'jti-1', SECRET)
    const cookieHeader = `${PORTAL_COOKIE}=${token}`
    expect(leseSessionAusCookie(cookieHeader, SECRET)).toBeNull()
  })

  it('fehlender Cookie-Header liefert null', () => {
    expect(leseSessionAusCookie(undefined, SECRET)).toBeNull()
  })

  it('Cookie ohne den Portal-Namen liefert null', () => {
    expect(leseSessionAusCookie('andererCookie=xyz', SECRET)).toBeNull()
  })

  it('abgelaufener Session-Token im Cookie liefert null', () => {
    const token = signToken({ email: 'a@b.ch', mediumSlug: 'bajour', typ: 'session' }, SECRET, -5)
    const cookieHeader = `${PORTAL_COOKIE}=${token}`
    expect(leseSessionAusCookie(cookieHeader, SECRET)).toBeNull()
  })
})

describe('verifyToken: Härtung gegen überdimensionierten exp-Exponenten', () => {
  it('exp, das durch JSON-Zahlen-Overflow zu Infinity parst, wird abgelehnt', () => {
    // JSON erlaubt beliebig grosse Exponenten; JSON.parse('{"exp":1e400}') ergibt
    // in JS { exp: Infinity }. Ein reiner `typeof === 'number'`-Check hätte das
    // akzeptiert (Infinity ist ein number), und wegen `Infinity < jetzt`
    // (immer false) wäre der Token nie als abgelaufen erkannt worden: ein
    // praktisch nie ablaufender Token. Der Token wird hier manuell mit korrekter
    // Signatur gebaut, weil signToken() selbst kein derart grosses exp erzeugen kann.
    const payloadJson = '{"typ":"session","email":"a@b.ch","mediumSlug":"bajour","exp":1e400}'
    expect(JSON.parse(payloadJson).exp).toBe(Infinity)
    const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64url')
    const signatur = crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url')
    const token = `${payloadB64}.${signatur}`
    expect(verifyToken(token, SECRET)).toBeNull()
  })
})

describe('baueSetCookie / baueLoeschCookie', () => {
  it('Set-Cookie-String enthält HttpOnly, SameSite=Lax, Path, Secure und Max-Age', () => {
    const cookie = baueSetCookie('irgendein.token', 2592000)
    expect(cookie).toContain(`${PORTAL_COOKIE}=irgendein.token`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('Max-Age=2592000')
  })

  it('Löschungs-Cookie setzt Max-Age=0', () => {
    const cookie = baueLoeschCookie()
    expect(cookie).toContain(`${PORTAL_COOKIE}=`)
    expect(cookie).toContain('Max-Age=0')
    expect(cookie).toContain('HttpOnly')
  })

  it('wirft bei einem Token mit Cookie-Injection-Zeichen (z. B. Strichpunkt)', () => {
    expect(() => baueSetCookie('boesartig; Max-Age=999999', 3600)).toThrow()
  })

  it('wirft bei einem Token ohne Punkt-Trenner', () => {
    expect(() => baueSetCookie('keinPunktHierDrin', 3600)).toThrow()
  })

  it('akzeptiert einen echten, von signToken erzeugten Token', () => {
    const token = signToken({ typ: 'session' }, SECRET, 3600)
    expect(() => baueSetCookie(token, 3600)).not.toThrow()
  })
})
