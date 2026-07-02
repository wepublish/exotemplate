import { describe, expect, it } from 'vitest'
import type { Client, ClientLink } from '../types/DirectusTypes'
import {
  WEPUBLISH_DOCS_URL,
  composeEditorUrl,
  composeWebsiteUrl,
  parseMediumFromApiUrl
} from '../app/utils/externalLinks'
import {
  buildDashboardLinks,
  diffClientLinks,
  type ClientLinkDraft
} from '../app/utils/clientLinks'

// The helpers only read a handful of fields; build minimal objects and cast,
// rather than stubbing the whole (large) Client / ClientLink interfaces.
function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 'c1',
    name: 'Bajour',
    apiUrl: 'https://api.bajour.wepublish.cloud/v1',
    slack_channel_id: 'C123',
    jira_short_code: 'BAJ',
    editor_url: null,
    website_url: null,
    ...overrides
  } as Client
}

function link(overrides: Partial<ClientLink> = {}): ClientLink {
  return {
    id: 1,
    status: 'published',
    sort: null,
    client: 'c1',
    label: 'Analytics',
    url: 'https://analytics.test',
    description: null,
    ...overrides
  } as ClientLink
}

describe('parseMediumFromApiUrl', () => {
  it('extracts the medium slug from the api host', () => {
    expect(parseMediumFromApiUrl('https://api.bajour.wepublish.cloud/v1')).toBe(
      'bajour'
    )
    expect(parseMediumFromApiUrl('https://api.foo.wepublish.cloud')).toBe('foo')
  })

  it('also handles the hyphen host form (api-<medium>.wepublish.cloud)', () => {
    expect(parseMediumFromApiUrl('https://api-bajour.wepublish.cloud/v1')).toBe(
      'bajour'
    )
  })

  it('returns null for empty or non-matching input', () => {
    expect(parseMediumFromApiUrl(null)).toBeNull()
    expect(parseMediumFromApiUrl('')).toBeNull()
    expect(parseMediumFromApiUrl('https://example.com')).toBeNull()
  })
})

describe('composeEditorUrl / composeWebsiteUrl', () => {
  it('derives from apiUrl when no override is set', () => {
    expect(composeEditorUrl('https://api.bajour.wepublish.cloud/v1')).toBe(
      'https://editor.bajour.wepublish.cloud'
    )
    expect(composeWebsiteUrl('https://api.bajour.wepublish.cloud/v1')).toBe(
      'https://bajour.wepublish.cloud'
    )
  })

  it('derives from the hyphen host form, preserving the separator', () => {
    expect(composeEditorUrl('https://api-bajour.wepublish.cloud/v1')).toBe(
      'https://editor-bajour.wepublish.cloud'
    )
    expect(composeWebsiteUrl('https://api-bajour.wepublish.cloud/v1')).toBe(
      'https://bajour.wepublish.cloud'
    )
  })

  it('prefers an explicit override over the derived value', () => {
    expect(
      composeEditorUrl('https://api.bajour.wepublish.cloud', 'https://e.test')
    ).toBe('https://e.test')
    expect(
      composeWebsiteUrl('https://api.bajour.wepublish.cloud', 'https://w.test')
    ).toBe('https://w.test')
  })

  it('returns null when neither override nor a parseable apiUrl exists', () => {
    expect(composeEditorUrl(null, null)).toBeNull()
    expect(composeWebsiteUrl(null, null)).toBeNull()
    expect(composeEditorUrl('not-a-cloud-url')).toBeNull()
  })
})

describe('buildDashboardLinks', () => {
  it('returns an empty list when there is no client', () => {
    expect(buildDashboardLinks(null, 'C999', [])).toEqual([])
  })

  it('builds all built-ins in order, each with a description key', () => {
    const links = buildDashboardLinks(client(), 'C999', [])
    expect(links.map((l) => l.key)).toEqual([
      'slack',
      'weShare',
      'editor',
      'website',
      'jira',
      'docs'
    ])
    expect(links.every((l) => !!l.descriptionKey)).toBe(true)
    expect(links.find((l) => l.key === 'editor')?.url).toBe(
      'https://editor.bajour.wepublish.cloud'
    )
    expect(links.find((l) => l.key === 'docs')?.url).toBe(WEPUBLISH_DOCS_URL)
  })

  it('always includes docs, even with no other data', () => {
    const links = buildDashboardLinks(
      client({ apiUrl: null, slack_channel_id: null, jira_short_code: null }),
      null,
      []
    )
    expect(links.map((l) => l.key)).toEqual(['docs'])
  })

  it('omits the #we-share link when no channel id is configured', () => {
    const links = buildDashboardLinks(client(), null, [])
    expect(links.some((l) => l.key === 'weShare')).toBe(false)
  })

  it('omits editor/website when apiUrl is missing and no overrides are set', () => {
    const links = buildDashboardLinks(client({ apiUrl: null }), null, [])
    expect(links.some((l) => l.key === 'editor')).toBe(false)
    expect(links.some((l) => l.key === 'website')).toBe(false)
  })

  it('appends custom links sorted, with description, normalizing bare hosts', () => {
    const links = buildDashboardLinks(client(), null, [
      link({ id: 2, label: 'Second', url: 'second.test', sort: 2 }),
      link({
        id: 1,
        label: 'First',
        url: 'https://first.test',
        sort: 1,
        description: 'My note'
      })
    ])
    const custom = links.filter((l) => l.key.startsWith('custom-'))
    expect(custom.map((l) => l.key)).toEqual(['custom-1', 'custom-2'])
    expect(custom[0]).toMatchObject({
      label: 'First',
      url: 'https://first.test',
      description: 'My note'
    })
    expect(custom[1]).toMatchObject({
      label: 'Second',
      url: 'https://second.test'
    })
    expect(custom[1].description).toBeUndefined()
  })

  it('skips custom links with an empty label or url', () => {
    const links = buildDashboardLinks(client(), null, [
      link({ id: 3, label: '', url: 'https://x.test' }),
      link({ id: 4, label: 'No URL', url: '   ' })
    ])
    expect(links.some((l) => l.key.startsWith('custom-'))).toBe(false)
  })
})

describe('diffClientLinks', () => {
  const drafts = (rows: ClientLinkDraft[]): ClientLinkDraft[] => rows

  it('creates rows that have no id', () => {
    const diff = diffClientLinks(
      [],
      drafts([{ label: 'New', url: 'https://new.test', description: '' }])
    )
    expect(diff.toCreate).toEqual([
      { label: 'New', url: 'https://new.test', description: null }
    ])
    expect(diff.toUpdate).toEqual([])
    expect(diff.toDelete).toEqual([])
  })

  it('updates only rows whose fields changed', () => {
    const original = [
      link({ id: 1, label: 'A', url: 'https://a.test', description: null }),
      link({ id: 2, label: 'B', url: 'https://b.test', description: 'keep' })
    ]
    const diff = diffClientLinks(
      original,
      drafts([
        { id: 1, label: 'A renamed', url: 'https://a.test', description: '' },
        { id: 2, label: 'B', url: 'https://b.test', description: 'keep' }
      ])
    )
    expect(diff.toUpdate).toEqual([
      { id: 1, label: 'A renamed', url: 'https://a.test', description: null }
    ])
    expect(diff.toDelete).toEqual([])
  })

  it('deletes rows removed from the drafts or blanked out', () => {
    const original = [
      link({ id: 1, label: 'A', url: 'https://a.test' }),
      link({ id: 2, label: 'B', url: 'https://b.test' })
    ]
    const diff = diffClientLinks(
      original,
      drafts([
        // id 1 kept, id 2 blanked (label cleared) → delete
        { id: 1, label: 'A', url: 'https://a.test', description: '' },
        { id: 2, label: '', url: '', description: '' }
      ])
    )
    expect(diff.toDelete).toEqual([2])
    expect(diff.toCreate).toEqual([])
    expect(diff.toUpdate).toEqual([])
  })

  it('trims whitespace before deciding create/update', () => {
    const diff = diffClientLinks(
      [],
      drafts([
        {
          label: '  Spaced  ',
          url: '  https://s.test  ',
          description: '  hi  '
        }
      ])
    )
    expect(diff.toCreate).toEqual([
      { label: 'Spaced', url: 'https://s.test', description: 'hi' }
    ])
  })
})
