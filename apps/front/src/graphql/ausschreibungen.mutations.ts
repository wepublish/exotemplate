import { gql } from '@apollo/client'

/**
 * Ausschreibungen-Mutationen für den Scout-Review-Workflow.
 *
 * ausschreibungen.id ist ein Int im Directus-Schema → $id: ID! (Directus
 * akzeptiert ID! für numerische IDs, identisch zu applications).
 *
 * Schreibrechte: Token hat volle CRUD auf ausschreibungen (verifiziert 2026-05-29).
 * Der Scout schreibt nur status='scout_unbestaetigt' per Python-Skript.
 * Die UI schreibt nur update status + delete auf scout-Einträgen.
 */

// ─── Status-Konstante ─────────────────────────────────────────────────────────

export const SCOUT_STATUS = 'scout_unbestaetigt' as const

// ─── Scout-Einträge abfragen ──────────────────────────────────────────────────

export const AUSSCHREIBUNGEN_SCOUT = gql`
  query AusschreibungenScout {
    ausschreibungen(
      filter: { status: { _eq: "scout_unbestaetigt" } }
      limit: -1
      sort: ["-id"]
    ) {
      id
      titel
      kategorie
      deadline
      url
      status
    }
  }
`

// ─── Status aktualisieren (Übernehmen → published) ────────────────────────────

export const UPDATE_AUSSCHREIBUNG_STATUS = gql`
  mutation UpdateAusschreibungStatus($id: ID!, $status: String!) {
    update_ausschreibungen_item(id: $id, data: { status: $status }) {
      id
      status
    }
  }
`

// ─── Eintrag löschen (Verwerfen) ──────────────────────────────────────────────

export const DELETE_AUSSCHREIBUNG = gql`
  mutation DeleteAusschreibung($id: ID!) {
    delete_ausschreibungen_item(id: $id) {
      id
    }
  }
`
