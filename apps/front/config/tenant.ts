// Mandant dieser App-Instanz. `key` ist der MANDANTEN-Schlüssel — er filtert ALLE
// client-seitigen Directus-Queries (faas_medien/agent_vorschlaege/applications) auf
// `mandant: { _eq: key }`. Der Winkelried-Klon setzt hier `key: 'winkelried'`.
//
// `clients` ist NUR die kuratierte ANZEIGE-Liste (Dashboard-Spalten, FilterBar-Dropdown,
// vorkompilierte Detail-Queries in medien.ts). Bewusst nicht zwingend deckungsgleich mit
// allen aktiven Medien des Mandanten — die TENANCY-Wahrheit ist das `mandant`-Feld in
// Directus, nicht diese Liste. Wer ein Medium im Dashboard/Filter sehen will, trägt es hier ein.
export const tenant = {
  key: 'wepublish',
  name: 'We.Publish',
  brandColor: '#1a1a2e',
  accent: '#4ade80',
  // ACHTUNG, Wartungsfalle: der Onboarding-Weg durch die App traegt hier NICHTS
  // ein. Ein neu onboardetes Medium bleibt im Dashboard, im Filter, in der
  // Roadmap und in der DNA-Detailansicht unsichtbar, bis es hier steht — auch
  // wenn seine DNA laengst gemessen und aktiv ist. Am 28.07.2026 aufgefallen:
  // factuel hatte eine aktive DNA (56% Schaerfe, 52 Treffer), war aber nirgends
  // zu sehen, weil der Eintrag fehlte. Dasselbe Muster hielt laut Statusnotiz
  // schon drei Medien monatelang unsichtbar. Richtige Loesung ist, die Liste aus
  // Directus abzuleiten; das braucht einen Umbau der pro Medium vorkompilierten
  // Detail-Queries in graphql/medien.ts.
  clients: ['wepublish', 'cueltuer', 'neue_wege', 'ganzgraz', 'ee-news', 'bajour', 'factuel', 'vmz', 'zwolf'],
  locale: 'de',
} as const

// Welche dna_quality_tier in der App als Treffer gelten.
// FINALE Matching-Methode: nur noch qwen-v3. Der volle qwen-Re-Match ist durch
// (2026-06-05) und die alten 'deep'/Opus-Treffer sind gelöscht → reines qwen.
// (Die Match-ENGINE schreibt ohnehin nur qwen_v3 — MATCH_MIN_TIER.)
export const MATCH_TIERS: readonly string[] = ['qwen_v3']

// Mindest-Score, ab dem ein Match in der App angezeigt wird. qwen wertet strenger
// als das alte Opus geeicht — darum liegt die Schwelle bei 20 (nicht 30), sonst
// blieben pro Medium nur ~100 statt einiger Hundert Treffer sichtbar. Die Engine
// schreibt mit einem tieferen Floor (10), damit diese Schwelle ohne Neu-Lauf
// justierbar ist (Entscheidung Jolanda, 2026-06-05).
export const MATCH_MIN_SCORE = 20
