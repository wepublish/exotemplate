import { gql } from '@apollo/client'
import { tenant } from '../../config/tenant'

/**
 * Kanal-Daten aller aktiven Medien (fuer Nachfassen-Knopf im Kanban).
 * Liefert nur slug + slack_channel + kontakt_emails.
 */
export const MEDIEN_KANAELE = gql`
  query MedienKanaele {
    faas_medien(
      filter: { is_active: { _eq: true }, mandant: { _eq: "${tenant.key}" } }
      limit: -1
    ) {
      slug
      slack_channel
      kontakt_emails
    }
  }
`

/**
 * Alle Anträge — read-only, auf den Mandanten gefiltert.
 * Ausgeblendet: archiviert, ausgeblendet — nur die 5 Arbeits-Status werden gezeigt.
 */
export const APPLICATIONS_ALL = gql`
  query ApplicationsAll {
    applications(
      limit: -1
      sort: ["-date_updated"]
      filter: {
        status: { _nin: ["archiviert", "ausgeblendet"] }
        mandant: { _eq: "${tenant.key}" }
      }
    ) {
      id
      medium_id
      stiftung_id
      stiftung_name
      match_result_id
      station
      status
      betrag_chf
      betrag_zugesagt_chf
      frist
      eingereicht_am
      entschieden_am
      drive_link
      slack_thread_url
      sonder_ref
      bemerkung
      verantwortung
      paket
      portal
      date_created
      date_updated
    }
  }
`

/**
 * Ausgeblendete Einträge — schlanke Query für die Nachvollziehbarkeits-Sektion.
 * Optional nach medium_id gefiltert (null = alle Medien).
 */
export const AUSGEBLENDETE_APPLICATIONS = gql`
  query AusgeblendetApplications($medium: String) {
    applications(
      limit: -1
      sort: ["-date_created"]
      filter: {
        status: { _eq: "ausgeblendet" }
        mandant: { _eq: "${tenant.key}" }
      }
    ) {
      id
      medium_id
      stiftung_id
      stiftung_name
      bemerkung
      date_created
      zuletzt_geaendert_quelle
    }
  }
`
