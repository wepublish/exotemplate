import { gql } from '@apollo/client'

/**
 * Browse-Query: Stiftungsliste mit Pagination und dynamischem Filter.
 * Felder: alles für die FunderCard, ohne DNA (kein N+1).
 */
export const STIFTUNGEN_BROWSE = gql`
  query StiftungenBrowse($filter: stiftungen_filter, $offset: Int) {
    stiftungen(
      filter: $filter
      limit: 50
      offset: $offset
      sort: ["Stiftungsname"]
    ) {
      id
      Stiftungsname
      webseite
      logo_url
      sitz
      region
      kategorie
      foerdersummen_range
      foerderbeitraege
      land
      verifiziert
      datenqualitaet
      ist_foerderstiftung
      deadline
    }
  }
`

/**
 * Schlanke Stiftungs-Suche nach Name (für den Anträge-Import-Picker).
 * _icontains auf Stiftungsname; max 8 Treffer.
 */
export const STIFTUNGEN_SUCHE = gql`
  query StiftungenSuche($q: String!) {
    stiftungen(filter: { Stiftungsname: { _icontains: $q } }, limit: 8, sort: ["Stiftungsname"]) {
      id
      Stiftungsname
    }
  }
`

/**
 * Aggregat-Query für Gesamtzahl (Pagination).
 */
export const STIFTUNGEN_COUNT = gql`
  query StiftungenCount($filter: stiftungen_filter) {
    stiftungen_aggregated(filter: $filter) {
      count {
        id
      }
    }
  }
`

/**
 * Detail-Query: Stammdaten + aktive DNA für den Dialog.
 */
export const STIFTUNG_DETAIL = gql`
  query StiftungDetail($id: GraphQLStringOrFloat!) {
    stiftungen(filter: { id: { _eq: $id } }, limit: 1) {
      id
      Stiftungsname
      webseite
      logo_url
      sitz
      region
      region_fokus
      kategorie
      land
      foerdersummen_range
      foerderbeitraege
      deadline
      antragsform
      einreichungsform_verifiziert
      foerderbedingungen
      zwecktext
      ansprechsperson
      email
      stiftungsraete
      info_link
      zefix_link
      verifiziert
      datenqualitaet
      ist_foerderstiftung
    }
    stiftungs_dna(
      filter: {
        stiftung_id: { id: { _eq: $id } }
        is_active: { _eq: true }
      }
      limit: 1
    ) {
      schaerfe_prozent
      sound_feeling
      tags
      exclusion_tags
      foerderpraxis
      quellen
      version_number
      vocabulary_version_at_creation
    }
  }
`
