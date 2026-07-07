import type { DirectusUser } from '@directus/sdk'

export interface Schema {
  BillingSnapshots: BillingSnapshot[]
  CaptureIgnoredUsers: CaptureIgnoredUser[]
  Clients: Client[]
  ClientLinks: ClientLink[]
  Contracts: Contract[]
  Clients_Periods: ClientPeriod[]
  Clients_directus_users: ClientDirectusUser[]
  Invoices: Invoice[]
  JiraWarnings: JiraWarning[]
  ManualWorkEntries: ManualWorkEntry[]
  NotificationThresholds: NotificationThreshold[]
  PeerArticles: PeerArticle[]
  Periods: Period[]
  ProjectBudgets: ProjectBudget[]
  IntensivePhases: IntensivePhase[]
  ResourcePlanEmployees: ResourcePlanEmployee[]
  Announcements: Announcement[]
  Announcements_translations: AnnouncementTranslation[]
  Announcements_clients: AnnouncementClient[]
  Settings: Settings
  TopUps: TopUp[]
  directus_users: CustomDirectusUser
  directus_sync_id_map: DirectusSyncIdMap[]
}

/**
 * Annual project load budget for the resource-planning assistant. One row per
 * (client, year); its intensive phases (O2M `phases`) redistribute the annual
 * hours into specific weeks and/or onto a specific person.
 */
export interface ProjectBudget {
  id: number
  client: string | Client | null
  year: number
  annual_budget_hours: number
  /** Minimum weekly load (lower border) for this project. */
  min_weekly_hours: number
  /** If set, the minimum weekly load is a direct assignment to this Clockodo user. */
  min_weekly_clockodo_user_id: string | null
  phases?: IntensivePhase[]
}

/**
 * A concentrated block of work inside a ProjectBudget. `clockodo_user_id` set →
 * a capacity commitment for that person (reduces their available hours in those
 * weeks); unset → it shapes the project's demand curve.
 */
export interface IntensivePhase {
  id: number
  project_budget: number | ProjectBudget | null
  name: string | null
  from: string
  to: string
  hours: number
  clockodo_user_id: string | null
}

/**
 * Per-employee resource-planning settings keyed by Clockodo user id: weekly
 * "other work" budget (subtracted from capacity) + an `excluded` flag that
 * toggles the person out of the team total.
 */
export interface ResourcePlanEmployee {
  id: number
  clockodo_user_id: string
  other_work_budget_hours: number
  excluded: boolean
}

export interface BillingSnapshot {
  id: string
  clientPeriodId: number | ClientPeriod
  totalUsedHours: number
  totalTopUps: number
  totalUsedPercentage: number
  totalAvailableHours: number
  totalManualWorkHours: number
  billableHours: number
  computedAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  date_created: string | null
  date_updated: string | null
}

export interface Settings {
  slack_time_tracking_channel_id: string | null
  /** Slack channel ID of the network-wide #we-share channel, linked from the dashboard. */
  slack_we_share_channel_id: string | null
}

/**
 * A user-defined quick-access link for a client, shown on the dashboard
 * quick-links tile. Its own collection (`ClientLinks`), M2O → `Clients`, so the
 * links are structured rows rather than a JSON blob. Editable by the client
 * team and admins.
 */
export interface ClientLink {
  id: number
  status: 'published' | 'draft' | 'archived'
  sort: number | null
  client: string | Client | null
  label: string
  url: string
  description: string | null
  date_created: string | null
  date_updated: string | null
  user_created: string | DirectusUser<Schema> | null
  user_updated: string | DirectusUser<Schema> | null
}

export type AnnouncementSeverity = 'info' | 'warning' | 'critical'

/** M2M junction row: which media an announcement targets. */
export interface AnnouncementClient {
  id: number
  announcements_id: number | Announcement | null
  clients_id: string | Client | null
}

export interface AnnouncementTranslation {
  id: number
  announcement: number | Announcement | null
  locale: 'de' | 'fr' | 'en' | string
  title: string | null
  body: string | null
  link_label: string | null
}

/**
 * A dashboard/editor message. `client` empty = general (all media); otherwise
 * scoped to that medium. Served publicly (unauthenticated) via `/messages` for
 * the dashboard and the external editor. Optional `translations` override the
 * base title/body/link_label per locale (falling back to the base fields).
 */
export interface Announcement {
  id: number
  status: 'published' | 'draft' | 'archived'
  sort: number | null
  severity: AnnouncementSeverity
  title: string
  body: string | null
  link_label: string | null
  link_url: string | null
  starts_at: string | null
  ends_at: string | null
  dismissible: boolean
  // Target media (M2M). Empty = general (all media); otherwise the selected media.
  clients: AnnouncementClient[] | null
  translations: AnnouncementTranslation[] | null
  date_created: string | null
  date_updated: string | null
}

export interface CaptureIgnoredUser {
  id: string
  users_id: number
  reason: string | null
  date_created: string | null
  user_created: string | DirectusUser<Schema> | null
}

export type BillingMode = 'prepaid' | 'monthly'

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
  /**
   * Terraform medium identifier (lowercase letters, digits, underscores) — the
   * "Medium-Name" from onboarding. Maps this client to its monitor in the
   * infrastructure-configurator for uptime/health. Admin-managed.
   */
  medium_name: string | null
  /** Override for the dashboard editor link; falls back to deriving from `apiUrl`. */
  editor_url: string | null
  /** Override for the dashboard website link; falls back to deriving from `apiUrl`. */
  website_url: string | null
  notifications_paused: boolean
  weekly_report_paused: boolean
  billing_mode: BillingMode
  /** Drives the language of this project's client-facing Slack messages. */
  language: 'de' | 'fr' | 'en'
  allowedUsers: string[] | ClientDirectusUser[]
  periods: string[] | ClientPeriod[]
  articles: string[] | PeerArticle[]
  contracts: number[] | Contract[]
  /** User-defined dashboard quick-access links (O2M → `ClientLinks`). */
  links: number[] | ClientLink[]
}

export interface Contract {
  id: number
  status: 'published' | 'draft' | 'archived'
  sort: number | null
  client: string | Client | null
  /** Per-client version number, starting at 1. The latest is the one "in effect". */
  version: number
  /** The uploaded contract PDF (directus_files id). */
  file: string | null
  /** Whether this version is the signed contract. */
  signed: boolean
  /** When the contract was marked signed / the signed PDF uploaded. */
  signed_at: string | null
  /** Optional note describing what changed in this version. */
  notes: string | null
  date_created: string | null
  date_updated: string | null
  user_created: string | DirectusUser<Schema> | null
  user_updated: string | DirectusUser<Schema> | null
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
  invoices: number[] | Invoice[]
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

/**
 * Order-backed invoices (e.g. recurring hosting). Deliberately a SEPARATE
 * collection from `TopUp`: these are NEVER part of the available-hours
 * calculation — `aggregateHours` only ever receives `TopUp[]`, never `Invoice[]`.
 * The `type` field discriminates future order-backed invoice kinds.
 */
export interface Invoice {
  id: string
  status: 'published' | 'draft' | 'archived'
  sort: number | null
  date_created: string | null
  date_updated: string | null
  user_created: string | DirectusUser<Schema> | null
  user_updated: string | DirectusUser<Schema> | null
  clientPeriod: number | ClientPeriod | null
  type: string
  title: string | null
  description: string | null
  bexioOrderId: number | null
  bexioInvoiceId: number | null
  unitPrice: number | null
  quantity: number | null
  billedUnits: number | null
  periodicity: string | null
  amount: number | null
}

export interface CustomDirectusUser {
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
