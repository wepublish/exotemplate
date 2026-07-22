import { gql } from '@apollo/client'
import { tenant } from '../../config/tenant'

const M = `mandant: { _eq: "${tenant.key}" }`

/** ISO-Zeitpunkt vor `tage` Tagen (für den Nachfass-Schwellwert). */
export function schwelleVorTagen(tage: number, jetzt = new Date()): string {
  return new Date(jetzt.getTime() - tage * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Fünf Zaehler für den «Heute»-Strom:
 *  - sichten:    ungesichtete Pakete (applications mit paket, ohne gesichtet_am, Status identifiziert)
 *  - freigeben:  offene Outbox-Entwürfe (status entwurf)
 *  - nachfassen: eingereichte Anträge, deren eingereicht_am älter als der Schwellwert ist
 *  - frist:      offene Vorschläge vom Typ frist
 *  - ausgang:    Anträge lange in Arbeit ohne Statuswechsel (Ausgang nachtragen)
 * `schwelle` = now - 10 Tage (nachfassen), `schwelleAusgang` = now - 14 Tage.
 */
export function cockpitZaehlerQuery(schwelle: string, schwelleAusgang: string) {
  return gql`
    query CockpitZaehler {
      sichten: applications_aggregated(
        filter: { status: { _eq: "identifiziert" }, gesichtet_am: { _null: true }, paket: { _nnull: true }, ${M} }
      ) {
        count { id }
      }
      freigeben: agent_outbox_aggregated(
        filter: { status: { _eq: "entwurf" }, ${M} }
      ) {
        count { id }
      }
      nachfassen: applications_aggregated(
        filter: { status: { _eq: "eingereicht" }, eingereicht_am: { _lte: "${schwelle}" }, ${M} }
      ) {
        count { id }
      }
      frist: agent_vorschlaege_aggregated(
        filter: { status: { _eq: "offen" }, typ: { _eq: "frist" }, ${M} }
      ) {
        count { id }
      }
      ausgang: applications_aggregated(
        filter: { status: { _eq: "in_arbeit" }, date_updated: { _lte: "${schwelleAusgang}" }, ${M} }
      ) {
        count { id }
      }
    }
  `
}

/** Aktive Medien des Mandanten mit den für die Bereitschaft noetigen Feldern. */
export const MEDIEN_BEREITSCHAFT = gql`
  query MedienBereitschaft {
    faas_medien(filter: { is_active: { _eq: true }, ${M} }, limit: -1) {
      slug
      slack_channel
      kontakt_emails
    }
  }
`

/** medium_id aller aktiven medium_dna-Versionen (= Medien mit aktiver DNA). */
export const MEDIUM_DNA_AKTIV = gql`
  query MediumDnaAktiv {
    medium_dna(filter: { is_active: { _eq: true } }, limit: -1) {
      medium_id
    }
  }
`
