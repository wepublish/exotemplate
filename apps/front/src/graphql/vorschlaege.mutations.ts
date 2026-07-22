import { gql } from '@apollo/client'
import type { VorschlagStatus } from './vorschlaege'

// Status setzen (freigeben / verneinen) + wer
export const VORSCHLAG_ENTSCHEIDEN = gql`
  mutation VorschlagEntscheiden($id: ID!, $status: String!, $von: String) {
    update_agent_vorschlaege_item(id: $id, data: { status: $status, entschieden_von: $von }) {
      id
      status
    }
  }
`

// Anpassen: editierbare Felder + Status "angepasst"
export const VORSCHLAG_ANPASSEN = gql`
  mutation VorschlagAnpassen(
    $id: ID!
    $titel: String
    $beschreibung: String
    $stiftung_name: String
    $von: String
  ) {
    update_agent_vorschlaege_item(
      id: $id
      data: {
        titel: $titel
        beschreibung: $beschreibung
        stiftung_name: $stiftung_name
        status: "angepasst"
        entschieden_von: $von
      }
    ) {
      id
      status
      titel
      beschreibung
      stiftung_name
    }
  }
`

// Lern-Notiz bei Verneinung (Lern-Loop)
export const CREATE_LESSON = gql`
  mutation CreateLesson($data: create_agent_lessons_input!) {
    create_agent_lessons_item(data: $data) {
      id
    }
  }
`

export const STATUS_LABEL: Record<VorschlagStatus, string> = {
  offen: 'Offen',
  freigegeben: 'Freigegeben',
  angepasst: 'Angepasst',
  verneint: 'Verneint',
}
