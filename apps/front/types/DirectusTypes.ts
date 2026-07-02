import type { DirectusRole, DirectusUser } from '@directus/sdk'

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
  ResourcePlanDefaultLoads: ResourcePlanDefaultLoad[]
  IntensivePhaseAssignees: PlanAssignee[]
  MinLoadAssignees: PlanAssignee[]
  CompanyClosures: CompanyClosure[]
  Settings: Settings
  TopUps: TopUp[]
  directus_users: CustomDirectusUser
  directus_sync_id_map: DirectusSyncIdMap[]
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

/**
 * An annual project load budget used by the resource-planning assistant. One
 * row per (client, year); its intensive phases (O2M `phases`) redistribute the
 * annual hours into specific weeks and/or onto a specific person.
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
  min_assignees?: PlanAssignee[]
}

/**
 * A concentrated block of work inside a ProjectBudget. `clockodo_user_id` set →
 * the phase is a capacity commitment for that person (reduces their available
 * hours in those weeks); unset → it shapes the project's demand curve.
 */
/** A weighted per-person share of a phase or minimum load. */
export interface PlanAssignee {
  id: number
  clockodo_user_id: string
  share: number
}

export interface IntensivePhase {
  id: number
  project_budget: number | ProjectBudget | null
  name: string | null
  from: string
  to: string
  hours: number
  clockodo_user_id: string | null
  assignees?: PlanAssignee[]
}

/**
 * Per-employee resource-planning settings, keyed by Clockodo user id. Carries
 * the weekly "other work" budget subtracted from capacity and an `excluded`
 * flag that toggles the person out of the team total.
 */
export interface ResourcePlanEmployee {
  id: number
  clockodo_user_id: string
  other_work_budget_hours: number
  excluded: boolean
  /** Share of capacity spent on client-project work (0–100, default 100). */
  project_hours_percentage: number
}

/**
 * A company-wide closure (Betriebsferien): a date range where nobody works.
 * Weeks fully covered get zero capacity; planned load redistributes to open
 * weeks.
 */
export interface CompanyClosure {
  id: number
  name: string | null
  from: string
  to: string
}

/**
 * A per-person recurring weekly load for an internal/standing task (reserves
 * capacity). Keyed by Clockodo user id; a person can have several.
 */
export interface ResourcePlanDefaultLoad {
  id: number
  clockodo_user_id: string
  name: string | null
  weekly_hours: number
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

export interface CaptureIgnoredUser {
  id: string
  users_id: number
  reason: string | null
  date_created: string | null
  user_created: string | DirectusUser<Schema> | null
}

export type BillingMode = 'prepaid' | 'monthly'

/** Supported UI / Slack languages. Mirrors `Clients.language` in the backend. */
export type AppLocale = 'de' | 'fr' | 'en'

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
  language: AppLocale
  allowedUsers: string[] | ClientDirectusUser[]
  periods: string[] | ClientPeriod[]
  articles: string[] | PeerArticle[]
  contracts: number[] | Contract[]
  /** User-defined dashboard quick-access links (O2M → `ClientLinks`). */
  links: number[] | ClientLink[]
}

/**
 * A client contract version. Mirrors the `Contracts` collection in the backend
 * (one-directus). Each row is an uploaded PDF (`file`) with a `signed` flag. The
 * latest non-archived `version` is the one "in effect".
 */
export interface Contract {
  id: number
  status: 'published' | 'draft' | 'archived'
  sort: number | null
  client: string | Client | null
  version: number
  /** The uploaded contract PDF (directus_files id). */
  file: string | null
  /** Whether this version is the signed contract. */
  signed: boolean
  signed_at: string | null
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
 * Order-backed invoices (e.g. recurring hosting). A SEPARATE collection from
 * `TopUp`: these never count toward available hours. Mirror of the backend
 * `Invoice` interface. The `type` field discriminates future invoice kinds.
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
  id: string
  accessToClients: string[] | ClientDirectusUser[]
  /** The user's role; `readMe` requests `role: ['name']`. */
  role: string | DirectusRole<Schema> | null
  /**
   * The user's preferred UI language. Stored in the built-in Directus
   * `directus_users.language` field; may hold a bare code (`de`) or a legacy
   * locale tag (`de-DE`) — resolve via `useAppLocale().resolveLocale()`.
   */
  language: string | null
  /**
   * Set for externally-provisioned accounts (e.g. GitHub staff login →
   * `github:<id>`). Present ⇒ the user authenticates via SSO, not a password.
   */
  external_identifier: string | null
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
