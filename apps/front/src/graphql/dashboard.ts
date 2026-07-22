import { gql } from '@apollo/client'
import { tenant, MATCH_TIERS, MATCH_MIN_SCORE } from '../../config/tenant'

/**
 * Baut einen einzelnen gebündelten Dashboard-Query mit allen Aggregaten.
 * Medium-Aliasse werden dynamisch aus tenant.clients generiert.
 * Aliasse erfordern sauber gepatchte Namen: «-» → «_» + Präfix «m_».
 */
function buildDashboardQueryString(): string {
  const mediumAliases = tenant.clients
    .map(client => {
      // GraphQL-sichere Alias-Namen: Sonderzeichen ersetzen
      const alias = 'm_' + client.replace(/[^a-zA-Z0-9]/g, '_')
      return `
      ${alias}: match_results_aggregated(
        filter: {
          medium_id: { _eq: "${client}" }
          dna_quality_tier: { _in: ${JSON.stringify(MATCH_TIERS)} }
          score: { _gte: ${MATCH_MIN_SCORE} }
        }
      ) {
        count { id }
      }`
    })
    .join('\n')

  return `
    query DashboardKpis {
      total_stiftungen: stiftungen_aggregated {
        count { id }
      }
      foerderstiftungen: stiftungen_aggregated(
        filter: { ist_foerderstiftung: { _eq: true } }
      ) {
        count { id }
      }
      aktive_dnas: stiftungs_dna_aggregated(
        filter: { is_active: { _eq: true } }
      ) {
        count { id }
      }
      deep_matches: match_results_aggregated(
        filter: { dna_quality_tier: { _in: ${JSON.stringify(MATCH_TIERS)} }, score: { _gte: ${MATCH_MIN_SCORE} } }
      ) {
        count { id }
      }
      stiftungen_ch: stiftungen_aggregated(
        filter: { land: { _eq: "CH" } }
      ) {
        count { id }
      }
      stiftungen_at: stiftungen_aggregated(
        filter: { land: { _eq: "AT" } }
      ) {
        count { id }
      }
      stiftungen_de: stiftungen_aggregated(
        filter: { land: { _eq: "DE" } }
      ) {
        count { id }
      }
      mit_frist: stiftungen_aggregated(
        filter: { deadline: { _nnull: true } }
      ) {
        count { id }
      }
      ${mediumAliases}
    }
  `
}

export const DASHBOARD_KPIS = gql(buildDashboardQueryString())

/**
 * Hilfsfunktion: extrahiert Medium-Count aus dem Query-Ergebnis.
 * Gibt den Alias-Namen für ein gegebenes client-ID zurück.
 */
export function mediumAlias(client: string): string {
  return 'm_' + client.replace(/[^a-zA-Z0-9]/g, '_')
}
