export type Konfidenz = 'web' | 'stammdaten' | 'unbekannt'

/** Ergebnis der Betrag-Recherche (LLM) — persistiert in match_results.betrag_recherche. */
export interface BetragsVorschlag {
  suggested_amount: number
  reasoning: string
  currency: 'CHF'
  computed_at?: string
}

export interface MatchView {
  id: string
  stiftungId: string
  name: string
  website?: string | null
  score: number
  begruendung?: string | null
  breakdown?: any
  tags: { tag_slug: string; gewicht: number; begruendung: string }[]
  soundFeeling: string
  schaerfe: number
  konfidenz: Konfidenz
  betrag?: string | null
  /** Persistiertes Ergebnis der Betrag-Recherche (match_results.betrag_recherche). */
  betragRecherche?: BetragsVorschlag | null
}
