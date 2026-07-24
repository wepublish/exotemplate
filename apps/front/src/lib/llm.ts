/**
 * llm.ts — Zentraler Claude-API-Helper für alle App-LLM-Calls.
 *
 * Ruft die Anthropic Messages API (Claude) über das offizielle SDK auf.
 * Ersetzt den früheren OpenAI-kompatiblen vLLM-Aufruf (Spark, lokal, GPU).
 *
 * Konfiguration über Umgebungsvariablen:
 *   ANTHROPIC_API_KEY  (Pflicht) — vom SDK automatisch gelesen, nie im Code.
 *   ANTHROPIC_MODEL    (optional) — Default claude-opus-4-8.
 *
 * WICHTIG:
 *   - KEIN temperature/top_p/top_k — die Opus-4.8-/Sonnet-5-Familie lehnt sie
 *     mit 400 ab. Der Parameter bleibt in LlmCallParams (Aufrufer unverändert),
 *     wird aber NICHT an die API weitergereicht.
 *   - KEIN thinking — weggelassen heisst auf Opus 4.8 «ohne Thinking», das
 *     entspricht dem früheren enable_thinking:false und hält Kosten/Latenz tief.
 *   - Immer gestreamt (stream().finalMessage()): schützt lange Generierungen
 *     (Gesuch-Vorbau) vor HTTP-Timeouts, inhaltlich identisch zum Nicht-Streaming.
 *   - Antwort: die zusammengesetzten text-Blöcke aus message.content.
 *
 * Retries (429/5xx/Verbindungsabbruch) übernimmt das SDK selbst (maxRetries).
 */

import Anthropic from '@anthropic-ai/sdk'

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface LlmCallParams {
  /** Optionaler System-Prompt. */
  system?: string
  /** User-Prompt (Pflicht). */
  user: string
  /**
   * Temperatur. Bleibt aus Kompatibilitätsgründen im Interface, wird aber NICHT
   * an die Claude-API übergeben (dort mit 400 abgelehnt). Steuerung über den Prompt.
   */
  temperature: number
  /** Maximale Output-Token-Anzahl. */
  max_tokens: number
  /** Timeout in Millisekunden (Default: 600 000 = 10 Minuten). */
  timeoutMs?: number
  /**
   * Historischer Streaming-Schalter. Ohne Wirkung — es wird immer gestreamt
   * (siehe Kopf). Bleibt im Interface, damit bestehende Aufrufer unverändert bleiben.
   */
  stream?: boolean
}

// ─── Claude-Call ────────────────────────────────────────────────────────────────

let client: Anthropic | null = null

/** Lazily instanziierter Anthropic-Client (liest ANTHROPIC_API_KEY aus der Umgebung). */
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ maxRetries: 2 })
  }
  return client
}

/**
 * Führt einen Chat-Completion-Call gegen die Claude-API durch und gibt den
 * zusammengesetzten Text der Antwort zurück. Wirft bei Fehler (nach SDK-Retries).
 */
export async function callLLM(params: LlmCallParams): Promise<string> {
  const model = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8'
  const timeout = params.timeoutMs ?? 600_000

  const message = await getClient().messages
    .stream(
      {
        model,
        max_tokens: params.max_tokens,
        ...(params.system ? { system: params.system } : {}),
        messages: [{ role: 'user', content: params.user }]
      },
      { timeout }
    )
    .finalMessage()

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('')

  if (!text) {
    throw new Error(
      `LLM: leere Antwort (stop_reason=${message.stop_reason ?? 'unbekannt'})`
    )
  }
  return text
}

// ─── JSON-Parser (robust) ─────────────────────────────────────────────────────

/**
 * Parst einen String als JSON. Falls das direkte Parse scheitert,
 * wird versucht, das erste vollständige {...}-Objekt heraus zu schneiden.
 *
 * Wirft bei vollständigem Fehlschlag.
 */
export function parseJsonLoose(text: string): unknown {
  const s = (text ?? '').trim()
  if (!s) throw new Error('parseJsonLoose: leerer Input')

  // 1. Direkter Versuch
  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      return JSON.parse(s)
    } catch {
      // weiter
    }
  }

  // 2. Erstes vollständiges {...}-Objekt herausschneiden (Tiefenzähler)
  const start = s.indexOf('{')
  if (start !== -1) {
    let depth = 0
    let end = -1
    for (let i = start; i < s.length; i++) {
      if (s[i] === '{') depth++
      else if (s[i] === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end !== -1) {
      try {
        return JSON.parse(s.slice(start, end + 1))
      } catch {
        // weiter
      }
    }
  }

  throw new Error(`parseJsonLoose: kein parsebares JSON-Objekt gefunden in: ${s.slice(0, 200)}`)
}
