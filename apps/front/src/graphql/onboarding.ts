import { gql } from '@apollo/client'
import { tenant } from '../../config/tenant'

/** Slugs der Medien mit aktiver gemessener DNA (= bereits onboardet). */
export const MEDIEN_MIT_DNA = gql`
  query MedienMitDna {
    medium_dna(filter: { is_active: { _eq: true } }, limit: -1) {
      medium_id
    }
  }
`

/** Neues Medium aufnehmen (Onboarding-Start). */
export const CREATE_MEDIUM = gql`
  mutation CreateMedium($data: create_faas_medien_input!) {
    create_faas_medien_item(data: $data) {
      id
      slug
      name
    }
  }
`

/**
 * onboarding.ts — GraphQL-Layer für Medien-Onboarding + medium_knowledge.
 *
 * Schreibt in:
 *   - medium_knowledge (create/delete)
 *   - faas_medien (update der 3 URL-Felder)
 * Liest aus:
 *   - faas_medien (aktive Medien-Liste)
 *   - medium_knowledge (nach medium_id)
 *
 * GraphQL-Gotchas (Directus):
 *   - String-Felder (medium_id, slug): Variable = String!
 *   - Numerische PK: Variable = GraphQLStringOrFloat!
 *   - Aggregate: <collection>_aggregated, Rückgabe = Array
 */

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Aktive Medien-Register aus faas_medien.
 * Nur öffentliche Felder — keine internen Pfade.
 */
export const MEDIEN_REGISTER = gql`
  query MedienRegister {
    faas_medien(
      filter: { is_active: { _eq: true }, mandant: { _eq: "${tenant.key}" } }
      sort: ["name"]
    ) {
      id
      slug
      name
      website
      wepublish_api_url
      mailchimp_archive_url
      kontakt_emails
      slack_channel
      antragsteller_typ
      arbeits_dna
      arbeits_dna_stand
    }
  }
`

/**
 * Alle medium_knowledge-Einträge für ein Medium.
 * Sortiert absteigend nach Erstellungsdatum.
 */
export const KNOWLEDGE_FOR_MEDIUM = gql`
  query KnowledgeForMedium($medium: String!) {
    medium_knowledge(
      filter: { medium_id: { _eq: $medium } }
      sort: ["-date_created"]
      limit: -1
    ) {
      id
      medium_id
      category
      title
      content
      file_id
      source_url
      published_date
      tags
      auto_scraped
      date_created
    }
  }
`

// ─── Mutationen ───────────────────────────────────────────────────────────────

/**
 * Neuen Wissens-Eintrag anlegen.
 * Kategorie-Werte: previous_application, tax_exemption, budget,
 * published_article, newsletter, testimonial, general_info
 */
export const CREATE_KNOWLEDGE = gql`
  mutation CreateKnowledge($data: create_medium_knowledge_input!) {
    create_medium_knowledge_item(data: $data) {
      id
      category
      title
      date_created
    }
  }
`

/**
 * Wissens-Eintrag löschen.
 * id ist der numerische PK → Variable als ID! (Directus accepts string-coercion).
 */
export const DELETE_KNOWLEDGE = gql`
  mutation DeleteKnowledge($id: ID!) {
    delete_medium_knowledge_item(id: $id) {
      id
    }
  }
`

/**
 * Onboarding-Felder eines Mediums aktualisieren.
 * Schreibt website, wepublish_api_url, mailchimp_archive_url,
 * kontakt_emails (json) und slack_channel.
 * id = numerischer PK von faas_medien → ID!
 */
export const UPDATE_MEDIUM_FELDER = gql`
  mutation UpdateMediumFelder($id: ID!, $data: update_faas_medien_input!) {
    update_faas_medien_item(id: $id, data: $data) {
      id
      website
      wepublish_api_url
      mailchimp_archive_url
      kontakt_emails
      slack_channel
    }
  }
`
