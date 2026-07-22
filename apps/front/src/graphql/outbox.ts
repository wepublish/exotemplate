import { gql } from '@apollo/client'
import { tenant } from '../../config/tenant'

const FELDER = `
  id
  ts
  typ
  anlass
  status
  medium_id
  application_id
  stiftung_id
  empfaenger
  betreff
  inhalt
  anhang
  erstellt_von
  fehler_text
`

export const OUTBOX_ENTWUERFE = gql`
  query OutboxEntwuerfe {
    agent_outbox(
      filter: { status: { _eq: "entwurf" }, mandant: { _eq: "${tenant.key}" } }
      limit: -1
      sort: ["ts"]
    ) {
      ${FELDER}
    }
  }
`

export const OUTBOX_COUNT_ENTWURF = gql`
  query OutboxCountEntwurf {
    agent_outbox_aggregated(
      filter: { status: { _eq: "entwurf" }, mandant: { _eq: "${tenant.key}" } }
    ) {
      count {
        id
      }
    }
  }
`

export const OUTBOX_BEARBEITEN = gql`
  mutation OutboxBearbeiten($id: ID!, $betreff: String, $inhalt: String, $empfaenger: String) {
    update_agent_outbox_item(
      id: $id
      data: { betreff: $betreff, inhalt: $inhalt, empfaenger: $empfaenger }
    ) {
      id
      betreff
      inhalt
      empfaenger
    }
  }
`

export const OUTBOX_VERWERFEN = gql`
  mutation OutboxVerwerfen($id: ID!, $von: String) {
    update_agent_outbox_item(id: $id, data: { status: "verworfen", freigegeben_von: $von }) {
      id
      status
    }
  }
`
