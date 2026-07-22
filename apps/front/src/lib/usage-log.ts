/**
 * usage-log.ts — Kostenberechnung für das Token-/Usage-Panel (reine Logik, kein HTTP).
 *
 * Der FaaS-Agent (Hermes-Seite) schreibt pro Anthropic-API-Call einen Eintrag in die
 * Directus-Collection `agent_usage` (Tokens + Metadaten). Die App liest diese Einträge
 * und zeigt Tokens + geschätzte CHF an. Dieses Modul liefert die Kosten-Mathematik.
 *
 * Copy-paste-Opus-Calls (Abo-Flatrate) und lokale Spark-Calls melden keine API-Kosten;
 * sie werden als quelle 'abo' bzw. 'lokal' geführt und in CHF mit 0 / null gezeigt.
 */

/** Token-Verbrauch eines Calls (aus dem `usage`-Block der Anthropic-Antwort). */
export type Usage = {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

/** Preis-Raten in USD pro 1 Mio. Token. */
export type Raten = {
  inProMio: number
  outProMio: number
  cacheReadProMio?: number
  cacheWriteProMio?: number
}

/** Herkunft eines Calls — bestimmt, ob in CHF gemessen wird. */
export type Quelle = 'api' | 'abo' | 'lokal'

/**
 * Bekannte Modell-Raten (USD/Mio. Token), Anthropic-Standardtarife.
 * STAND BESTÄTIGEN gegen das aktuelle Preisblatt (Spec 6, offener Zahlenfeinschliff);
 * die Funktion nimmt Raten als Parameter, ein Update ist eine Einzeiler-Änderung.
 */
export const RATEN: Record<string, Raten> = {
  'claude-sonnet-4-6': { inProMio: 3, outProMio: 15, cacheReadProMio: 0.3, cacheWriteProMio: 3.75 },
  'claude-opus-4-8': { inProMio: 15, outProMio: 75, cacheReadProMio: 1.5, cacheWriteProMio: 18.75 },
  'claude-haiku-4-5-20251001': { inProMio: 1, outProMio: 5, cacheReadProMio: 0.1, cacheWriteProMio: 1.25 },
}

/** USD→CHF Default. Bei Bedarf überschreiben. */
export const USD_CHF = 0.9

/**
 * Kosten eines Calls in CHF. Reine Funktion: Tokens × Raten × Wechselkurs.
 * Cache-Tokens werden mit ihren (günstigeren) Cache-Raten verrechnet, falls angegeben.
 */
export function kostenChf(u: Usage, r: Raten, usdChf: number = USD_CHF): number {
  const usd =
    (u.input / 1e6) * r.inProMio +
    (u.output / 1e6) * r.outProMio +
    ((u.cacheRead ?? 0) / 1e6) * (r.cacheReadProMio ?? 0) +
    ((u.cacheWrite ?? 0) / 1e6) * (r.cacheWriteProMio ?? 0)
  return usd * usdChf
}

/**
 * Kosten für einen `agent_usage`-Eintrag. Nur `quelle === 'api'` kostet Franken;
 * 'abo' (Copy-paste-Opus) und 'lokal' (Spark) liefern 0 bzw. werden als ungemessen
 * behandelt. Unbekanntes Modell → null (Anzeige: «Tarif unbekannt»).
 */
export function eintragKostenChf(
  e: { modell: string; quelle: Quelle; input_tokens: number; output_tokens: number; cache_read_tokens?: number; cache_write_tokens?: number },
  usdChf: number = USD_CHF,
): number | null {
  if (e.quelle !== 'api') return 0
  const r = RATEN[e.modell]
  if (!r) return null
  return kostenChf(
    { input: e.input_tokens, output: e.output_tokens, cacheRead: e.cache_read_tokens, cacheWrite: e.cache_write_tokens },
    r,
    usdChf,
  )
}
