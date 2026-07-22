import { gql } from '@apollo/client'

/**
 * Agent-Usage: Token-/Kostenlog der FaaS-Agent-API-Calls (Collection `agent_usage`).
 * Nur 'api'-Calls (Sonnet/Opus über den Anthropic-Key) kosten Franken; 'abo'
 * (Copy-paste-Opus) und 'lokal' (Spark-qwen) werden mit 0 / null geführt.
 *
 * Gesamtsumme + Aufschlüsselung pro Medium + die letzten Calls. Pollt wie die
 * übrigen Views (Live-Anzeige).
 */
export const AGENT_USAGE = gql`
  query AgentUsage {
    total: agent_usage_aggregated {
      count { id }
      sum { input_tokens output_tokens kosten_chf }
    }
    pro_medium: agent_usage_aggregated(groupBy: ["medium_id"]) {
      group
      count { id }
      sum { kosten_chf input_tokens output_tokens }
    }
    recent: agent_usage(limit: 20, sort: ["-ts"]) {
      id
      ts
      medium_id
      aufgabe
      modell
      tier
      quelle
      input_tokens
      output_tokens
      kosten_chf
    }
  }
`
