import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Pure helpers for the GitHub staff-login flow. Kept free of HTTP/Directus so
 * the security-critical bits (env gating, org+team membership check, signed
 * CSRF state) are unit-tested. The HTTP orchestration lives in ./index.ts.
 */

export interface GithubAuthConfig {
  clientId: string
  clientSecret: string
  org: string
  /** One or more allowed team slugs — membership in ANY grants access. */
  teams: string[]
  callbackUrl: string
  /** Frontend page that ingests the issued tokens. Derived from FRONTEND_DASHBOARD_URL. */
  successRedirect: string
}

/** Split a comma-separated team list into trimmed, non-empty slugs. */
export function parseTeams(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

const REQUIRED = [
  'GITHUB_OAUTH_CLIENT_ID',
  'GITHUB_OAUTH_CLIENT_SECRET',
  'GITHUB_OAUTH_ORG',
  'GITHUB_OAUTH_TEAM',
  'GITHUB_OAUTH_CALLBACK_URL',
  'FRONTEND_DASHBOARD_URL'
] as const

/**
 * Returns the config only when EVERY required env var is a non-empty string,
 * otherwise null. This is what gates the whole feature: no config → the status
 * endpoint reports disabled and the frontend hides the button.
 */
export function readGithubAuthConfig(
  env: Record<string, any>
): GithubAuthConfig | null {
  for (const key of REQUIRED) {
    if (!env[key] || typeof env[key] !== 'string') return null
  }
  const teams = parseTeams(env.GITHUB_OAUTH_TEAM)
  if (teams.length === 0) return null
  return {
    clientId: env.GITHUB_OAUTH_CLIENT_ID,
    clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
    org: env.GITHUB_OAUTH_ORG,
    teams,
    callbackUrl: env.GITHUB_OAUTH_CALLBACK_URL,
    successRedirect:
      env.FRONTEND_DASHBOARD_URL.replace(/\/+$/, '') + '/auth/github-callback'
  }
}

export function isGithubAuthEnabled(env: Record<string, any>): boolean {
  return readGithubAuthConfig(env) !== null
}

/**
 * Access requires active org membership AND active membership in at least one
 * of the configured teams. `teamStates` is the membership state per configured
 * team (null/undefined for teams the user isn't in).
 */
export function isAuthorizedMember(
  orgState: string | null | undefined,
  teamStates: (string | null | undefined)[]
): boolean {
  return orgState === 'active' && teamStates.some((s) => s === 'active')
}

export function githubExternalIdentifier(githubId: number | string): string {
  return `github:${githubId}`
}

export function makeNonce(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Stateless CSRF token: base64url(payload).hmac. Signed with the Directus
 * SECRET and time-bound, so the callback can verify it without server-side
 * storage.
 */
export function signState(secret: string, nonce: string, now: number): string {
  const payload = Buffer.from(JSON.stringify({ n: nonce, t: now })).toString(
    'base64url'
  )
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyState(
  secret: string,
  state: string,
  now: number,
  maxAgeMs: number = 10 * 60 * 1000
): boolean {
  const [payload, sig] = (state || '').split('.')
  if (!payload || !sig) return false

  const expected = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString())
    const t = parsed?.t
    return typeof t === 'number' && now - t >= 0 && now - t <= maxAgeMs
  } catch {
    return false
  }
}

export function buildAuthorizeUrl(
  config: GithubAuthConfig,
  state: string
): string {
  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.callbackUrl)
  url.searchParams.set('scope', 'read:org read:user user:email')
  url.searchParams.set('state', state)
  url.searchParams.set('allow_signup', 'false')
  return url.toString()
}
