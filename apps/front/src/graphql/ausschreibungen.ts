import { gql } from '@apollo/client'

/**
 * Alle Ausschreibungen — read-only, keine Pagination nötig (40 Einträge).
 * Sortierung clientseitig nach deadline (nächste zuerst, null ans Ende).
 */
export const AUSSCHREIBUNGEN_ALL = gql`
  query AusschreibungenAll {
    ausschreibungen(limit: -1, sort: ["deadline"]) {
      id
      titel
      kategorie
      status
      deadline
      url
    }
  }
`
