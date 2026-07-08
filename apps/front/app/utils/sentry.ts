// Mirrors the `/sentry/charts` payload shaped by the Directus extension
// (extensions/wepublish/src/sentry + shared/sentry/charts.ts).

export interface SentrySeriesPoint {
  // Epoch milliseconds.
  timestamp: number
  // Aggregate value for the bucket, or null for an empty bucket (a gap).
  value: number | null
}

export interface SentryChartSeries {
  // The aggregate this line represents, e.g. 'p90(span.duration)'.
  name: string
  points: SentrySeriesPoint[]
}

// A shaded horizontal threshold band drawn behind the chart, e.g. a green
// "healthy" zone below some value grading up to a red "bad" zone above it.
export interface ChartBand {
  // Lower bound of the band, in the chart's value unit.
  from: number
  // Upper bound; null means "up to the top of the chart" (open-ended).
  to: number | null
  // Tailwind fill utility class, e.g. 'fill-green-500/10'.
  color: string
}

export interface SentryCacheMeta {
  hit: boolean
  cachedAt: number
  expiresAt: number
  ttlMs: number
}

export interface SentryChart {
  // Stable id, matches the i18n key suffix `sentry.charts.<key>`.
  key: string
  series: SentryChartSeries[]
  yAxes: string[]
  // Value unit, e.g. 'millisecond'.
  unit: string
  // The raw Sentry search query, for display / linking.
  query: string
  statsPeriod: string
  // Deep-link to the exact Sentry explore view this chart mirrors.
  sentryUrl: string
  cache: SentryCacheMeta | null
  // 'unavailable' when this single chart failed upstream; null otherwise.
  error: string | null
}

export interface SentryTableRow {
  // The group-by value (e.g. the SQL query text or a request URL).
  label: string
  // One value per column, aligned with `SentryTable.columns`; null = no data.
  values: (number | null)[]
  // Per-row deep-link into Sentry (e.g. the trace view), or null/undefined when
  // the table defines no per-row link.
  link?: string | null
}

export interface SentryTable {
  // Stable id, matches the i18n key suffix `sentry.tables.<key>`.
  key: string
  // Aggregate per column, e.g. ['p75(span.duration)', …] (for column headers).
  columns: string[]
  rows: SentryTableRow[]
  unit: string
  // How a `count()` column reads: true → per-day rate (total ÷ days), false →
  // an absolute count already scoped to the row (e.g. queries per request).
  countPerDay: boolean
  // Non-`count()` aggregates displayed as a per-day rate (÷ days in
  // `statsPeriod`), e.g. `['sum(span.duration)']` for the impact column.
  perDayAggregates?: string[]
  query: string
  statsPeriod: string
  sentryUrl: string
  cache: SentryCacheMeta | null
  error: string | null
}

export interface SentryData {
  charts: SentryChart[]
  tables: SentryTable[]
}
