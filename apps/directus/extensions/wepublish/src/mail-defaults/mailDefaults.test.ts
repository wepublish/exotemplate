import { describe, expect, it } from 'vitest'
import {
  MAIL_SUBJECTS,
  resolveMailSubject,
  resolveMailUrl
} from './mailDefaults'

const env = {
  USER_INVITE_URL_ALLOW_LIST:
    'https://one.wepublish.cloud/auth/accept-invite,http://localhost:3000/auth/accept-invite',
  PASSWORD_RESET_URL_ALLOW_LIST:
    'https://one.wepublish.cloud/auth/set-new-password'
}

describe('resolveMailSubject', () => {
  it('replaces the invite subject (Directus default is the spam-flagged English one)', () => {
    expect(resolveMailSubject('user-invitation', "You've been invited")).toBe(
      MAIL_SUBJECTS['user-invitation']
    )
  })

  it('replaces the password-reset subject', () => {
    expect(resolveMailSubject('password-reset', 'Password Reset Request')).toBe(
      MAIL_SUBJECTS['password-reset']
    )
  })

  it('leaves unknown templates untouched', () => {
    expect(resolveMailSubject('user-registration', 'Confirm')).toBe('Confirm')
  })

  it('leaves non-template mails untouched', () => {
    expect(resolveMailSubject(undefined, 'Du hast Zugriff erhalten')).toBe(
      'Du hast Zugriff erhalten'
    )
  })
})

describe('resolveMailUrl', () => {
  it('rewrites the relative /admin invite link to the allow-listed frontend URL, keeping the token', () => {
    expect(
      resolveMailUrl('user-invitation', '/admin/accept-invite?token=ABC', env)
    ).toBe('https://one.wepublish.cloud/auth/accept-invite?token=ABC')
  })

  it('rewrites an absolute admin invite link too', () => {
    expect(
      resolveMailUrl(
        'user-invitation',
        'https://one-admin.wepublish.cloud/admin/accept-invite?token=XYZ',
        env
      )
    ).toBe('https://one.wepublish.cloud/auth/accept-invite?token=XYZ')
  })

  it('leaves an already-allow-listed frontend link unchanged', () => {
    const url = 'http://localhost:3000/auth/accept-invite?token=KEEP'
    expect(resolveMailUrl('user-invitation', url, env)).toBe(url)
  })

  it('rewrites the password-reset admin link', () => {
    expect(
      resolveMailUrl('password-reset', '/admin/reset-password?token=R', env)
    ).toBe('https://one.wepublish.cloud/auth/set-new-password?token=R')
  })

  it('leaves unknown templates untouched', () => {
    expect(resolveMailUrl('user-registration', '/admin/x?token=T', env)).toBe(
      '/admin/x?token=T'
    )
  })

  it('returns the url unchanged when no token is present', () => {
    expect(resolveMailUrl('user-invitation', '/admin/accept-invite', env)).toBe(
      '/admin/accept-invite'
    )
  })

  it('returns unchanged when the allow-list env is empty', () => {
    expect(
      resolveMailUrl('user-invitation', '/admin/accept-invite?token=A', {})
    ).toBe('/admin/accept-invite?token=A')
  })
})
