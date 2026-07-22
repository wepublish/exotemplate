import { gql } from '@apollo/client'
import { MATCH_TIERS, MATCH_MIN_SCORE } from '../../config/tenant'

/**
 * Roadmap-Zeile eines Mediums (gespeicherte Stationen + Slack-Refs).
 * medium_id und mandant sind String-Felder → Variablen als String!.
 */
export const FAAS_ROADMAP_BY_MEDIUM = gql`
  query FaasRoadmapByMedium($medium: String!, $mandant: String!) {
    faas_roadmap(
      filter: { medium_id: { _eq: $medium }, mandant: { _eq: $mandant } }
      limit: 1
    ) {
      id
      medium_id
      mandant
      stationen
      slack_channel
      canvas_id
    }
  }
`

/**
 * Flag-Query: zaehlt aktive medium_dna fuer das Medium. count > 0 → hatAktiveDna.
 * (Aggregat-Muster wie ueberall im Repo: <collection>_aggregated { count { id } },
 * Rueckgabe ist ein Array.)
 */
export const AKTIVE_MEDIUM_DNA_FLAG = gql`
  query AktiveMediumDnaFlag($medium: String!) {
    medium_dna_aggregated(
      filter: { medium_id: { _eq: $medium }, is_active: { _eq: true } }
    ) {
      count {
        id
      }
    }
  }
`

/**
 * Match-Zahl fuer das Medium — replikiert EXAKT den Filter der Foerderstiftungen-
 * Liste (queries.ts MATCHES): Tier-Gate + Score-Schwelle aus tenant + nur
 * Treffer ohne Projektbezug (projekt_id leer = Medium-Ebene). So ist die Zahl
 * konsistent mit dem, was die Nutzerin auf der Foerderstiftungen-Seite sieht.
 */
export const MATCH_COUNT_FUER_MEDIUM = gql`
  query MatchCountFuerMedium($medium: String!) {
    match_results_aggregated(
      filter: {
        medium_id: { _eq: $medium }
        projekt_id: { _null: true }
        dna_quality_tier: { _in: ${JSON.stringify(MATCH_TIERS)} }
        score: { _gte: ${MATCH_MIN_SCORE} }
      }
    ) {
      count {
        id
      }
    }
  }
`

/**
 * Antraege eines Mediums (fuer die abgeleiteten Stationen-Status + die kleine
 * Antrags-Liste auf der Roadmap-Seite). medium_id/mandant = String!.
 */
export const APPLICATIONS_FUER_MEDIUM = gql`
  query ApplicationsFuerMedium($medium: String!, $mandant: String!) {
    applications(
      filter: { medium_id: { _eq: $medium }, mandant: { _eq: $mandant } }
      limit: -1
      sort: ["-date_updated"]
    ) {
      id
      status
      stiftung_name
      stiftung_id
    }
  }
`

/**
 * Schreibt die gespeicherten Stationen zurueck (read-modify-write des ganzen
 * Arrays in der App). id ist UUID → ID!. Das data-Objekt nutzt den getypten
 * Directus-Input (wie UPDATE_APPLICATION) — der Aufrufer setzt stationen UND
 * aktualisiert_quelle: 'matching-app'.
 */
export const UPDATE_FAAS_ROADMAP = gql`
  mutation UpdateFaasRoadmap($id: ID!, $data: update_faas_roadmap_input!) {
    update_faas_roadmap_item(id: $id, data: $data) {
      id
      stationen
    }
  }
`
