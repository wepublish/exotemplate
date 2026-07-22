import { gql } from '@apollo/client'
import { tenant } from '../../config/tenant'

export type Projekt = { id: number; name: string; slug: string }

export type ProjektAdmin = Projekt & {
  status: string
  beschreibung: string | null
  directus_aktive_dna_version_id: string | null
  arbeits_dna_stand: string | null
}

/** Projekte eines Mediums fürs Onboarding (alle Status, mit DNA-Stand). */
export const PROJEKTE_ADMIN = gql`
  query ProjekteAdmin($medium: String!) {
    projekte(
      filter: { medium_id: { _eq: $medium }, mandant: { _eq: "${tenant.key}" } }
      sort: ["name"]
      limit: -1
    ) {
      id
      name
      slug
      status
      beschreibung
      directus_aktive_dna_version_id
      arbeits_dna_stand
    }
  }
`

export const CREATE_PROJEKT = gql`
  mutation CreateProjekt($data: create_projekte_input!) {
    create_projekte_item(data: $data) {
      id
      name
    }
  }
`

/** Slug aus Projektnamen (ASCII snake_case). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[äàâ]/g, 'a')
    .replace(/[öô]/g, 'o')
    .replace(/[üû]/g, 'u')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
}

/** Aktive Projekte eines Mediums (mandantenrein). */
export const PROJEKTE_FOR_MEDIUM = gql`
  query ProjekteForMedium($medium: String!) {
    projekte(
      filter: {
        medium_id: { _eq: $medium }
        mandant: { _eq: "${tenant.key}" }
        status: { _eq: "aktiv" }
      }
      sort: ["name"]
      limit: -1
    ) {
      id
      name
      slug
    }
  }
`
