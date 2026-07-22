import { useQuery } from '@apollo/client/react'
import { MATCHES, MATCHES_PROJEKT, STIFTUNGEN, DNAS } from '@/graphql/queries'
import { mergeMatches } from './merge'

/**
 * Lädt Matches für ein Medium ODER — wenn projektId gesetzt — für ein Projekt.
 * Projekt-Ebene: nur Treffer mit diesem projekt_id. Medium-Ebene: nur projekt_id-lose.
 */
export function useMatches(mediumId: string, projektId?: number | null) {
  const istProjekt = projektId != null
  // Live-Sync: alle 30s neu abfragen, damit neue Matches von selbst auftauchen.
  const m = useQuery(istProjekt ? MATCHES_PROJEKT : MATCHES, {
    variables: istProjekt ? { projektId } : { mediumId },
    skip: istProjekt ? !projektId : !mediumId,
    pollInterval: 30000,
  })
  const matches = (m.data as any)?.match_results ?? []
  const ids = matches.map((r: any) => r.stiftung_id)

  const s = useQuery(STIFTUNGEN, { variables: { ids }, skip: ids.length === 0 })
  const d = useQuery(DNAS, { variables: { ids }, skip: ids.length === 0 })

  const rows =
    ids.length
      ? mergeMatches(
          matches,
          (s.data as any)?.stiftungen ?? [],
          (d.data as any)?.stiftungs_dna ?? [],
        )
      : []

  return { rows, loading: m.loading || s.loading || d.loading, error: m.error }
}
