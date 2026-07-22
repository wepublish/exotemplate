import { gql } from '@apollo/client'
import { tenant } from '../../config/tenant'

/**
 * pakete.ts — GraphQL-Queries und Mutationen für den Sichtungs-Stapel.
 *
 * Der Paket-Builder legt nachts applications mit status=identifiziert,
 * zuletzt_geaendert_quelle=paket-builder und gesichtet_am=null an.
 * Der Sichtungs-Stapel zeigt genau diese, eine nach der anderen.
 */

export const PAKETE_ZU_SICHTEN = gql`
  query PaketeZuSichten {
    applications(
      filter: {
        zuletzt_geaendert_quelle: { _eq: "paket-builder" }
        status: { _eq: "identifiziert" }
        gesichtet_am: { _null: true }
        mandant: { _eq: "${tenant.key}" }
      }
      limit: -1
      sort: ["date_created"]
    ) {
      id
      medium_id
      stiftung_id
      stiftung_name
      status
      gesichtet_am
      paket
    }
  }
`

/** Paket als gesichtet markieren (Übernehmen). */
export const PAKET_UEBERNEHMEN = gql`
  mutation PaketUebernehmen($id: ID!, $jetzt: String!) {
    update_applications_item(
      id: $id
      data: {
        gesichtet_am: $jetzt
        zuletzt_geaendert_quelle: "cockpit-sichtung"
      }
    ) {
      id
      gesichtet_am
      zuletzt_geaendert_quelle
    }
  }
`

/** Paket verwerfen: status auf ausgeblendet setzen, optional mit Bemerkung. */
export const PAKET_VERWERFEN = gql`
  mutation PaketVerwerfen($id: ID!, $bemerkung: String) {
    update_applications_item(
      id: $id
      data: {
        status: "ausgeblendet"
        zuletzt_geaendert_quelle: "cockpit-sichtung"
        bemerkung: $bemerkung
      }
    ) {
      id
      status
      bemerkung
    }
  }
`

/**
 * Zugehörige Outbox-Einträge auf status=entwurf promoten (Batch-Variante).
 * Directus bietet update_<collection>_items(ids, data) standardmässig an.
 * Falls der Batch-Call fehlschlägt, fällt der Container auf sequenzielle
 * Einzel-Mutationen zurück (OUTBOX_PROMOTE_EINZEL).
 */
export const OUTBOX_PROMOTE = gql`
  mutation OutboxPromote($ids: [ID!]!, $status: String!) {
    update_agent_outbox_items(ids: $ids, data: { status: $status }) {
      id
      status
    }
  }
`

/** Einzel-Fallback falls der Batch-Call nicht unterstützt wird. */
export const OUTBOX_PROMOTE_EINZEL = gql`
  mutation OutboxPromoteEinzel($id: ID!, $status: String!) {
    update_agent_outbox_item(id: $id, data: { status: $status }) {
      id
      status
    }
  }
`

/**
 * Outbox-Einträge beim Verwerfen eines Pakets auf status=verworfen setzen (Batch).
 * Gleiche Fallback-Logik wie beim Promoten.
 */
export const OUTBOX_VERWERFEN_BATCH = gql`
  mutation OutboxVerwerfenBatch($ids: [ID!]!) {
    update_agent_outbox_items(ids: $ids, data: { status: "verworfen" }) {
      id
      status
    }
  }
`

/** Einzel-Fallback für den Verwerfen-Batch. */
export const OUTBOX_VERWERFEN_EINZEL = gql`
  mutation OutboxVerwerfenEinzel($id: ID!) {
    update_agent_outbox_item(id: $id, data: { status: "verworfen" }) {
      id
      status
    }
  }
`

/**
 * Neuen Outbox-Eintrag anlegen (z.B. manueller Nachfass-Entwurf aus dem Kanban).
 */
export const CREATE_OUTBOX = gql`
  mutation CreateOutbox($data: create_agent_outbox_input!) {
    create_agent_outbox_item(data: $data) {
      id
      status
    }
  }
`

/**
 * Prüft, ob für eine application + dedup_key bereits ein offener Eintrag existiert.
 */
export const OUTBOX_DEDUP_CHECK = gql`
  query OutboxDedupCheck($dedupKey: String!) {
    agent_outbox(
      filter: {
        dedup_key: { _eq: $dedupKey }
        status: { _in: ["entwurf", "vorbereitet"] }
      }
      limit: 1
    ) {
      id
    }
  }
`

/**
 * Offene Outbox-Einträge zu einem Antrag abfragen.
 * Wird beim nachträglichen Ausblenden eines Antrags genutzt, um
 * zugehörige Entwürfe mitzuverwerfen.
 */
export const OUTBOX_FUER_APPLICATION = gql`
  query OutboxFuerApplication($appId: GraphQLStringOrFloat!) {
    agent_outbox(
      filter: {
        application_id: { _eq: $appId }
        status: { _in: ["vorbereitet", "entwurf"] }
      }
      limit: 50
    ) {
      id
    }
  }
`
