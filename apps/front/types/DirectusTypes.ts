import type { DirectusUser } from "@directus/sdk";

export interface Schema {
  Clients: Client[];
  Clients_Clients: ClientClient[];
  Clients_Periods: ClientPeriod[];
  Clients_directus_users: ClientDirectusUser[];
  Periods: Period[];
  TopUps: TopUp[];
  directus_users: CustomDirectusUser;
  directus_sync_id_map: DirectusSyncIdMap[];
}

export interface Client {
  id: string;
  status: "published" | "draft" | "archived";
  sort: number | null;
  user_created: string | DirectusUser<Schema> | null;
  date_created: string | null;
  user_updated: string | DirectusUser<Schema> | null;
  date_updated: string | null;
  name: string;
  periods: string[] | ClientPeriod[];
  allowedUsers: string[] | ClientDirectusUser[];
}

export interface ClientClient {
  id: number;
  Clients_id: string | Client | null;
  related_Clients_id: string | Client | null;
}

export interface ClientPeriod {
  id: number;
  Clients_id: string | Client | null;
  Periods_id: string | Period | null;
  topUps: number[] | TopUp[];
}

export interface ClientDirectusUser {
  id: number;
  Clients_id: string | Client | null;
  directus_users_id: string | DirectusUser<Schema> | null;
}

export interface Period {
  id: string;
  status: "published" | "draft" | "archived";
  sort: number | null;
  user_created: string | DirectusUser<Schema> | null;
  date_created: string | null;
  user_updated: string | DirectusUser<Schema> | null;
  date_updated: string | null;
  name: string;
  from: string;
  to: string;
}

export interface TopUp {
  id: string;
  status: "published" | "draft" | "archived";
  sort: number | null;
  user_created: string | DirectusUser<Schema> | null;
  date_created: string | null;
  user_updated: string | DirectusUser<Schema> | null;
  date_updated: string | null;
  amount: number;
  note: string | null;
  clientPeriod: number | ClientPeriod | null;
}

export interface CustomDirectusUser {
  clients: string | null;
}

export interface DirectusSyncIdMap {
  id: number;
  table: string;
  sync_id: string;
  local_id: string;
  created_at: string | null;
}

// GeoJSON Types

export interface GeoJSONPoint {
  type: "Point";
  coordinates: [number, number];
}

export interface GeoJSONLineString {
  type: "LineString";
  coordinates: Array<[number, number]>;
}

export interface GeoJSONPolygon {
  type: "Polygon";
  coordinates: Array<Array<[number, number]>>;
}

export interface GeoJSONMultiPoint {
  type: "MultiPoint";
  coordinates: Array<[number, number]>;
}

export interface GeoJSONMultiLineString {
  type: "MultiLineString";
  coordinates: Array<Array<[number, number]>>;
}

export interface GeoJSONMultiPolygon {
  type: "MultiPolygon";
  coordinates: Array<Array<Array<[number, number]>>>;
}

export interface GeoJSONGeometryCollection {
  type: "GeometryCollection";
  geometries: Array<
    | GeoJSONPoint
    | GeoJSONLineString
    | GeoJSONPolygon
    | GeoJSONMultiPoint
    | GeoJSONMultiLineString
    | GeoJSONMultiPolygon
  >;
}