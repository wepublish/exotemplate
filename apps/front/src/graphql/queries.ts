import { gql } from '@apollo/client'
import { MATCH_TIERS, MATCH_MIN_SCORE } from '../../config/tenant'

const MATCH_FELDER = `id medium_id stiftung_id projekt_id score score_breakdown begruendung dna_quality_tier dna_verified betrag_recherche`
const MATCH_GATE = `dna_quality_tier: { _in: ${JSON.stringify(MATCH_TIERS)} }, score: { _gte: ${MATCH_MIN_SCORE} }`

// Medium-Ebene: nur Treffer ohne Projektbezug (projekt_id leer).
export const MATCHES = gql(`query Matches($mediumId: String!) {
  match_results(filter: { medium_id: { _eq: $mediumId }, projekt_id: { _null: true }, ${MATCH_GATE} }, sort: ["-score"], limit: 500) {
    ${MATCH_FELDER}
  }
}`)

// Projekt-Ebene: Treffer fuer ein bestimmtes Projekt.
export const MATCHES_PROJEKT = gql(`query MatchesProjekt($projektId: GraphQLStringOrFloat!) {
  match_results(filter: { projekt_id: { _eq: $projektId }, ${MATCH_GATE} }, sort: ["-score"], limit: 500) {
    ${MATCH_FELDER}
  }
}`)
export const STIFTUNGEN = gql`query Stiftungen($ids: [GraphQLStringOrFloat]!) {
  stiftungen(filter: { id: { _in: $ids } }, limit: -1) { id Stiftungsname webseite foerderbeitraege foerdersummen_range }
}`
export const DNAS = gql`query Dnas($ids: [GraphQLStringOrFloat]!) {
  stiftungs_dna(filter: { stiftung_id: { id: { _in: $ids } }, is_active: { _eq: true } }, limit: -1) {
    stiftung_id { id } tags sound_feeling schaerfe_prozent quellen
  }
}`
