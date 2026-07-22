import { useQuery } from '@apollo/client/react'
import { gql } from '@apollo/client'
import { tenant } from '../../config/tenant'

const M = `mandant: { _eq: "${tenant.key}" }`

const STATUS_QUERY = gql`
  query AssistentStatus {
    medien: faas_medien_aggregated(filter: { is_active: { _eq: true }, ${M} }) {
      count {
        id
      }
    }
    vorschlaege: agent_vorschlaege_aggregated(filter: { status: { _eq: "offen" }, ${M} }) {
      count {
        id
      }
    }
    fristen: agent_vorschlaege_aggregated(
      filter: { status: { _eq: "offen" }, typ: { _eq: "frist" }, ${M} }
    ) {
      count {
        id
      }
    }
    antraege: applications_aggregated(
      filter: { status: { _in: ["identifiziert", "in_arbeit", "eingereicht"] }, ${M} }
    ) {
      count {
        id
      }
    }
  }
`

function Kpi({ wert, label, akzent }: { wert: number; label: string; akzent?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className={`text-2xl font-bold ${akzent ?? 'text-slate-900'}`}>{wert}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  )
}

export function StatusBlock() {
  const { data } = useQuery(STATUS_QUERY, {
    pollInterval: 30000,
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any
  const n = (x: unknown) => Number(x ?? 0)
  const medien = n(d?.medien?.[0]?.count?.id)
  const vorschlaege = n(d?.vorschlaege?.[0]?.count?.id)
  const fristen = n(d?.fristen?.[0]?.count?.id)
  const antraege = n(d?.antraege?.[0]?.count?.id)

  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Lagebericht
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi wert={medien} label="Aktive Medien" />
        <Kpi wert={vorschlaege} label="Offene Vorschläge" akzent="text-indigo-600" />
        <Kpi wert={fristen} label="Davon Fristen" akzent={fristen > 0 ? 'text-rose-600' : undefined} />
        <Kpi wert={antraege} label="Offene Anträge" />
      </div>
    </div>
  )
}
