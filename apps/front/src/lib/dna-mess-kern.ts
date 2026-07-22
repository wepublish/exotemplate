/**
 * dna-mess-kern.ts — Gemeinsamer Mess-Kern für Medium-DNA-Messung (v3).
 *
 * EXAKT identische Ellenlänge wie run_pilot_nothink.py:
 *   - Vokabular v3, Temperatur 0, num_ctx 8192, num_predict 3000
 *   - Schärfe-Formel: Korpus(max 40) + Belegte-Gewicht3-Tags(max 30) + Exclusion(10)
 *   - foerderpraxis bei Medien leer → fp_belegt = 0
 *
 * Testbar (reine Logik, keine HTTP-Calls):
 *   - calcSchaerfe
 *   - filterVokabular
 *   - parseOllamaAntwort
 */

import vokabularRaw from './vokabular_v3.json'

// ─── Vokabular ────────────────────────────────────────────────────────────────

export interface VokabularTag {
  slug: string
  label: string
  bereich: string
  aliases: string[]
}

function ladeVokabular(): {
  vocabSet: Set<string>
  vocabByArea: Record<string, string[]>
  labelBySlug: Record<string, string>
} {
  const tags = (vokabularRaw as { data: { slug: string; label: string; bereich: string; aliases: string[] }[] }).data
  const vocabSet = new Set<string>(tags.map(t => t.slug))
  const vocabByArea: Record<string, string[]> = {}
  const labelBySlug: Record<string, string> = {}
  for (const t of tags) {
    if (!vocabByArea[t.bereich]) vocabByArea[t.bereich] = []
    vocabByArea[t.bereich].push(t.slug)
    labelBySlug[t.slug] = t.label
  }
  return { vocabSet, vocabByArea, labelBySlug }
}

const { vocabSet: VOCAB_SET, vocabByArea: VOCAB_BY_AREA, labelBySlug: LABEL_BY_SLUG } = ladeVokabular()

/** Gibt einen String «[bereich] slug, slug, …» pro Zeile zurück. */
export function buildVocabLines(): string {
  return Object.entries(VOCAB_BY_AREA)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bereich, slugs]) => `[${bereich}] ${slugs.join(', ')}`)
    .join('\n')
}

/**
 * Menschenlesbares Label zu einem Vokabular-Slug (für die Portal-DNA-Ansicht,
 * Task 7: Tag-Chips zeigen dem Medium sein eigenes Profil, nicht den rohen
 * Slug). Fallback: der Slug selbst, falls er (z.B. nach einer Vokabular-
 * Migration) nicht mehr im aktuellen Vokabular steckt.
 */
export function labelFuerSlug(slug: string): string {
  return LABEL_BY_SLUG[slug] ?? slug
}

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface DnaTag {
  tag_slug: string
  gewicht: 1 | 2 | 3
  begruendung: string
  evidenz: string[]
}

export interface ExclusionTag {
  tag_slug: string
  begruendung: string
}

export interface OllamaRohAntwort {
  sound_feeling: string
  tags: DnaTag[]
  exclusion_tags: ExclusionTag[]
}

export interface MessErgebnis {
  sound_feeling: string
  tags: DnaTag[]
  exclusion_tags: ExclusionTag[]
  schaerfe_prozent: number
  warnung?: string
  hatte_crawl: boolean
}

// ─── Vokabular-Filter ─────────────────────────────────────────────────────────

/**
 * Filtert Tags und Exclusion-Tags auf gültige Slugs aus dem v3-Vokabular.
 * Halluzinierte Slugs (nicht in VOCAB_SET) werden ENTFERNT.
 */
export function filterVokabular(roh: OllamaRohAntwort): {
  tags: DnaTag[]
  exclusion_tags: ExclusionTag[]
  gefilterteTags: number
  gefilterte_exclusion: number
} {
  const rawTags = Array.isArray(roh.tags) ? roh.tags : []
  const rawExcl = Array.isArray(roh.exclusion_tags) ? roh.exclusion_tags : []

  const tags = rawTags.filter(t => typeof t?.tag_slug === 'string' && VOCAB_SET.has(t.tag_slug))
  const exclusion_tags = rawExcl.filter(t => typeof t?.tag_slug === 'string' && VOCAB_SET.has(t.tag_slug))

  return {
    tags,
    exclusion_tags,
    gefilterteTags: rawTags.length - tags.length,
    gefilterte_exclusion: rawExcl.length - exclusion_tags.length,
  }
}

// ─── Schärfe-Formel ───────────────────────────────────────────────────────────

export interface SchaerfeInput {
  /** True wenn Web-Crawl-Korpus vorhanden (>400 Zeichen). */
  hatteWebKorpus: boolean
  /** True wenn bestehendes Profil vorhanden (sound_feeling od. Tags, >200 Zeichen). */
  hatteBestehendesProfil: boolean | 'kurz'
  /** Gefilterte, vokabular-konforme Tags. */
  tags: DnaTag[]
  /** Exclusion-Tags (nicht leer → +10). */
  exclusion_tags: ExclusionTag[]
}

/**
 * Berechnet die Schärfe (0–80) nach der identischen Formel wie run_pilot_nothink.py.
 * foerderpraxis bei Medien immer leer → fp_belegt = 0 (kein Beitrag).
 *
 * Korpus-Anteil (max 40):
 *   +25 wenn Web-Korpus > 400 Zeichen
 *   +15 wenn bestehendes Profil > 200 Zeichen, sonst +8 wenn vorhanden
 *
 * Tag-Anteil (max 30):
 *   +6 pro Tag mit gewicht==3 UND len(evidenz)>=2, max 5 solcher Tags
 *
 * foerderpraxis (0, Medien haben keine Förderpraxis)
 *
 * Exclusion-Bonus (+10 wenn exclusion_tags nicht leer)
 */
export function calcSchaerfe(input: SchaerfeInput): number {
  // Korpus-Anteil
  const webAnteil = input.hatteWebKorpus ? 25 : 0
  const profilAnteil =
    input.hatteBestehendesProfil === true
      ? 15
      : input.hatteBestehendesProfil === 'kurz'
      ? 8
      : 0
  const korpus = Math.min(40, webAnteil + profilAnteil)

  // Tag-Anteil: max 5 Tags mit gewicht 3 + mind. 2 evidenz
  const belegte3er = input.tags.filter(
    t => t.gewicht === 3 && Array.isArray(t.evidenz) && t.evidenz.length >= 2
  ).length
  const tagAnteil = Math.min(30, 6 * belegte3er)

  // foerderpraxis: 0 (Medien)
  const fpBelegt = 0

  // Exclusion-Bonus
  const exclusionBonus = input.exclusion_tags.length > 0 ? 10 : 0

  return korpus + tagAnteil + fpBelegt + exclusionBonus
}

// ─── Ollama-Antwort parsen ────────────────────────────────────────────────────

/**
 * Robust-Parser: Trim, </think>-Split, dann erstes JSON-Objekt mit "tags".
 * Wirft, wenn kein parsebares Objekt gefunden wird.
 */
export function parseOllamaAntwort(rawContent: string): OllamaRohAntwort {
  let s = (rawContent ?? '').trim()

  // think-Block entfernen (Reasoning-Modelle)
  const thinkEnd = s.lastIndexOf('</think>')
  if (thinkEnd !== -1) {
    s = s.slice(thinkEnd + '</think>'.length).trim()
  }

  // Direktes JSON-Parse versuchen
  if (s.startsWith('{')) {
    try {
      return JSON.parse(s) as OllamaRohAntwort
    } catch {
      // weiter zum Fallback
    }
  }

  // Erstes Objekt mit "tags" herausschneiden
  const match = s.match(/\{[\s\S]*?"tags"[\s\S]*?\}(?:\s*\])?/)
  if (match) {
    // Nimm den längsten möglichen JSON-Block ab der ersten '{'
    const start = s.indexOf('{')
    if (start !== -1) {
      // Klammer-Tiefe zählen, um das schliessende } zu finden
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
          return JSON.parse(s.slice(start, end + 1)) as OllamaRohAntwort
        } catch {
          // weiter
        }
      }
    }
    // Letzter Versuch: gematchten Block parsen
    try {
      return JSON.parse(match[0]) as OllamaRohAntwort
    } catch {
      // fällt durch
    }
  }

  throw new Error('Kein parsebares JSON-Objekt mit "tags" in der LLM-Antwort gefunden')
}

// ─── Prompt-Builder ───────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `detailed thinking off

Du bist ein präziser Analyst für die publizistische DNA eines Mediums. Du ordnest einem Schweizer/DACH-Medium Themen-Tags aus einem FESTEN Vokabular zu und begründest jede Zuordnung mit Belegen aus dem gelieferten Korpus (Webseite, bestehendes Profil).

HARTE REGELN:
- Wähle IMMER 10-15 Tags (Ziel 12) AUSSCHLIESSLICH aus der gelieferten Slug-Liste. Decke Kern- UND Nebenthemen ab: typischerweise 2-4 Tags Gewicht 3, 4-7 Gewicht 2, Rest Gewicht 1. Erfinde NIEMALS einen Slug.
- Gewicht: 3 = Kernthema (mehrfach belegt), 2 = Nebenthema, 1 = Randthema.
- begruendung: mind. 60, Ziel ~120 Zeichen, konkreter Bezug zum Korpus. KOPIERE NIEMALS das Tag-Label als Begründung.
- evidenz: 1-3 konkrete Quellen je Tag (URL oder "profil").
- sound_feeling: 2-5 Sätze, mind. 150 Zeichen, medienspezifisch (Name, Ausrichtung, Kernthemen, Ton/Haltung). KEIN Generikum.
- exclusion_tags: Slugs die NICHT passen, mit kurzer Begründung. Leer wenn keine.
- Ein Medium ist ANTRAGSTELLER, KEINE Förderstiftung — gib KEINE foerderpraxis aus.
- Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, kein Text davor/danach.

AUSGABE-SCHEMA:
{"sound_feeling": str, "tags": [{"tag_slug": str, "gewicht": 1|2|3, "begruendung": str, "evidenz": [str]}], "exclusion_tags": [{"tag_slug": str, "begruendung": str}]}`

export function buildUserPrompt(params: {
  mediumName: string
  websiteUrl: string | null
  webKorpus: string | null
  bestehendesProfil: { soundFeeling: string | null; topTags: string } | null
}): string {
  const vocabLines = buildVocabLines()
  const lines: string[] = []

  lines.push(`Medium: ${params.mediumName}`)
  if (params.websiteUrl) {
    lines.push(`Webseite: ${params.websiteUrl}`)
  }

  if (params.webKorpus && params.webKorpus.length > 0) {
    lines.push(`\nWEB-KORPUS (gecrawlt):\n${params.webKorpus.slice(0, 14000)}`)
  }

  if (params.bestehendesProfil) {
    const { soundFeeling, topTags } = params.bestehendesProfil
    if (soundFeeling || topTags) {
      lines.push('\nBESTEHENDES PROFIL:')
      if (soundFeeling) lines.push(`Sound/Feeling: ${soundFeeling}`)
      if (topTags) lines.push(`Top-Tags: ${topTags}`)
    }
  }

  lines.push(`\nVERFÜGBARE TAG-SLUGS (nur aus dieser Liste!):\n${vocabLines}`)

  return lines.join('\n')
}

// ─── Schärfe-Input aus Mess-Kontext ableiten ──────────────────────────────────

export function buildSchaerfeInput(params: {
  webKorpus: string | null
  bestehendesProfil: { soundFeeling: string | null; topTags: string } | null
  tags: DnaTag[]
  exclusion_tags: ExclusionTag[]
}): SchaerfeInput {
  const hatteWebKorpus = Boolean(params.webKorpus && params.webKorpus.length > 400)

  const profilText = [
    params.bestehendesProfil?.soundFeeling ?? '',
    params.bestehendesProfil?.topTags ?? '',
  ].join(' ')

  const hatteBestehendesProfil: boolean | 'kurz' =
    profilText.length > 200 ? true : profilText.length > 0 ? 'kurz' : false

  return {
    hatteWebKorpus,
    hatteBestehendesProfil,
    tags: params.tags,
    exclusion_tags: params.exclusion_tags,
  }
}
