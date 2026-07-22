import { gql } from '@apollo/client'
import { tenant } from '../../config/tenant'

/**
 * Sonder-Matches (Medium × kirchen/foerderer) für ein Medium.
 * Eigene Collection `sonder_match_results` — getrennt von der Haupt-Engine
 * (match_results läuft nur über stiftungen/stiftung_id).
 * medium_id ist ein String-Feld → Variable als String! deklarieren.
 * mandant-Filter inline aus tenant.key (Tenancy-Wahrheit).
 */
export const SONDER_MATCHES = gql`
  query SonderMatches($medium: String!) {
    sonder_match_results(
      filter: { medium_id: { _eq: $medium }, mandant: { _eq: "${tenant.key}" } }
      sort: ["-score"]
      limit: -1
    ) {
      id
      ziel_collection
      ziel_id
      ziel_name
      score
      begruendung
      top_tags
      schaerfe_ziel
      betrag_recherche
    }
  }
`

/**
 * Anträge aus dem Sonder-Matching für ein Medium. Sonder-Anträge tragen
 * `sonder_ref` (<collection>:<id>) statt stiftung_id — Kirchen-/Förderer-IDs
 * würden mit Stiftungs-IDs kollidieren. medium_id/sonder_ref sind String-Felder
 * → Variablen als String! (Typ-Regel gilt pro Feld).
 */
export const SONDER_APPLICATIONS = gql`
  query SonderApplications($medium: String!) {
    applications(
      filter: { medium_id: { _eq: $medium }, sonder_ref: { _nnull: true } }
      limit: -1
      sort: ["-date_updated"]
    ) {
      id
      sonder_ref
      status
      bemerkung
    }
  }
`
