import { gql } from '@apollo/client'

// ─── Status/Station-Map ───────────────────────────────────────────────────────

/** Kanonische Abbildung status → station (Int). */
export const STATUS_STATION: Record<string, number> = {
  identifiziert: 1,
  in_arbeit:     2,
  eingereicht:   3,
  zugesagt:      4,
  abgelehnt:     5,
  archiviert:    6,
  ausgeblendet:  7,
}

/** Status-Optionen für das Board (ohne archiviert/ausgeblendet). */
export const ARBEITS_STATUS: Array<{ value: string; label: string }> = [
  { value: 'identifiziert', label: 'Identifiziert' },
  { value: 'in_arbeit',     label: 'In Arbeit' },
  { value: 'eingereicht',   label: 'Eingereicht' },
  { value: 'zugesagt',      label: 'Zugesagt' },
  { value: 'abgelehnt',     label: 'Abgelehnt' },
]

// ─── Mutation: Antrag erstellen ───────────────────────────────────────────────

export const CREATE_APPLICATION = gql`
  mutation CreateApplication($data: create_applications_input!) {
    create_applications_item(data: $data) {
      id
      status
      station
    }
  }
`

// ─── Mutation: Antrag aktualisieren ──────────────────────────────────────────

export const UPDATE_APPLICATION = gql`
  mutation UpdateApplication($id: ID!, $data: update_applications_input!) {
    update_applications_item(id: $id, data: $data) {
      id
      status
      station
      betrag_zugesagt_chf
      bemerkung
      verantwortung
    }
  }
`

// ─── Mutation: Antrag löschen ─────────────────────────────────────────────────

export const DELETE_APPLICATION = gql`
  mutation DeleteApplication($id: ID!) {
    delete_applications_item(id: $id) {
      id
    }
  }
`

// ─── Query: Anträge für ein Medium ───────────────────────────────────────────
// medium_id ist ein String-Feld → die _eq-Variable MUSS String! sein, NICHT
// GraphQLStringOrFloat (der Custom-Scalar gilt nur für numerische Felder wie id).

export const APPLICATIONS_FOR_MEDIUM = gql`
  query ApplicationsForMedium($medium: String!) {
    applications(
      filter: { medium_id: { _eq: $medium } }
      limit: -1
      sort: ["-date_updated"]
    ) {
      id
      stiftung_id
      match_result_id
      status
      station
      stiftung_name
      betrag_zugesagt_chf
      bemerkung
      verantwortung
    }
  }
`
// Hinweis: bemerkung ist bereits im obigen Query enthalten und wird in
// ApplicationSnap (MatchRow.tsx) geführt, damit der Ausblende-Grund
// unter dem Badge angezeigt werden kann.
