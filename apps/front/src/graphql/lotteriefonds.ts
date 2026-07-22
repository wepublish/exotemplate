import { gql } from '@apollo/client'

/**
 * Alle Lotteriefonds-Einträge — read-only, 26 Einträge, keine Pagination nötig.
 * Sortierung nach kanton (Alphabet).
 */
export const LOTTERIEFONDS_ALL = gql`
  query LotteriefondsAll {
    lotteriefonds(limit: -1, sort: ["kanton"]) {
      id
      kanton
      stiftungsname
      status
      url
      url_lotteriefonds
      url_eingabeformular
      antragsformular
      foerderbedingungen
      medientrigger
      wappen_url
      url_kulturfonds
    }
  }
`
