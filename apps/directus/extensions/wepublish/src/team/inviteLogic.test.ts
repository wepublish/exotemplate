import { describe, expect, it } from 'vitest'
import {
  decideInviteAction,
  isValidEmail,
  missingClientLinks,
  normalizeClientIds,
  normalizeEmail,
  unauthorizedClientIds,
  type ExistingUser
} from './inviteLogic'

const user = (status: string): ExistingUser => ({
  id: 'u1',
  status,
  email: 'a@b.ch'
})

describe('decideInviteAction', () => {
  it('new user + sendInvite → invite with activation mail', () => {
    expect(decideInviteAction(null, true)).toEqual({
      action: 'invite',
      emailKind: 'invite'
    })
  })

  it('new user, no send (onboarding create step) → invite, no mail', () => {
    expect(decideInviteAction(null, false)).toEqual({
      action: 'invite',
      emailKind: 'none'
    })
  })

  it('invited user + sendInvite → reinvite (re-send activation link)', () => {
    expect(decideInviteAction(user('invited'), true)).toEqual({
      action: 'reinvite',
      emailKind: 'invite'
    })
  })

  it('invited user, no send → reinvite, no mail', () => {
    expect(decideInviteAction(user('invited'), false)).toEqual({
      action: 'reinvite',
      emailKind: 'none'
    })
  })

  it('active user + sendInvite → grant access + courtesy notice', () => {
    expect(decideInviteAction(user('active'), true)).toEqual({
      action: 'grant',
      emailKind: 'notify'
    })
  })

  it('active user, no send → grant only, no mail', () => {
    expect(decideInviteAction(user('active'), false)).toEqual({
      action: 'grant',
      emailKind: 'none'
    })
  })

  it('suspended/other status → grant only, never notify (cannot log in)', () => {
    expect(decideInviteAction(user('suspended'), true)).toEqual({
      action: 'grant',
      emailKind: 'none'
    })
  })
})

describe('unauthorizedClientIds', () => {
  it('admin is authorized for everything', () => {
    expect(unauthorizedClientIds(['a', 'b'], [], true)).toEqual([])
  })

  it('non-admin authorized only for held clients', () => {
    expect(unauthorizedClientIds(['a', 'b', 'c'], ['a', 'c'], false)).toEqual([
      'b'
    ])
  })

  it('non-admin with full coverage → authorized', () => {
    expect(unauthorizedClientIds(['a', 'b'], ['a', 'b', 'z'], false)).toEqual(
      []
    )
  })

  it('coerces ids to strings before comparing', () => {
    expect(unauthorizedClientIds([1 as any, 2 as any], ['1'], false)).toEqual([
      '2'
    ])
  })
})

describe('missingClientLinks', () => {
  it('returns the requested ids not yet linked', () => {
    expect(missingClientLinks(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c'])
  })

  it('returns empty when everything is already linked (idempotent)', () => {
    expect(missingClientLinks(['a', 'b'], ['a', 'b'])).toEqual([])
  })

  it('de-duplicates requested ids', () => {
    expect(missingClientLinks(['a', 'a', 'b'], [])).toEqual(['a', 'b'])
  })
})

describe('normalizeEmail / isValidEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Max@Muster.CH ')).toBe('max@muster.ch')
  })

  it('handles nullish input', () => {
    expect(normalizeEmail(undefined)).toBe('')
    expect(normalizeEmail(null)).toBe('')
  })

  it('validates plausible emails', () => {
    expect(isValidEmail('max@muster.ch')).toBe(true)
    expect(isValidEmail('not-an-email')).toBe(false)
    expect(isValidEmail('a@b')).toBe(false)
    expect(isValidEmail('')).toBe(false)
  })
})

describe('normalizeClientIds', () => {
  it('accepts a single id', () => {
    expect(normalizeClientIds('c1')).toEqual(['c1'])
  })

  it('accepts an array, trims, drops empties, de-duplicates', () => {
    expect(normalizeClientIds(['c1', ' c2 ', '', 'c1'])).toEqual(['c1', 'c2'])
  })

  it('returns [] for nullish', () => {
    expect(normalizeClientIds(undefined)).toEqual([])
    expect(normalizeClientIds(null)).toEqual([])
  })
})
