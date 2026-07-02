import { describe, it, expect } from 'vitest'
import {
  parseImageTag,
  imageTagOf,
  shortSha,
  ghcrPackageUrl
} from '../app/utils/infraConfig'

describe('parseImageTag', () => {
  it('parses a production tag with a YYYYMMDDHHMM build stamp', () => {
    const r = parseImageTag('production-bajour-202606111703')
    expect(r.channel).toBe('production')
    expect(r.sha).toBeNull()
    // 2026-06-11 17:03 UTC
    expect(r.releasedAt?.toISOString()).toBe('2026-06-11T17:03:00.000Z')
  })

  it('parses a website-style production tag (no medium segment)', () => {
    const r = parseImageTag('production-202606111703')
    expect(r.channel).toBe('production')
    expect(r.releasedAt?.toISOString()).toBe('2026-06-11T17:03:00.000Z')
  })

  it('parses a master tag with a unix epoch and a git sha', () => {
    const r = parseImageTag(
      'master-1782982054-14bb93fc482a4bdc2369c5d20b495d28aaaa7825'
    )
    expect(r.channel).toBe('master')
    expect(r.sha).toBe('14bb93fc482a4bdc2369c5d20b495d28aaaa7825')
    expect(r.releasedAt?.toISOString()).toBe(
      new Date(1782982054 * 1000).toISOString()
    )
  })

  it('returns nulls when there is no recognizable stamp', () => {
    const r = parseImageTag('latest')
    expect(r.channel).toBe('latest')
    expect(r.releasedAt).toBeNull()
    expect(r.sha).toBeNull()
  })

  it('ignores an invalid calendar stamp rather than producing a bogus date', () => {
    // 202699999999 → month 99 is invalid
    const r = parseImageTag('production-202699999999')
    expect(r.releasedAt).toBeNull()
  })
})

describe('imageTagOf', () => {
  it('extracts the tag after the last colon', () => {
    expect(
      imageTagOf('ghcr.io/wepublish/api:production-bajour-202606111703')
    ).toBe('production-bajour-202606111703')
  })

  it('returns the whole string when there is no tag', () => {
    expect(imageTagOf('ghcr.io/wepublish/api')).toBe('ghcr.io/wepublish/api')
  })
})

describe('ghcrPackageUrl', () => {
  it('builds the GitHub packages URL for a ghcr.io image', () => {
    expect(
      ghcrPackageUrl('ghcr.io/wepublish/api:production-bajour-202606111703')
    ).toBe('https://github.com/orgs/wepublish/packages/container/package/api')
  })

  it('handles a hyphenated package name', () => {
    expect(
      ghcrPackageUrl('ghcr.io/wepublish/website-bajour:production-202606111703')
    ).toBe(
      'https://github.com/orgs/wepublish/packages/container/package/website-bajour'
    )
  })

  it('works without a tag', () => {
    expect(ghcrPackageUrl('ghcr.io/wepublish/editor')).toBe(
      'https://github.com/orgs/wepublish/packages/container/package/editor'
    )
  })

  it('returns null for a non-ghcr image', () => {
    expect(ghcrPackageUrl('docker.io/library/postgres:16')).toBeNull()
    expect(ghcrPackageUrl('')).toBeNull()
  })
})

describe('shortSha', () => {
  it('shortens a full sha to 7 chars', () => {
    expect(shortSha('14bb93fc482a4bdc2369c5d20b495d28aaaa7825')).toBe('14bb93f')
  })

  it('passes null through', () => {
    expect(shortSha(null)).toBeNull()
  })
})
