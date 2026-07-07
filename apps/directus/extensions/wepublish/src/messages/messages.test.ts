import { describe, it, expect } from 'vitest'
import {
  isActiveAnnouncement,
  resolveAnnouncement,
  selectActiveMessages,
  type RawAnnouncement
} from './messages'

const NOW = Date.parse('2026-07-07T12:00:00Z')

const base = (over: Partial<RawAnnouncement> = {}): RawAnnouncement => ({
  id: 1,
  status: 'published',
  sort: null,
  severity: 'info',
  title: 'Base title',
  body: 'Base body',
  link_label: null,
  link_url: null,
  starts_at: null,
  ends_at: null,
  dismissible: true,
  clients: null,
  translations: null,
  ...over
})

describe('isActiveAnnouncement', () => {
  it('is active when published and no window', () => {
    expect(isActiveAnnouncement(base(), NOW)).toBe(true)
  })
  it('is inactive when not published', () => {
    expect(isActiveAnnouncement(base({ status: 'draft' }), NOW)).toBe(false)
    expect(isActiveAnnouncement(base({ status: 'archived' }), NOW)).toBe(false)
  })
  it('respects the start/end window', () => {
    expect(
      isActiveAnnouncement(base({ starts_at: '2026-07-08T00:00:00Z' }), NOW)
    ).toBe(false) // starts in the future
    expect(
      isActiveAnnouncement(base({ ends_at: '2026-07-06T00:00:00Z' }), NOW)
    ).toBe(false) // already ended
    expect(
      isActiveAnnouncement(
        base({
          starts_at: '2026-07-01T00:00:00Z',
          ends_at: '2026-07-31T00:00:00Z'
        }),
        NOW
      )
    ).toBe(true)
  })
})

describe('resolveAnnouncement', () => {
  it('uses base fields when there is no translation', () => {
    expect(resolveAnnouncement(base(), 'fr')).toEqual({
      title: 'Base title',
      body: 'Base body',
      link_label: null
    })
  })
  it('uses the matching-locale translation', () => {
    const a = base({
      translations: [
        { locale: 'fr', title: 'Titre', body: 'Corps', link_label: 'Voir' }
      ]
    })
    expect(resolveAnnouncement(a, 'fr')).toEqual({
      title: 'Titre',
      body: 'Corps',
      link_label: 'Voir'
    })
  })
  it('falls back to base per-field for empty translation fields', () => {
    const a = base({
      body: 'Base body',
      translations: [
        { locale: 'fr', title: 'Titre', body: '', link_label: null }
      ]
    })
    expect(resolveAnnouncement(a, 'fr')).toEqual({
      title: 'Titre',
      body: 'Base body', // empty translation body → base
      link_label: null
    })
  })
  it('falls back to base when the locale is not translated', () => {
    const a = base({
      translations: [
        { locale: 'fr', title: 'Titre', body: 'Corps', link_label: null }
      ]
    })
    expect(resolveAnnouncement(a, 'en').title).toBe('Base title')
  })
})

describe('selectActiveMessages', () => {
  it('includes general (no media) and the matching medium; excludes others', () => {
    const list = [
      base({ id: 1, clients: null }),
      base({ id: 2, clients: [{ medium_name: 'bajour' }] }),
      base({ id: 3, clients: [{ medium_name: 'tsri' }] })
    ]
    const out = selectActiveMessages(list, { medium: 'bajour', now: NOW })
    expect(out.map((m) => m.id).sort()).toEqual([1, 2])
  })
  it('matches a message targeting several media for any of them', () => {
    const multi = base({
      id: 9,
      clients: [{ medium_name: 'bajour' }, { medium_name: 'tsri' }]
    })
    expect(
      selectActiveMessages([multi], { medium: 'bajour', now: NOW }).map(
        (m) => m.id
      )
    ).toEqual([9])
    expect(
      selectActiveMessages([multi], { medium: 'tsri', now: NOW }).map(
        (m) => m.id
      )
    ).toEqual([9])
    expect(
      selectActiveMessages([multi], { medium: 'other', now: NOW }).map(
        (m) => m.id
      )
    ).toEqual([])
  })
  it('treats an empty media list as general (all media)', () => {
    const list = [
      base({ id: 1, clients: [] }),
      base({ id: 2, clients: [{ medium_name: 'bajour' }] })
    ]
    expect(selectActiveMessages(list, { now: NOW }).map((m) => m.id)).toEqual([
      1
    ])
  })
  it('drops inactive messages', () => {
    const list = [base({ id: 1, status: 'draft' }), base({ id: 2 })]
    expect(selectActiveMessages(list, { now: NOW }).map((m) => m.id)).toEqual([
      2
    ])
  })
  it('sorts critical → warning → info', () => {
    const list = [
      base({ id: 1, severity: 'info' }),
      base({ id: 2, severity: 'critical' }),
      base({ id: 3, severity: 'warning' })
    ]
    expect(selectActiveMessages(list, { now: NOW }).map((m) => m.id)).toEqual([
      2, 3, 1
    ])
  })
  it('normalizes an unknown severity to info', () => {
    const out = selectActiveMessages([base({ severity: 'bogus' })], {
      now: NOW
    })
    expect(out[0].severity).toBe('info')
  })
})
