import { gql } from '@apollo/client'
import { tenant, MATCH_TIERS, MATCH_MIN_SCORE } from '../../config/tenant'

/**
 * Listen-Query: aktive medium_dna-Einträge, sortiert nach Schärfe absteigend.
 * Tags werden mitgeladen (für die Tag-Zahl auf der Card).
 * Nur Felder, die in der Card-Anzeige benötigt werden — kein sound_feeling,
 * keine quellen (enthält interne Pfade), keine evidenz.
 */
export const MEDIEN_LIST = gql`
  query MedienList {
    medium_dna(
      filter: { is_active: { _eq: true } }
      sort: ["-schaerfe_prozent"]
    ) {
      id
      medium_id
      medium_name
      schaerfe_prozent
      version
      vocabulary_version_at_creation
      antragsteller_typ
      tags
    }
  }
`

/**
 * Detail-Query: volle DNA eines Mediums.
 * medium_id wird inline eingebettet (aus fester tenant.clients-Liste), um
 * den GraphQLStringOrFloat-Scalar-Typ-Mismatch bei Variablen zu umgehen
 * (vgl. STIFTUNG_DETAIL-Query mit $id: GraphQLStringOrFloat!).
 *
 * Felder, die interne Pfade enthalten (datensuppe_pfad, datensuppe_inventar,
 * web_recherche_urls, tags[].evidenz), werden NICHT selektiert — nur was
 * in der Anzeige erscheinen darf.
 */
function buildMediumDetailQueryString(mediumId: string): string {
  return `
    query MediumDetail {
      medium_dna(
        filter: {
          medium_id: { _eq: "${mediumId}" }
          is_active: { _eq: true }
        }
        limit: 1
      ) {
        id
        medium_id
        medium_name
        schaerfe_prozent
        version
        vocabulary_version_at_creation
        antragsteller_typ
        sound_feeling
        tags
        sektionen
        foerderpraxis
        quellen
        exclusion_tags
      }
      match_results_aggregated(
        filter: {
          medium_id: { _eq: "${mediumId}" }
          dna_quality_tier: { _in: ${JSON.stringify(MATCH_TIERS)} }
          score: { _gte: ${MATCH_MIN_SCORE} }
        }
      ) {
        count { id }
      }
    }
  `
}

/**
 * Vorkompilierte Detail-Queries pro Medium (aus tenant.clients).
 * Zugriff: MEDIUM_DETAIL_QUERIES['wepublish'] etc.
 */
export const MEDIUM_DETAIL_QUERIES: Record<string, ReturnType<typeof gql>> = Object.fromEntries(
  tenant.clients.map(id => [id, gql(buildMediumDetailQueryString(id))])
)

/**
 * Kontakt-Stammdaten eines Mediums aus faas_medien (für den E-Mail-Editor).
 * slug/mandant sind String-Felder → Variablen als String!. id wird für die
 * Update-Mutation gebraucht.
 */
export const FAAS_MEDIUM_KONTAKT = gql`
  query FaasMediumKontakt($slug: String!, $mandant: String!) {
    faas_medien(filter: { slug: { _eq: $slug }, mandant: { _eq: $mandant } }, limit: 1) {
      id
      slug
      name
      kontakt_emails
    }
  }
`

/**
 * Schreibt die kontakt_emails (json-Array) eines Mediums zurück. id ist die
 * faas_medien-PK → ID!. data nutzt den getypten Directus-Input (wie bei der
 * Roadmap-Mutation); der Aufrufer setzt { kontakt_emails: string[] }.
 */
export const UPDATE_FAAS_MEDIUM_KONTAKT = gql`
  mutation UpdateFaasMediumKontakt($id: ID!, $data: update_faas_medien_input!) {
    update_faas_medien_item(id: $id, data: $data) {
      id
      kontakt_emails
    }
  }
`
