import axios, { AxiosInstance } from 'axios'

export interface SentryConfig {
  // Region base URL, e.g. https://de.sentry.io (org lives on a region host).
  apiUrl: string
  // Organisation slug, e.g. wepublish-foundation.
  org: string
  // User auth token (sntryu_…) — held only in Directus env, never shipped to
  // the browser (see the monitoring/Clockodo/Jira precedent).
  token: string
}

export interface EventsParams {
  // Columns to return, e.g. ['span.description', 'p75(span.duration)', …]. A
  // non-aggregate field (span.description) makes this a grouped-by-that-field
  // query; the aggregates become the per-group columns.
  fields: string[]
  // Sentry search syntax, e.g. 'span.op:db db.name:wepublish-eenews-production'.
  query: string
  // Relative window, e.g. '30d'.
  statsPeriod: string
  // Sort spec, e.g. '-p95(span.duration)' (descending).
  sort: string
  // Row cap (top-N).
  perPage: number
  // Project id filter; '-1' = all projects in the org.
  project?: string
}

export interface EventsStatsParams {
  // One or more aggregates to chart, e.g. ['p99(span.duration)'] or
  // ['p75(span.duration)', 'p90(span.duration)']. With a single axis Sentry
  // returns a top-level `{ data }` block; with several it returns one block
  // keyed per axis. `normalizeChartSeries` handles both.
  yAxes: string[]
  // Sentry search syntax, e.g. 'span.op:db db.name:wepublish-eenews-production'.
  query: string
  // Relative window, e.g. '30d'.
  statsPeriod: string
  // Bucket size, e.g. '4h'.
  interval: string
  // Project id filter; '-1' = all projects in the org.
  project?: string
}

/**
 * Thin proxy over Sentry's HTTP API. Only covers the `events-stats` timeseries
 * endpoint we need; the token stays in Directus env. Mirrors the InfraService
 * pattern used by the monitoring endpoint.
 */
export class SentryService {
  private readonly http: AxiosInstance
  private readonly org: string

  constructor(config: SentryConfig) {
    this.org = config.org
    this.http = axios.create({
      baseURL: config.apiUrl.replace(/\/+$/, ''),
      headers: { Authorization: `Bearer ${config.token}` }
    })
  }

  /**
   * Returns Sentry's raw events-stats timeseries:
   * `{ data: [[unixSeconds, [{ count }]], …] }`. Normalise with
   * `normalizeEventsStats` before shipping to the frontend.
   */
  async getEventsStats(params: EventsStatsParams): Promise<any> {
    const { data } = await this.http.get(
      `/api/0/organizations/${encodeURIComponent(this.org)}/events-stats/`,
      {
        params: {
          dataset: 'spans',
          yAxis: params.yAxes,
          query: params.query,
          statsPeriod: params.statsPeriod,
          interval: params.interval,
          project: params.project ?? '-1',
          referrer: 'api.wepublish.one'
        },
        // Sentry expects repeated `yAxis=a&yAxis=b` (no `[]` suffix / index) for
        // multi-series requests; axios' default array serializer would emit
        // `yAxis[]=…`, which Sentry ignores.
        paramsSerializer: { indexes: null }
      }
    )
    return data
  }

  /**
   * Returns Sentry's raw events (table) payload:
   * `{ data: [{ '<field>': value, … }], meta: {…} }`. Grouping by a
   * non-aggregate field yields one row per group value. Normalise with
   * `normalizeEventsTable`.
   */
  async getEvents(params: EventsParams): Promise<any> {
    const { data } = await this.http.get(
      `/api/0/organizations/${encodeURIComponent(this.org)}/events/`,
      {
        params: {
          dataset: 'spans',
          field: params.fields,
          query: params.query,
          statsPeriod: params.statsPeriod,
          sort: params.sort,
          per_page: params.perPage,
          project: params.project ?? '-1',
          referrer: 'api.wepublish.one'
        },
        // Repeated `field=a&field=b`, same rationale as getEventsStats.
        paramsSerializer: { indexes: null }
      }
    )
    return data
  }
}
