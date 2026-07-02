import { defineEndpoint } from '@directus/extensions-sdk'
import { randomBytes } from 'node:crypto'
import {
  buildAuthorizeUrl,
  githubExternalIdentifier,
  isAuthorizedMember,
  isGithubAuthEnabled,
  makeNonce,
  readGithubAuthConfig,
  signState,
  verifyState,
  type GithubAuthConfig
} from './github'

/**
 * GitHub staff login. A custom OAuth flow (not Directus native SSO) so we can
 * enforce membership in a specific org AND team before granting access. Every
 * setting comes from env; when incomplete the feature reports disabled and the
 * frontend hides the button. Verified staff are provisioned as Administrator
 * users keyed by their GitHub id (external_identifier), never hijacking an
 * existing email-based account.
 */

const GH_API = 'https://api.github.com'

interface GhResult {
  ok: boolean
  status: number
  json: any
}

async function ghGet(url: string, token: string): Promise<GhResult> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'wepublish-one-staff-auth'
    }
  })
  let json: any = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { ok: res.ok, status: res.status, json }
}

function frontendBase(config: GithubAuthConfig): string {
  // successRedirect is `<frontend>/auth/github-callback`
  return config.successRedirect.replace(/\/auth\/github-callback$/, '')
}

function failRedirect(config: GithubAuthConfig, reason: string): string {
  return `${frontendBase(config)}/auth/login?staff_error=${encodeURIComponent(reason)}`
}

export default defineEndpoint((router, context) => {
  const env = context.env
  const secret: string = env.SECRET

  // Public: lets the frontend decide whether to show the "Sign in with GitHub"
  // button. No auth — reveals only a boolean.
  router.get('/github/status', (_req: any, res: any) => {
    return res.json({ enabled: isGithubAuthEnabled(env) })
  })

  router.get('/github/login', (_req: any, res: any) => {
    const config = readGithubAuthConfig(env)
    if (!config)
      return res.status(404).send('GitHub staff login is not enabled')
    const state = signState(secret, makeNonce(), Date.now())
    return res.redirect(buildAuthorizeUrl(config, state))
  })

  router.get('/github/callback', async (req: any, res: any) => {
    const config = readGithubAuthConfig(env)
    if (!config)
      return res.status(404).send('GitHub staff login is not enabled')

    try {
      const { code, state } = req.query ?? {}
      if (!code || !state || !verifyState(secret, String(state), Date.now())) {
        return res.redirect(failRedirect(config, 'invalid_state'))
      }

      // 1) Exchange the code for a user access token.
      const tokenRes = await fetch(
        'https://github.com/login/oauth/access_token',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'wepublish-one-staff-auth'
          },
          body: JSON.stringify({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
            redirect_uri: config.callbackUrl
          })
        }
      )
      const tokenJson: any = await tokenRes.json().catch(() => null)
      const ghToken: string | undefined = tokenJson?.access_token
      if (!ghToken) return res.redirect(failRedirect(config, 'token_exchange'))

      // 2) Identify the user.
      const me = await ghGet(`${GH_API}/user`, ghToken)
      if (!me.ok || !me.json?.id || !me.json?.login) {
        return res.redirect(failRedirect(config, 'profile'))
      }
      const login: string = me.json.login
      const githubId: number = me.json.id

      let email: string | null =
        typeof me.json.email === 'string' ? me.json.email : null
      if (!email) {
        const emails = await ghGet(`${GH_API}/user/emails`, ghToken)
        if (Array.isArray(emails.json)) {
          const primary = emails.json.find(
            (e: any) => e?.primary && e?.verified && e?.email
          )
          email = primary?.email ?? null
        }
      }
      if (!email) return res.redirect(failRedirect(config, 'no_email'))

      // 3) Enforce org membership AND membership in at least one allowed team.
      const orgMembership = await ghGet(
        `${GH_API}/user/memberships/orgs/${encodeURIComponent(config.org)}`,
        ghToken
      )
      const teamStates = await Promise.all(
        config.teams.map(async (team) => {
          const m = await ghGet(
            `${GH_API}/orgs/${encodeURIComponent(config.org)}/teams/${encodeURIComponent(
              team
            )}/memberships/${encodeURIComponent(login)}`,
            ghToken
          )
          return m.json?.state as string | undefined
        })
      )
      if (!isAuthorizedMember(orgMembership.json?.state, teamStates)) {
        return res.redirect(failRedirect(config, 'not_authorized'))
      }

      // 4) Provision / resolve the Directus admin user, then issue a session.
      const { services, getSchema } = context
      const schema = await getSchema()
      const rolesService = new services.ItemsService('directus_roles', {
        schema
      })
      const adminRoles = await rolesService.readByQuery({
        filter: { admin_access: { _eq: true } },
        fields: ['id'],
        limit: 1
      })
      const adminRoleId = adminRoles?.[0]?.id
      if (!adminRoleId)
        return res.redirect(failRedirect(config, 'no_admin_role'))

      const usersService = new services.UsersService({ schema })
      const extId = githubExternalIdentifier(githubId)

      const existingByExt = await usersService.readByQuery({
        filter: { external_identifier: { _eq: extId } },
        fields: ['id', 'email'],
        limit: 1
      })

      // Fresh throwaway password: these accounts authenticate only via GitHub,
      // so we rotate it each login and use it to mint a real Directus session.
      const password = randomBytes(24).toString('base64url')
      let userId: string
      let userEmail: string

      if (existingByExt?.[0]) {
        userId = existingByExt[0].id
        userEmail = existingByExt[0].email
        await usersService.updateOne(userId, { password })
      } else {
        // Never hijack an existing (non-GitHub) account with the same email.
        const emailClash = await usersService.readByQuery({
          filter: { email: { _eq: email } },
          fields: ['id'],
          limit: 1
        })
        if (emailClash?.[0]) {
          return res.redirect(failRedirect(config, 'email_in_use'))
        }
        userId = await usersService.createOne({
          email,
          first_name: me.json.name ?? login,
          external_identifier: extId,
          provider: 'default',
          status: 'active',
          role: adminRoleId,
          password
        })
        userEmail = email
      }

      const authService = new services.AuthenticationService({
        accountability: null,
        schema
      })
      const { accessToken, refreshToken, expires } = await authService.login(
        'default',
        { email: userEmail, password }
      )

      // Hand tokens to the SPA via the URL fragment (not sent to servers/logs).
      const target = `${config.successRedirect}#access_token=${encodeURIComponent(
        accessToken
      )}&refresh_token=${encodeURIComponent(refreshToken)}&expires=${expires}`
      return res.redirect(target)
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[staff-auth] github callback failed:', err?.message ?? err)
      return res.redirect(failRedirect(config, 'server_error'))
    }
  })
})
