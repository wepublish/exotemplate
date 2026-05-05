import type { DirectusUser } from '@directus/sdk'

export interface Schema {
  Clients: Client[]
  Clients_Periods: ClientPeriod[]
  Clients_directus_users: ClientDirectusUser[]
  JiraWarnings: JiraWarning[]
  ManualWorkEntries: ManualWorkEntry[]
  NotificationThresholds: NotificationThreshold[]
  PeerArticles: PeerArticle[]
  Periods: Period[]
  TopUps: TopUp[]
  directus_users: CustomDirectusUser
  directus_sync_id_map: DirectusSyncIdMap[]
}

export interface Client {
  clockodo_customer_id: string | null
  date_created: string | null
  date_updated: string | null
  id: string
  jira_short_code: string | null
  name: string
  sort: number | null
  status: 'published' | 'draft' | 'archived'
  user_created: string | DirectusUser<Schema> | null
  user_updated: string | DirectusUser<Schema> | null
  bexio_contact_id: number | null
  apiUrl: string | null
  slack_channel_id: string | null
  onboarding_current_step: number | null
  onboarding_manual_checklist: string[] | null
  notifications_paused: boolean
  weekly_report_paused: boolean
  allowedUsers: string[] | ClientDirectusUser[]
  periods: string[] | ClientPeriod[]
  articles: string[] | PeerArticle[]
}

export interface NotificationThreshold {
  id: string
  status: 'published' | 'draft' | 'archived'
  sort: number | null
  date_created: string | null
  date_updated: string | null
  user_created: string | DirectusUser<Schema> | null
  user_updated: string | DirectusUser<Schema> | null
  min_hours_inclusive: number
  initial_threshold_offset_hours: number
  recurring_threshold_hours: number
}

export interface JiraWarning {
  id: string
  status: 'published' | 'draft' | 'archived'
  sort: number | null
  date_created: string | null
  date_updated: string | null
  user_created: string | DirectusUser<Schema> | null
  user_updated: string | DirectusUser<Schema> | null
  client: string | Client | null
  jira_issue_key: string
  last_notified_hours: number | null
  next_threshold_hours: number | null
  halt_requested: boolean
  halt_requested_by: string | DirectusUser<Schema> | null
  halt_requested_at: string | null
  halt_resolved_by: string | DirectusUser<Schema> | null
  halt_resolved_at: string | null
  silenced_permanently: boolean
  silenced_by: string | DirectusUser<Schema> | null
  silenced_at: string | null
}

export interface ClientPeriod {
  Clients_id: string | Client | null
  Periods_id: string | Period | null
  id: number
  manualWorkEntries: number[] | ManualWorkEntry[]
  topUps: number[] | TopUp[]
}

export interface ClientDirectusUser {
  Clients_id: string | Client | null
  directus_users_id: string | DirectusUser<Schema> | null
  id: number
}

export interface ManualWorkEntry {
  clientPeriod: number | ClientPeriod | null
  date: string | null
  date_created: string | null
  date_updated: string | null
  description: string | null
  hours: number | null
  id: string
  sort: number | null
  status: 'published' | 'draft' | 'archived'
  title: string | null
  user_created: string | DirectusUser<Schema> | null
  user_updated: string | DirectusUser<Schema> | null
}

export interface PeerArticle {
  id: string
  status: 'published' | 'draft' | 'archived'
  sort: number | null
  user_created: string | DirectusUser<Schema> | null
  date_created: string | null
  user_updated: string | DirectusUser<Schema> | null
  date_updated: string | null
  source_id: string
  source_publishedAt: string
  source_url: string | null
  source_title: string | null
  source_slug: string
  source_imageUrl: string | null
  client: string | Client | null
  source_lead: string | null
}

export interface Period {
  date_created: string | null
  date_updated: string | null
  from: string
  id: string
  name: string | null
  sort: number | null
  status: 'published' | 'draft' | 'archived'
  to: string
  user_created: string | DirectusUser<Schema> | null
  user_updated: string | DirectusUser<Schema> | null
}

export interface TopUp {
  amount: number | null
  clientPeriod: number | ClientPeriod | null
  date_created: string | null
  date_updated: string | null
  hourlyRate: number
  id: string
  note: string | null
  sort: number | null
  status: 'published' | 'draft' | 'archived'
  user_created: string | DirectusUser<Schema> | null
  user_updated: string | DirectusUser<Schema> | null
  wepPercentage: number | null
  bexioInvoiceId: number | null
}

export interface CustomDirectusUser {
  id: string
  accessToClients: string[] | ClientDirectusUser[]
}

export interface DirectusSyncIdMap {
  id: number
  table: string
  sync_id: string
  local_id: string
  created_at: string | null
}

// GeoJSON Types

export interface GeoJSONPoint {
  type: 'Point'
  coordinates: [number, number]
}

export interface GeoJSONLineString {
  type: 'LineString'
  coordinates: Array<[number, number]>
}

export interface GeoJSONPolygon {
  type: 'Polygon'
  coordinates: Array<Array<[number, number]>>
}

export interface GeoJSONMultiPoint {
  type: 'MultiPoint'
  coordinates: Array<[number, number]>
}

export interface GeoJSONMultiLineString {
  type: 'MultiLineString'
  coordinates: Array<Array<[number, number]>>
}

export interface GeoJSONMultiPolygon {
  type: 'MultiPolygon'
  coordinates: Array<Array<Array<[number, number]>>>
}

export interface GeoJSONGeometryCollection {
  type: 'GeometryCollection'
  geometries: Array<
    | GeoJSONPoint
    | GeoJSONLineString
    | GeoJSONPolygon
    | GeoJSONMultiPoint
    | GeoJSONMultiLineString
    | GeoJSONMultiPolygon
  >
}
