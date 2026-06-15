// Branded German subjects + absolute frontend activation/reset links for
// Directus' invite / password-reset mails, applied by the `email.send` filter
// hook (./index.ts).
//
// Why this exists: the /users/invite and /auth/password/request controllers
// don't forward a custom subject or invite_url, and the Directus admin UI sends
// neither — so Directus uses its hardcoded defaults. Without this:
//   - the subject is the English "You've been invited" → Scaleway rejects it
//     (550 5.0.0 Spam detected);
//   - the link is the default `PUBLIC_URL + /admin/accept-invite`, i.e. a
//     relative `/admin/accept-invite?token=…` that's broken and points at the
//     Directus admin app instead of our frontend.
// The `email.send` filter is the one place every send (admin UI included)
// passes through, so we normalize both there.

export const MAIL_SUBJECTS: Record<string, string> = {
  'user-invitation': 'Willkommen bei We.Publish ONE – Konto aktivieren',
  'password-reset': 'We.Publish ONE – Passwort zurücksetzen'
}

// Env var whose (comma-separated) allow-list holds the frontend page each
// template's link must point to. The first entry is the canonical frontend URL
// for the environment.
const TEMPLATE_URL_ALLOWLIST_ENV: Record<string, string> = {
  'user-invitation': 'USER_INVITE_URL_ALLOW_LIST',
  'password-reset': 'PASSWORD_RESET_URL_ALLOW_LIST'
}

// Returns the branded subject for a known invite/reset template, else the
// subject unchanged.
export function resolveMailSubject(
  templateName: string | undefined,
  currentSubject: string | undefined
): string | undefined {
  if (templateName && MAIL_SUBJECTS[templateName]) {
    return MAIL_SUBJECTS[templateName]
  }
  return currentSubject
}

function tokenFrom(url: string): string | null {
  const match = /[?&]token=([^&#]+)/.exec(url)
  return match ? match[1]! : null
}

function allowList(env: Record<string, unknown>, key: string): string[] {
  return String(env?.[key] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// Rewrites a known invite/reset link to an absolute, allow-listed frontend URL
// (preserving the token). Left unchanged when the link is already allow-listed
// (e.g. links our /team endpoint generated), when there's no token to carry
// over, or when nothing is allow-listed.
export function resolveMailUrl(
  templateName: string | undefined,
  currentUrl: unknown,
  env: Record<string, unknown>
): unknown {
  const envKey = templateName
    ? TEMPLATE_URL_ALLOWLIST_ENV[templateName]
    : undefined
  if (!envKey || typeof currentUrl !== 'string' || !currentUrl)
    return currentUrl

  const list = allowList(env, envKey)
  if (!list.length) return currentUrl

  const base = currentUrl.split('?')[0]!
  if (list.includes(base)) return currentUrl // already a frontend URL

  const token = tokenFrom(currentUrl)
  if (!token) return currentUrl

  return `${list[0]}?token=${token}`
}
