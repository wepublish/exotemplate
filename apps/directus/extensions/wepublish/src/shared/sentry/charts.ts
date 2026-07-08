import type { EventsParams, EventsStatsParams } from './client'

// The Sentry charts we surface on the admin monitoring page. Each entry is a
// fixed, cacheable view — queries/aggregates live in code (not env / request
// params) so the endpoint stays a stable, cacheable surface. Add a chart by
// appending an entry here and a matching `sentry.charts.<key>.*` i18n block in
// one-front (de/fr/en).

export type SentryUnit = 'millisecond'

export interface SentryChartDef {
  // Stable id — the cache key and the i18n key suffix (one-front
  // `sentry.charts.<key>`). Keep it kebab-case and never reuse across charts.
  key: string
  // Sentry search syntax, e.g. 'span.op:db db.name:wepublish-{medium}-production'.
  query: string
  // One or more aggregates → one line per axis, e.g. ['p99(span.duration)'] or
  // ['p75(span.duration)', 'p90(span.duration)'].
  yAxes: string[]
  // Relative window, e.g. '30d'.
  statsPeriod: string
  // Bucket size, e.g. '4h' / '30m'.
  interval: string
  // Value unit for all series.
  unit: SentryUnit
  // Optional Sentry project id to scope the query to; omit for all projects
  // ('-1'). Needed when the same span/transaction exists across projects and
  // the search filter alone isn't enough.
  project?: string
  // Deep-link to the exact Sentry explore view this chart mirrors.
  sentryUrl: string
}

export interface SeriesPoint {
  // Epoch milliseconds (JS-friendly; Sentry reports seconds).
  timestamp: number
  // Aggregate value for the bucket, or null when the bucket is empty.
  value: number | null
}

export interface ChartSeries {
  // The aggregate this line represents, e.g. 'p90(span.duration)'.
  name: string
  points: SeriesPoint[]
}

export const SENTRY_CHARTS: SentryChartDef[] = [
  {
    key: 'db-duration',
    query: 'span.op:db db.name:wepublish-{medium}-production',
    yAxes: ['p90(span.duration)', 'p95(span.duration)', 'p99(span.duration)'],
    statsPeriod: '30d',
    interval: '4h',
    unit: 'millisecond',
    sentryUrl:
      'https://wepublish-foundation.sentry.io/explore/traces/?aggregateField=%7B%22groupBy%22%3A%22%22%7D&aggregateField=%7B%22yAxes%22%3A%5B%22p75%28span.duration%29%22%2C%22p90%28span.duration%29%22%2C%22p95%28span.duration%29%22%2C%22p99%28span.duration%29%22%5D%7D&query=span.op%3Adb%20db.name%3Awepublish-{medium}-production&statsPeriod=30d'
  },
  {
    key: 'slow-http',
    query: 'span.op:http.server http.host:api-{medium}.wepublish.cloud',
    yAxes: ['p90(span.duration)', 'p95(span.duration)', 'p99(span.duration)'],
    statsPeriod: '30d',
    interval: '4h',
    unit: 'millisecond',
    sentryUrl:
      'https://wepublish-foundation.sentry.io/explore/traces/?aggregateField=%7B%22yAxes%22%3A%5B%22max%28span.duration%29%22%5D%2C%22chartType%22%3A1%7D&aggregateField=%7B%22groupBy%22%3A%22%22%7D&field=id&field=span.op&field=span.description&field=span.duration&field=transaction&field=timestamp&field=app_name&groupBy=&id=432860&mode=samples&query=span.op%3Ahttp.server%20http.host%3Aapi-{medium}.wepublish.cloud&sort=-timestamp&statsPeriod=30d&title=Slow%20HTTP%20Requests&visualize=%7B%22yAxes%22%3A%5B%22p75%28span.duration%29%22%2C%22p90%28span.duration%29%22%2C%22p95%28span.duration%29%22%2C%22p99%28span.duration%29%22%5D%2C%22chartType%22%3A1%7D'
  },
  {
    key: 'pgpool-queue',
    query:
      'span.description:pg-pool.connect db.name:wepublish-{medium}-production',
    yAxes: ['p90(span.duration)', 'p95(span.duration)', 'p99(span.duration)'],
    statsPeriod: '30d',
    // 2h over 30d = 360 points/line — fine-grained enough for a spiky metric
    // without the DOM bloat 30m (1440 pts) would cause in the static SVG.
    interval: '2h',
    unit: 'millisecond',
    sentryUrl:
      'https://wepublish-foundation.sentry.io/explore/traces/?aggregateField=%7B%22yAxes%22%3A%5B%22p95%28span.duration%29%22%5D%2C%22chartType%22%3A0%7D&aggregateField=%7B%22groupBy%22%3A%22%22%7D&field=id&field=span.op&field=span.description&field=span.duration&field=transaction&field=timestamp&field=db.name&groupBy=&id=1065245&interval=30m&mode=samples&query=span.description%3Apg-pool.connect%20db.name%3Awepublish-{medium}-production&sort=-timestamp&statsPeriod=30d&title=PGPoolQueueTime&visualize=%7B%22yAxes%22%3A%5B%22p75%28span.duration%29%22%2C%22p90%28span.duration%29%22%2C%22p95%28span.duration%29%22%2C%22p99%28span.duration%29%22%5D%2C%22chartType%22%3A0%7D'
  },
  {
    key: 'article-list',
    // The '*ArticleList*' wildcard is the API equivalent of Sentry's UI
    // "transaction contains ArticleList" pill.
    query: 'transaction:*ArticleList* is_transaction:true app_name:{medium}',
    yAxes: ['p90(span.duration)', 'p95(span.duration)', 'p99(span.duration)'],
    statsPeriod: '30d',
    // Coarser than the deep-link's 5m: our static SVG can't zoom, so 30d @ 1h
    // (720 points/line) would bloat the DOM; 4h buckets (180 pts) read cleanly.
    interval: '4h',
    project: '4510947424075856',
    unit: 'millisecond',
    sentryUrl:
      'https://wepublish-foundation.sentry.io/explore/traces/?aggregateField=%7B%22yAxes%22%3A%5B%22p95%28span.duration%29%22%5D%7D&aggregateField=%7B%22groupBy%22%3A%22%22%7D&field=id&field=span.name&field=span.description&field=span.duration&field=transaction&field=timestamp&field=app_name&groupBy=&id=1064722&interval=5m&mode=samples&project=4510947424075856&query=transaction%3A%EF%80%8DContains%EF%80%8DArticleList%20is_transaction%3Atrue%20app_name%3A{medium}&sort=-timestamp&statsPeriod=30d&title=ArticleListCountAndDuration&visualize=%7B%22yAxes%22%3A%5B%22count%28span.duration%29%22%5D%7D&visualize=%7B%22yAxes%22%3A%5B%22p95%28span.duration%29%22%5D%7D'
  }
]

// Ranked tables (top-N rows) grouped by a non-aggregate field, with one column
// per aggregate — the natural shape for a "slowest X by <field>" leaderboard.
// Add a table by appending here + a `sentry.tables.<key>.*` i18n block.
export interface SentryTableDef {
  // Stable id — cache key + i18n key suffix (`sentry.tables.<key>`).
  key: string
  // Sentry search syntax scoping the rows.
  query: string
  // The field whose value labels each row, e.g. 'span.description'. Its the
  // first non-aggregate column; Sentry groups by every non-aggregate field.
  groupBy: string
  // Extra non-aggregate fields fetched alongside `groupBy` — they widen the
  // grouping and feed per-row links (e.g. 'trace' for a trace deep-link). Not
  // rendered as columns.
  extraFields?: string[]
  // One aggregate per column, e.g. ['p75(span.duration)', …].
  aggregates: string[]
  // Sort spec, e.g. '-p95(span.duration)' (slowest first).
  sort: string
  // Relative window, e.g. '30d'.
  statsPeriod: string
  // Top-N row cap.
  limit: number
  // Value unit for the aggregate columns.
  unit: SentryUnit
  // How a `count()` column reads: true (default) → a per-day rate (the count is
  // a total over `statsPeriod`, e.g. slowest-queries), false → an absolute count
  // that is already per-row (e.g. queries in a single request/trace).
  countPerDay?: boolean
  // Non-`count()` aggregates that should also be displayed as a per-day rate
  // (value ÷ days in `statsPeriod`). Used for `sum(span.duration)`, which over
  // the stats period equals `count() × avg(span.duration)`; per-day that's
  // `(count/day) × avg` — the query's average daily DB-time load, aka "impact".
  // Sentry sorts by `-sum(span.duration)`, which ranks by impact exactly (÷ days
  // is constant), so no client-side re-sort is needed.
  perDayAggregates?: string[]
  // Optional per-row deep-link into Sentry, built from a fetched field's value.
  rowLink?: {
    // The field (in `groupBy` / `extraFields`) holding the id for the link.
    field: string
    // URL template; `{medium}` (resolved per-request) and `{value}` (the field
    // value, URL-encoded) are substituted.
    urlTemplate: string
  }
  // Deep-link to the exact Sentry explore view this table mirrors.
  sentryUrl: string
}

export interface TableRow {
  // The groupBy value for this row (e.g. the SQL query text).
  label: string
  // One value per aggregate column, aligned with `aggregates`; null if absent.
  values: (number | null)[]
  // Per-row deep-link into Sentry (e.g. the trace view), or null when the table
  // defines no `rowLink` or the row lacks the linking field.
  link?: string | null
}

export const SENTRY_TABLES: SentryTableDef[] = [
  {
    key: 'slow-db-queries',
    query: 'span.op:db db.name:wepublish-{medium}-production',
    groupBy: 'span.description',
    aggregates: [
      'count()',
      'avg(span.duration)',
      'p75(span.duration)',
      'p90(span.duration)',
      'p95(span.duration)',
      'p99(span.duration)',
      'max(span.duration)'
    ],
    sort: '-p95(span.duration)',
    statsPeriod: '7d',
    limit: 10,
    unit: 'millisecond',
    sentryUrl:
      'https://wepublish-foundation.sentry.io/explore/traces/?aggregateField=%7B%22groupBy%22%3A%22span.description%22%7D&aggregateField=%7B%22yAxes%22%3A%5B%22count%28%29%22%2C%22avg%28span.duration%29%22%2C%22p75%28span.duration%29%22%2C%22p90%28span.duration%29%22%2C%22p95%28span.duration%29%22%2C%22p99%28span.duration%29%22%2C%22max%28span.duration%29%22%5D%7D&mode=aggregate&query=span.op%3Adb%20db.name%3Awepublish-{medium}-production&sort=-p95%28span.duration%29&statsPeriod=7d'
  },
  {
    // Same query as slow-db-queries but ranked by impact — a query's average
    // daily DB-time load. `sum(span.duration)` over the window is
    // `count() × avg(span.duration)`; displayed per-day (÷ 7) that's
    // `(count/day) × avg` — exactly "×/day × avg". Sentry sorts by `-sum`,
    // which ranks by impact (÷ days is constant), so the top-10 is exact.
    key: 'common-db-queries',
    query: 'span.op:db db.name:wepublish-{medium}-production',
    groupBy: 'span.description',
    aggregates: ['count()', 'avg(span.duration)', 'sum(span.duration)'],
    sort: '-sum(span.duration)',
    statsPeriod: '7d',
    limit: 10,
    unit: 'millisecond',
    perDayAggregates: ['sum(span.duration)'],
    sentryUrl:
      'https://wepublish-foundation.sentry.io/explore/traces/?aggregateField=%7B%22groupBy%22%3A%22span.description%22%7D&aggregateField=%7B%22yAxes%22%3A%5B%22count%28%29%22%2C%22avg%28span.duration%29%22%2C%22sum%28span.duration%29%22%5D%7D&mode=aggregate&query=span.op%3Adb%20db.name%3Awepublish-{medium}-production&sort=-sum%28span.duration%29&statsPeriod=7d'
  },
  {
    // One row per trace, ranked by total DB-related time — sums the duration of
    // every "Database operation" span and every pg-pool.connect (connection
    // wait) span in that trace. Grouped by (transaction, trace) so each row is
    // one trace labelled by its request URL; `trace` feeds the per-row
    // deep-link only, not shown as a column.
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
      'https://wepublish-foundation.sentry.io/explore/traces/?aggregateField=%7B%22groupBy%22%3A%22transaction%22%7D&aggregateField=%7B%22groupBy%22%3A%22trace%22%7D&aggregateField=%7B%22yAxes%22%3A%5B%22sum%28span.duration%29%22%5D%7D&mode=aggregate&query=span.name%3A%5B%22Database%20operation%22%2Cpg-pool.connect%5D%20db.name%3Awepublish-{medium}-production&sort=-sum%28span.duration%29&statsPeriod=7d'
  }
]

// Placeholder token in `query` / `sentryUrl` templates, replaced at request
// time with the selected client's `medium_name` (Directus `Clients.medium_name`
// — a Terraform id matching /^[a-z][a-z0-9_]*$/, so URL- and query-safe). This
// keeps the medium out of the registry: the same chart definitions serve every
// client, scoped to their own Sentry data.
export const MEDIUM_PLACEHOLDER = '{medium}'

function applyMedium(value: string, medium: string): string {
  return value.replaceAll(MEDIUM_PLACEHOLDER, medium)
}

/** Concrete chart def for one medium — placeholders in query/url resolved. */
export function resolveChartDef(
  def: SentryChartDef,
  medium: string
): SentryChartDef {
  return {
    ...def,
    query: applyMedium(def.query, medium),
    sentryUrl: applyMedium(def.sentryUrl, medium)
  }
}

/** Concrete table def for one medium — placeholders in query/url resolved. */
export function resolveTableDef(
  def: SentryTableDef,
  medium: string
): SentryTableDef {
  return {
    ...def,
    query: applyMedium(def.query, medium),
    sentryUrl: applyMedium(def.sentryUrl, medium),
    ...(def.rowLink
      ? {
          rowLink: {
            ...def.rowLink,
            urlTemplate: applyMedium(def.rowLink.urlTemplate, medium)
          }
        }
      : {})
  }
}

export function chartParams(def: SentryChartDef): EventsStatsParams {
  return {
    yAxes: def.yAxes,
    query: def.query,
    statsPeriod: def.statsPeriod,
    interval: def.interval,
    ...(def.project ? { project: def.project } : {})
  }
}

/**
 * Normalise a single Sentry events-stats block into a flat series.
 *
 * A block is `{ data: [[unixSeconds, [{ count }]], …] }`; buckets with no data
 * carry a missing / non-numeric `count`, which we surface as `null` (a gap)
 * rather than 0 so the chart doesn't draw a fake dip to the floor.
 */
export function normalizeEventsStats(raw: any): SeriesPoint[] {
  const rows = Array.isArray(raw?.data) ? raw.data : []
  return rows
    .filter((row: any) => Array.isArray(row) && row.length >= 1)
    .map((row: any): SeriesPoint => {
      const [ts, buckets] = row
      const first = Array.isArray(buckets) ? buckets[0] : undefined
      const count =
        first && typeof first.count === 'number' && Number.isFinite(first.count)
          ? first.count
          : null
      return { timestamp: Number(ts) * 1000, value: count }
    })
}

/**
 * Normalise a Sentry events-stats payload into one series per requested axis.
 *
 * Single-axis requests come back as a top-level `{ data }` block; multi-axis
 * requests come back keyed per axis (`{ 'p75(span.duration)': { data }, … }`).
 * We probe for the keyed block first and fall back to the top-level block, so
 * both shapes work with the same call.
 */
export function normalizeChartSeries(raw: any, yAxes: string[]): ChartSeries[] {
  return yAxes.map((axis) => {
    const keyed =
      raw && typeof raw === 'object' && Array.isArray(raw[axis]?.data)
        ? raw[axis]
        : raw
    return { name: axis, points: normalizeEventsStats(keyed) }
  })
}

export function tableParams(def: SentryTableDef): EventsParams {
  return {
    fields: [def.groupBy, ...(def.extraFields ?? []), ...def.aggregates],
    query: def.query,
    statsPeriod: def.statsPeriod,
    sort: def.sort,
    perPage: def.limit
  }
}

/**
 * Build a row's Sentry deep-link from a fetched field value (e.g. the trace id
 * → trace view). Returns null when the table has no `rowLink` or the row lacks
 * a usable string value for the linking field. Assumes `def` is already
 * medium-resolved (see `resolveTableDef`), so only `{value}` remains.
 */
function buildRowLink(def: SentryTableDef, row: any): string | null {
  if (!def.rowLink) return null
  const raw = row[def.rowLink.field]
  if (typeof raw !== 'string' || !raw) return null
  return def.rowLink.urlTemplate.replaceAll('{value}', encodeURIComponent(raw))
}

/**
 * Normalise Sentry's events (table) payload into ranked rows.
 *
 * Sentry returns `{ data: [{ '<groupBy>': label, '<aggregate>': value, … }] }`.
 * Rows without a string group label are dropped; non-numeric aggregate cells
 * become `null` (rendered as a dash) rather than 0.
 */
export function normalizeEventsTable(
  raw: any,
  def: SentryTableDef
): TableRow[] {
  const rows = Array.isArray(raw?.data) ? raw.data : []
  return rows
    .filter(
      (row: any) =>
        row && typeof row[def.groupBy] === 'string' && row[def.groupBy]
    )
    .map(
      (row: any): TableRow => ({
        label: row[def.groupBy],
        values: def.aggregates.map((agg) => {
          const v = row[agg]
          return typeof v === 'number' && Number.isFinite(v) ? v : null
        }),
        link: buildRowLink(def, row)
      })
    )
}
