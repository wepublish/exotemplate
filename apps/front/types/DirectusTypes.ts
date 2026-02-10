import type { DirectusUser } from '@directus/sdk'

export interface Schema {
  Clients: Client[]
  Clients_Periods: ClientPeriod[]
  Clients_directus_users: ClientDirectusUser[]
  ManualWorkEntries: ManualWorkEntry[]
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
  allowedUsers: string[] | ClientDirectusUser[]
  periods: string[] | ClientPeriod[]
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
