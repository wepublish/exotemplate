import { gql } from '@apollo/client'
import type { Prioritaet, VorschlagTyp } from '@/lib/vorschlaege'
import { tenant } from '../../config/tenant'

export type VorschlagStatus = 'offen' | 'freigegeben' | 'angepasst' | 'verneint'

export type Vorschlag = {
  id: string
  ts: string | null
  typ: VorschlagTyp
  medium_id: string
  stiftung_id: string | null
  stiftung_name: string | null
  titel: string
  beschreibung: string
  prioritaet: Prioritaet
  frist: string | null
  artefakt_link: string | null
  begruendung: string
  status: VorschlagStatus
  quelle_modell: string | null
}

const FELDER = `
  id
  ts
  typ
  medium_id
  stiftung_id
  stiftung_name
  titel
  beschreibung
  prioritaet
  frist
  artefakt_link
  begruendung
  status
  quelle_modell
`

export const VORSCHLAEGE_OFFEN = gql`
  query VorschlaegeOffen {
    agent_vorschlaege(
      filter: { status: { _eq: "offen" }, mandant: { _eq: "${tenant.key}" } }
      limit: -1
      sort: ["ts"]
    ) {
      ${FELDER}
    }
  }
`

export const VORSCHLAEGE_ALLE = gql`
  query VorschlaegeAlle {
    agent_vorschlaege(filter: { mandant: { _eq: "${tenant.key}" } }, limit: 200, sort: ["-ts"]) {
      ${FELDER}
    }
  }
`

export const VORSCHLAEGE_COUNT_OFFEN = gql`
  query VorschlaegeCountOffen {
    agent_vorschlaege_aggregated(
      filter: { status: { _eq: "offen" }, mandant: { _eq: "${tenant.key}" } }
    ) {
      count {
        id
      }
    }
  }
`
