import { describe, it, expect } from 'vitest'
import {
  readGithubAuthConfig,
  isGithubAuthEnabled,
  isAuthorizedMember,
  githubExternalIdentifier,
  signState,
  verifyState,
  buildAuthorizeUrl
} from './github'

const fullEnv = {
  GITHUB_OAUTH_CLIENT_ID: 'cid',
  GITHUB_OAUTH_CLIENT_SECRET: 'csecret',
  GITHUB_OAUTH_ORG: 'wepublish',
  GITHUB_OAUTH_TEAM: 'staff',
  GITHUB_OAUTH_CALLBACK_URL: 'https://cms.example/staff-auth/github/callback',
  FRONTEND_DASHBOARD_URL: 'https://one.example/'
}

describe('readGithubAuthConfig', () => {
  it('returns a config when every required var is present', () => {
    const cfg = readGithubAuthConfig(fullEnv)
    expect(cfg).not.toBeNull()
    expect(cfg?.org).toBe('wepublish')
    expect(cfg?.teams).toEqual(['staff'])
    // success redirect is derived from the frontend URL, trailing slash trimmed
    expect(cfg?.successRedirect).toBe(
      'https://one.example/auth/github-callback'
    )
  })

  it('parses a comma-separated list of teams', () => {
    const cfg = readGithubAuthConfig({
      ...fullEnv,
      GITHUB_OAUTH_TEAM: 'staff, admins ,  developers'
    })
    expect(cfg?.teams).toEqual(['staff', 'admins', 'developers'])
  })

  it('accepts an array for teams (Directus casts comma values to arrays)', () => {
    const cfg = readGithubAuthConfig({
      ...fullEnv,
      GITHUB_OAUTH_TEAM: ['administration-access', 'infrastructure']
    })
    expect(cfg?.teams).toEqual(['administration-access', 'infrastructure'])
  })

  it('returns null when any required var is missing', () => {
    for (const key of Object.keys(fullEnv)) {
      const partial: Record<string, any> = { ...fullEnv }
      delete partial[key]
      expect(readGithubAuthConfig(partial)).toBeNull()
    }
  })

  it('returns null for empty-string values', () => {
    expect(
      readGithubAuthConfig({ ...fullEnv, GITHUB_OAUTH_ORG: '' })
    ).toBeNull()
  })
})

describe('isGithubAuthEnabled', () => {
  it('is true only with a full config', () => {
    expect(isGithubAuthEnabled(fullEnv)).toBe(true)
    expect(isGithubAuthEnabled({})).toBe(false)
  })
})

describe('isAuthorizedMember', () => {
  it('requires active org membership AND at least one active team', () => {
    expect(isAuthorizedMember('active', ['active'])).toBe(true)
    expect(isAuthorizedMember('active', ['pending', 'active'])).toBe(true)
    expect(isAuthorizedMember('active', ['pending', null])).toBe(false)
    expect(isAuthorizedMember('active', [])).toBe(false)
    expect(isAuthorizedMember('pending', ['active'])).toBe(false)
    expect(isAuthorizedMember(null, ['active'])).toBe(false)
    expect(isAuthorizedMember(undefined, [undefined])).toBe(false)
  })
})

describe('githubExternalIdentifier', () => {
  it('namespaces the github id', () => {
    expect(githubExternalIdentifier(4291)).toBe('github:4291')
  })
})

describe('signState / verifyState', () => {
  const secret = 'super-secret'

  it('verifies a freshly signed state', () => {
    const now = 1_000_000
    const state = signState(secret, 'nonce123', now)
    expect(verifyState(secret, state, now + 1000)).toBe(true)
  })

  it('rejects a tampered payload/signature', () => {
    const state = signState(secret, 'nonce123', 1_000_000)
    expect(verifyState(secret, state + 'x', 1_000_500)).toBe(false)
    expect(verifyState(secret, 'garbage', 1_000_500)).toBe(false)
  })

  it('rejects a state signed with a different secret', () => {
    const state = signState(secret, 'nonce123', 1_000_000)
    expect(verifyState('other-secret', state, 1_000_500)).toBe(false)
  })

  it('rejects an expired state', () => {
    const state = signState(secret, 'nonce123', 1_000_000)
    // default max age 10 min; 11 min later → expired
    expect(verifyState(secret, state, 1_000_000 + 11 * 60 * 1000)).toBe(false)
  })
})

describe('buildAuthorizeUrl', () => {
  it('includes client_id, redirect_uri, read:org scope and state', () => {
    const url = new URL(
      buildAuthorizeUrl(readGithubAuthConfig(fullEnv)!, 'THESTATE')
    )
    expect(url.origin + url.pathname).toBe(
      'https://github.com/login/oauth/authorize'
    )
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe(
      fullEnv.GITHUB_OAUTH_CALLBACK_URL
    )
    expect(url.searchParams.get('state')).toBe('THESTATE')
    expect(url.searchParams.get('scope')).toContain('read:org')
  })
})
