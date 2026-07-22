/**
 * llm.ts — Zentraler vLLM-Helper für alle App-LLM-Calls.
 *
 * Ruft vLLM (OpenAI-kompatibler Endpunkt) statt Ollama auf.
 * Endpoint:  ${LLM_URL}/v1/chat/completions   (Default: http://127.0.0.1:8001)
 * Modell:    ${LLM_MODEL}                      (Default: qwen3.6-27b)
 *
 * WICHTIG:
 *   - KEIN response_format (hängt qwen3.6 auf vLLM!)
 *   - KEIN Ollama-spezifisches format/think/num_ctx/num_predict
 *   - chat_template_kwargs: { enable_thinking: false } (Pflicht für qwen3.6 auf vLLM)
 *   - Antwort: json.choices[0].message.content
 *
 * Retry: 3 Versuche, 5s Backoff — NUR bei Verbindungsabbruch («fetch failed»),
 * NICHT bei echtem Timeout (würde nur erneut lange warten).
 */

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface LlmCallParams {
  /** Optionaler System-Prompt. */
  system?: string
  /** User-Prompt (Pflicht). */
  user: string
  /** Temperatur (0 = deterministisch). */
  temperature: number
  /** Maximale Output-Token-Anzahl. */
  max_tokens: number
  /** Timeout in Millisekunden (Default: 600 000 = 10 Minuten). */
  timeoutMs?: number
  /**
   * Streaming aktivieren (SSE). Für LANGE Generierungen (>300s) nötig: ohne
   * Streaming kommen die HTTP-Header erst nach der vollständigen Generierung,
   * worauf Node-fetch (undici) bei seinem 300s-headersTimeout die Verbindung
   * killt («fetch failed»). Beim Streaming kommen die Header sofort; das echte
   * Limit bleibt der AbortSignal-Timeout. Inhaltlich identisch (Deltas akkumuliert).
   */
  stream?: boolean
}

// ─── vLLM-Call ────────────────────────────────────────────────────────────────

/**
 * Ruft EINEN konkreten Endpoint (base + model) an, mit 3 Versuchen
 * (Backoff nur bei Verbindungsabbruch, nicht bei Timeout). Wirft bei Fehler.
 */
async function callEndpoint(
  llmBase: string,
  llmModel: string,
  params: LlmCallParams,
  timeoutMs: number
): Promise<string> {
  const messages: { role: string; content: string }[] = []
  if (params.system) {
    messages.push({ role: 'system', content: params.system })
  }
  messages.push({ role: 'user', content: params.user })

  const body = {
    model: llmModel,
    messages,
    temperature: params.temperature,
    max_tokens: params.max_tokens,
    // Pflicht für qwen3.6 (vLLM auf dem Spark UND mlx_lm.server auf dem Studio):
    // Reasoning-Modus deaktivieren, sonst leere/Thinking-Antwort.
    chat_template_kwargs: { enable_thinking: false },
    // KEIN response_format — hängt qwen3.6 auf vLLM
    ...(params.stream ? { stream: true } : {}),
  }

  let letzterFehler: unknown = null

  for (let versuch = 1; versuch <= 3; versuch++) {
    try {
      const res = await fetch(`${llmBase}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`LLM HTTP ${res.status}: ${errText.slice(0, 300)}`)
      }

      // Streaming-Pfad: Header sind sofort da (kein 300s-headersTimeout). SSE-Zeilen
      // («data: {…}») lesen und die delta.content-Stücke zum vollen Text zusammensetzen.
      if (params.stream) {
        const reader = res.body?.getReader()
        if (!reader) throw new Error('LLM: kein Stream-Body')
        const decoder = new TextDecoder()
        let puffer = ''
        let streamInhalt = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          puffer += decoder.decode(value, { stream: true })
          const zeilen = puffer.split('\n')
          puffer = zeilen.pop() ?? ''
          for (const zeile of zeilen) {
            const t = zeile.trim()
            if (!t.startsWith('data:')) continue
            const nutzlast = t.slice(5).trim()
            if (!nutzlast || nutzlast === '[DONE]') continue
            try {
              const j = JSON.parse(nutzlast) as { choices?: { delta?: { content?: string } }[] }
              const stueck = j.choices?.[0]?.delta?.content
              if (typeof stueck === 'string') streamInhalt += stueck
            } catch {
              // Fragment über Chunk-Grenze — wird mit dem nächsten Chunk vervollständigt
            }
          }
        }
        if (!streamInhalt) throw new Error('LLM: leerer Stream-Inhalt')
        return streamInhalt
      }

      const json = await res.json() as {
        choices?: { message?: { content?: string } }[]
      }
      const content = json?.choices?.[0]?.message?.content
      if (typeof content !== 'string') {
        throw new Error(`LLM: Unerwartetes Antwortformat — choices[0].message.content fehlt`)
      }
      return content
    } catch (e: unknown) {
      letzterFehler = e
      const msg = e instanceof Error ? e.message : String(e)
      const istTimeout =
        msg.toLowerCase().includes('aborted') ||
        msg.toLowerCase().includes('timeout') ||
        (e as { name?: string })?.name === 'TimeoutError'
      if (istTimeout || versuch === 3) throw e
      await new Promise(r => setTimeout(r, 5_000))
    }
  }

  throw letzterFehler instanceof Error ? letzterFehler : new Error('LLM: kein Ergebnis')
}

/**
 * Führt einen Chat-Completion-Call durch und gibt den Antwort-Inhalt zurück.
 *
 * Primär gegen ${LLM_URL} / ${LLM_MODEL} (Spark-vLLM, Default 127.0.0.1:8001).
 * FALLBACK: Ist ${LLM_URL_FALLBACK} gesetzt und scheitert der primäre Endpoint
 * vollständig (Spark aus/Tailscale weg/Hang), wird EINMAL der Fallback versucht
 * (z.B. der bf16-MLX-Server auf dem Mac Studio — modell-konsistent zum Pool).
 * Wirft erst, wenn auch der Fallback scheitert (oder keiner konfiguriert ist).
 */
export async function callLLM(params: LlmCallParams): Promise<string> {
  const llmBase = process.env.LLM_URL || 'http://127.0.0.1:8001'
  const llmModel = process.env.LLM_MODEL || 'qwen3.6-27b'
  const timeoutMs = params.timeoutMs ?? 600_000

  const fallbackBase = process.env.LLM_URL_FALLBACK
  const fallbackModel = process.env.LLM_MODEL_FALLBACK || llmModel

  try {
    return await callEndpoint(llmBase, llmModel, params, timeoutMs)
  } catch (primärFehler: unknown) {
    if (!fallbackBase) throw primärFehler
    // Primärer Endpoint (Spark) nicht verfügbar → Studio-Fallback versuchen.
    try {
      return await callEndpoint(fallbackBase, fallbackModel, params, timeoutMs)
    } catch (fallbackFehler: unknown) {
      const p = primärFehler instanceof Error ? primärFehler.message : String(primärFehler)
      const f = fallbackFehler instanceof Error ? fallbackFehler.message : String(fallbackFehler)
      throw new Error(`LLM primär UND Fallback fehlgeschlagen — primär: ${p} | fallback: ${f}`)
    }
  }
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
