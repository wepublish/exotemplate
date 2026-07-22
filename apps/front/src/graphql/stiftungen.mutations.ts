import { gql } from '@apollo/client'

// ─── Stiftung manuell anlegen ─────────────────────────────────────────────────

export const CREATE_STIFTUNG = gql`
  mutation CreateStiftung($data: create_stiftungen_input!) {
    create_stiftungen_item(data: $data) {
      id
      Stiftungsname
      ist_foerderstiftung
    }
  }
`

// ─── Förderstatus global setzen (entfernen / wieder aufnehmen) ─────────────────
//
// Eine Stiftung als «keine Förderstiftung» markieren (ist_foerderstiftung=false)
// nimmt sie aus dem gesamten Matching (alle Medien) und aus der Förder-Ansicht.
// Reversibel: erneut auf true setzen. id ist GraphQLStringOrFloat (numerische id).

export const SET_STIFTUNG_FOERDERSTATUS = gql`
  mutation SetStiftungFoerderstatus($id: ID!, $ist: Boolean!) {
    update_stiftungen_item(id: $id, data: { ist_foerderstiftung: $ist }) {
      id
      ist_foerderstiftung
    }
  }
`

// Alle Match-Treffer einer Stiftung (über ALLE Medien) — zum Löschen beim
// globalen Entfernen, damit sie sofort überall verschwindet (nicht erst beim
// nächsten Re-Match).
export const MATCH_RESULTS_FUER_STIFTUNG = gql`
  query MatchResultsFuerStiftung($stiftungId: GraphQLStringOrFloat!) {
    match_results(filter: { stiftung_id: { _eq: $stiftungId } }, limit: -1) {
      id
    }
  }
`

export const DELETE_MATCH_RESULTS = gql`
  mutation DeleteMatchResults($ids: [ID]!) {
    delete_match_results_items(ids: $ids) {
      ids
    }
  }
`
