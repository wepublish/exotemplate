import { describe, expect, it } from 'vitest'
import {
  normalizeEventsTable,
  resolveTableDef,
  tableParams,
  type SentryTableDef
} from './charts'

// One row per trace ranked by summed DB + pg-pool.connect duration. The query
// carries a multi-value `span.name:[...]` filter with a quoted, spaced value —
// worth pinning so the encoding survives {medium} substitution intact.
const dbTimePerTraceDef: SentryTableDef = {
  key: 'db-time-per-trace',
  query:
    'span.name:["Database operation",pg-pool.connect] db.name:wepublish-{medium}-production',
  groupBy: 'transaction',
  extraFields: ['trace'],
  aggregates: ['sum(span.duration)'],
  sort: '-sum(span.duration)',
  statsPeriod: '7d',
  limit: 10,
  unit: 'millisecond',
  rowLink: {
    field: 'trace',
    urlTemplate:
      'https://wepublish-foundation.sentry.io/explore/traces/trace/{value}/?statsPeriod=7d'
  },
  sentryUrl:
    'https://wepublish-foundation.sentry.io/explore/traces/?q={medium}&query=span.name%3A%5B%22Database%20operation%22%2Cpg-pool.connect%5D'
}

describe('tableParams', () => {
  it('fetches groupBy + extraFields + aggregates as fields', () => {
    expect(tableParams(dbTimePerTraceDef).fields).toEqual([
      'transaction',
      'trace',
      'sum(span.duration)'
    ])
  })
})

describe('resolveTableDef', () => {
  it('substitutes {medium} in query, sentryUrl and rowLink.urlTemplate', () => {
    const resolved = resolveTableDef(dbTimePerTraceDef, 'acme')
    expect(resolved.query).toBe(
      'span.name:["Database operation",pg-pool.connect] db.name:wepublish-acme-production'
    )
    expect(resolved.sentryUrl).toContain('q=acme')
    // rowLink has no {medium} here, but the substitution must not corrupt it.
    expect(resolved.rowLink?.urlTemplate).toContain('/trace/{value}/')
  })

  it('resolves {medium} inside rowLink.urlTemplate when present', () => {
    const withMedium: SentryTableDef = {
      ...dbTimePerTraceDef,
      rowLink: { field: 'trace', urlTemplate: 'https://x/{medium}/{value}' }
    }
    expect(resolveTableDef(withMedium, 'acme').rowLink?.urlTemplate).toBe(
      'https://x/acme/{value}'
    )
  })

  it('keeps the multi-value span.name filter intact across {medium} substitution', () => {
    const resolved = resolveTableDef(dbTimePerTraceDef, 'acme')
    // The quoted, spaced "Database operation" inside the URL-encoded sentryUrl
    // must survive the {medium} split/join verbatim.
    expect(resolved.sentryUrl).toContain('q=acme')
    expect(resolved.sentryUrl).toContain(
      'span.name%3A%5B%22Database%20operation%22%2Cpg-pool.connect%5D'
    )
  })
})

describe('normalizeEventsTable', () => {
  const def = resolveTableDef(dbTimePerTraceDef, 'acme')

  it('labels rows by groupBy and builds a URL-encoded per-row trace link', () => {
    const rows = normalizeEventsTable(
      {
        data: [
          {
            transaction: 'GET /api/v1/articles',
            trace: 'abc 123',
            'sum(span.duration)': 1234.5
          }
        ]
      },
      def
    )
    expect(rows).toEqual([
      {
        label: 'GET /api/v1/articles',
        values: [1234.5],
        link: 'https://wepublish-foundation.sentry.io/explore/traces/trace/abc%20123/?statsPeriod=7d'
      }
    ])
  })

  it('drops rows without a string groupBy value', () => {
    const rows = normalizeEventsTable(
      { data: [{ trace: 't1', 'sum(span.duration)': 5 }] },
      def
    )
    expect(rows).toHaveLength(0)
  })

  it('nulls the link when the rowLink field is missing', () => {
    const rows = normalizeEventsTable(
      { data: [{ transaction: 'GET /x', 'sum(span.duration)': 1 }] },
      def
    )
    expect(rows[0]?.link).toBeNull()
  })

  it('returns link null for tables that define no rowLink', () => {
    const noLinkDef: SentryTableDef = {
      key: 'slow-db-queries',
      query: 'span.op:db',
      groupBy: 'span.description',
      aggregates: ['count()'],
      sort: '-count()',
      statsPeriod: '7d',
      limit: 10,
      unit: 'millisecond',
      sentryUrl: 'https://x'
    }
    const rows = normalizeEventsTable(
      { data: [{ 'span.description': 'SELECT 1', 'count()': 3 }] },
      noLinkDef
    )
    expect(rows[0]).toEqual({
      label: 'SELECT 1',
      values: [3],
      link: null
    })
  })
})
