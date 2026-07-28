/**
 * dna-pipeline.ts — Wiederverwendbare DNA-Pipeline-Bausteine für den Ein-Knopf-Flow
 * (/api/medium-knowledge/generate-dna).
 *
 * Drei Schritte, jeder als eigenständige Funktion (testbar, vom Orchestrator verkettet):
 *   1. erzeugeArbeitsDna  — Map-Reduce über medium_knowledge → faas_medien.arbeits_dna.
 *                           (Verdichtung vieler Quellen auf einen kompakten Korpus +
 *                           menschenlesbares Profil fürs PDF.)
 *   2. messeFinaleDna     — v3-Mess-Kern → neue (nicht-aktive) medium_dna-Version.
 *   3. aktiviereDna       — eine Version aktiv schalten, alle anderen deaktivieren.
 *
 * Die LLM-PROMPTS sind geteilt mit den bestehenden Einzel-Endpoints (additive Exports
 * aus working-dna.ts / measure-medium-dna.ts) — eine Quelle der Wahrheit, kein Drift.
 * Die Verkettungs-Glue (Batch-Schleife, Korpus-Bau, Directus-Writes) lebt hier.
 */

import { callLLM, parseJsonLoose } from '@/lib/llm'
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseOllamaAntwort,
  filterVokabular,
  calcSchaerfe,
  buildSchaerfeInput,
  type DnaTag,
  type ExclusionTag,
} from '@/lib/dna-mess-kern'
import {
  WORKING_DNA_SYSTEM,
  MAP_SYSTEM,
  bildeBatches,
  berechneArbeitsDnaScore,
  type ArbeitsDnaDimensionen,
  type ArbeitsDnaGespeichert,
} from '@/pages/api/medium-knowledge/working-dna'
import { baueArbeitsDnaText, baueMediumDnaText } from '@/pages/api/measure-medium-dna'
import type { DnaJobResult } from '@/lib/dna-jobs'

// ─── Directus-Helfer ──────────────────────────────────────────────────────────

interface DirectusResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any
  errors?: { message: string }[]
}

async function directusFetch(
  base: string,
  token: string,
  query: string,
  variables: Record<string, unknown>,
  timeoutMs = 30_000
): Promise<DirectusResponse> {
  const res = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Directus HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json() as Promise<DirectusResponse>
}

// ─── 1. Arbeits-DNA (Map-Reduce-Verdichtung) ────────────────────────────────────

export interface KnowledgeItem {
  category: string
  title: string
  content: string | null
  auto_scraped: boolean
}

export interface ArbeitsDnaErgebnis {
  zuSpeichern: ArbeitsDnaGespeichert
  artikelZahl: number
  batchAnzahl: number
}

export const KNOWLEDGE_QUERY = `
  query KnowledgeForDna($medium: String!) {
    medium_knowledge(filter: { medium_id: { _eq: $medium } }, sort: ["-date_created"], limit: -1) {
      category
      title
      content
      auto_scraped
    }
  }
`

const UPDATE_ARBEITS_DNA = `
  mutation UpdateArbeitsDna($id: ID!, $data: update_faas_medien_input!) {
    update_faas_medien_item(id: $id, data: $data) { id arbeits_dna_stand }
  }
`

/**
 * Verdichtet einen bereits geladenen Knowledge-Korpus per Map-Reduce und schreibt
 * faas_medien.arbeits_dna. Der Orchestrator lädt den Korpus selbst (er kennt ihn
 * nach dem Einsammeln frisch) und übergibt ihn hier.
 */
export async function erzeugeArbeitsDnaAusKorpus(params: {
  base: string
  token: string
  mediumNumericId: number
  mediumName: string
  website: string | null
  knowledge: KnowledgeItem[]
  onProgress?: (phase: string) => void
}): Promise<ArbeitsDnaErgebnis> {
  const { base, token, mediumNumericId, mediumName, website, knowledge, onProgress } = params

  const manuell = knowledge.filter(i => !i.auto_scraped)
  const auto = knowledge.filter(i => i.auto_scraped)
  const sortiert = [...manuell, ...auto]

  const kategorien = knowledge.map(i => i.category)
  const hatArtikelOderNewsletter =
    kategorien.includes('published_article') || kategorien.includes('newsletter')
  const hatManuelles = manuell.length > 0
  const hatPreviousApplication = kategorien.includes('previous_application')
  const hatWebsite = Boolean(website && website.startsWith('http'))

  const MAX_EINTRAEGE = 180
  const gefiltert = sortiert
    .filter(i => (i.content?.trim() ?? '').length > 0)
    .slice(0, MAX_EINTRAEGE)

  const BATCH_MAX_ZEICHEN = 14_000
  const MAX_BATCHES = 15

  const batchSummaries: string[] = []
  let gesamtZeichen = 0
  let gekappt = false

  if (gefiltert.length > 0) {
    const batchInput = gefiltert.map(i => ({
      category: i.category,
      title: i.title,
      content: i.content?.trim() ?? '',
    }))
    const { batches, gekappt: warGekappt } = bildeBatches(batchInput, BATCH_MAX_ZEICHEN, MAX_BATCHES)
    gekappt = warGekappt
    gesamtZeichen = batches.reduce((s, b) => s + b.length, 0)

    const MAP_CONCURRENCY = 5
    let fertig = 0
    for (let start = 0; start < batches.length; start += MAP_CONCURRENCY) {
      const chunk = batches.slice(start, start + MAP_CONCURRENCY)
      const ergebnisse = await Promise.all(
        chunk.map(async (b): Promise<string> => {
          try {
            const s = await callLLM({
              system: MAP_SYSTEM,
              user: b ?? '',
              temperature: 0.2,
              max_tokens: 700,
              timeoutMs: 180_000,
            })
            return s.trim()
          } catch {
            return ''
          }
        })
      )
      for (const s of ergebnisse) if (s.length > 0) batchSummaries.push(s)
      fertig += chunk.length
      onProgress?.(`verdichten ${fertig}/${batches.length}`)
    }
  }

  const artikelZahl = gefiltert.length
  const batchAnzahl = batchSummaries.length

  let reduceUser: string
  if (batchAnzahl === 0) {
    reduceUser = [
      `Medium: ${mediumName}`,
      website ? `Website: ${website}` : null,
      '\nKORPUS: (Noch keine Einträge vorhanden — DNA auf Basis von Stammdaten generieren.)',
    ]
      .filter(Boolean)
      .join('\n')
  } else {
    const korpusHinweis = gekappt
      ? `(${batchAnzahl} Stapel über ${artikelZahl} Beiträge — Korpus war grösser, auf ${MAX_BATCHES} Stapel gekappt)`
      : `(${batchAnzahl} Stapel über ${artikelZahl} Beiträge)`
    const summariesText = batchSummaries.join('\n\n---\n\n').slice(0, 14_000)
    reduceUser = [
      `Medium: ${mediumName}`,
      website ? `Website: ${website}` : null,
      `\nZUSAMMENFASSUNGEN DER GESAMTEN BERICHTERSTATTUNG ${korpusHinweis}:\n\n${summariesText}`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  onProgress?.('profil')
  const rawContent = await callLLM({
    system: WORKING_DNA_SYSTEM,
    user: reduceUser,
    temperature: 0.3,
    // 4000 statt 2000: Claude formuliert das Profil ausfuehrlicher als das
    // fruehere qwen; bei 2000 wurde das JSON abgeschnitten (Job-Fehler
    // «parseJsonLoose: kein parsebares JSON-Objekt», zwolf 28.07.2026).
    max_tokens: 4000,
    timeoutMs: 600_000,
    expectJson: true,
  })

  const roh = parseJsonLoose(rawContent) as Partial<ArbeitsDnaDimensionen>
  const dimensionen: ArbeitsDnaDimensionen = {
    core_themes: Array.isArray(roh.core_themes) ? roh.core_themes : [],
    editorial_stance: Array.isArray(roh.editorial_stance) ? roh.editorial_stance : [],
    societal_impact: Array.isArray(roh.societal_impact) ? roh.societal_impact : [],
    target_groups: Array.isArray(roh.target_groups) ? roh.target_groups : [],
    geographic_focus: typeof roh.geographic_focus === 'string' ? roh.geographic_focus : '',
    funding_model_hints: Array.isArray(roh.funding_model_hints) ? roh.funding_model_hints : [],
    funding_keywords: Array.isArray(roh.funding_keywords) ? roh.funding_keywords : [],
    grant_strengths: Array.isArray(roh.grant_strengths) ? roh.grant_strengths : [],
    matching_foundation_themes: Array.isArray(roh.matching_foundation_themes) ? roh.matching_foundation_themes : [],
    dna_summary: typeof roh.dna_summary === 'string' ? roh.dna_summary : '',
  }

  const score = berechneArbeitsDnaScore({
    hatArtikelOderNewsletter,
    hatManuelles,
    hatPreviousApplication,
    hatWebsite,
    fundingKeywordsAnzahl: dimensionen.funding_keywords.length,
  })

  const jetzt = new Date().toISOString()
  const zuSpeichern: ArbeitsDnaGespeichert = {
    ...dimensionen,
    score,
    korpus_count: artikelZahl,
    generiert_am: jetzt,
    batches: batchAnzahl,
    korpus_zeichen: gesamtZeichen,
  }

  const updateR = await directusFetch(base, token, UPDATE_ARBEITS_DNA, {
    id: String(mediumNumericId),
    data: { arbeits_dna: zuSpeichern, arbeits_dna_stand: jetzt },
  })
  if (updateR.errors?.length) {
    throw new Error('arbeits_dna-Write fehlgeschlagen: ' + updateR.errors[0]?.message)
  }

  return { zuSpeichern, artikelZahl, batchAnzahl }
}

// ─── 2. Finale v3-DNA messen ────────────────────────────────────────────────────

const HOECHSTE_VERSION_QUERY = `
  query HoechsteVersion($mediumId: String!) {
    medium_dna(filter: { medium_id: { _eq: $mediumId } }, sort: ["-version"], limit: 1) { version }
  }
`

const AKTIVE_MEDIUM_DNA_QUERY = `
  query AktiveMediumDna($mediumId: String!) {
    medium_dna(filter: { medium_id: { _eq: $mediumId }, is_active: { _eq: true } }, limit: 1) {
      sound_feeling
      tags
      sektionen
    }
  }
`

const CREATE_MEDIUM_DNA = `
  mutation CreateMediumDna($data: create_medium_dna_input!) {
    create_medium_dna_item(data: $data) { id version schaerfe_prozent }
  }
`

/**
 * Misst die finale v3-DNA aus der Arbeits-DNA (Primärkorpus) + optionalem Web-Crawl,
 * schreibt sie als NICHT-aktive medium_dna-Version und gibt das Ergebnis zurück.
 * Fällt auf die bestehende aktive medium_dna zurück, wenn keine Arbeits-DNA übergeben.
 */
export async function messeFinaleDna(params: {
  base: string
  token: string
  medium_id: string
  mediumName: string
  websiteUrl: string | null
  arbeitsDna: Record<string, unknown> | null
  /** Frischer Web-Crawl-Markdown als Zusatzkontext (optional). */
  webKorpus?: string | null
}): Promise<DnaJobResult> {
  const { base, token, medium_id, mediumName, websiteUrl, arbeitsDna } = params

  // Höchste Version + 1
  let neueVersion = 1
  try {
    const r = await directusFetch(base, token, HOECHSTE_VERSION_QUERY, { mediumId: medium_id })
    const arr = (r.data?.medium_dna as { version: number | null }[]) ?? []
    neueVersion = (arr[0]?.version ?? 0) + 1
  } catch {
    neueVersion = 1
  }

  // Korpus: Arbeits-DNA, sonst Fallback auf bestehende aktive medium_dna.
  let korpusText: string
  let profilSoundFeeling: string | null
  let profilTopTags: string
  let korpusQuelle: string

  if (arbeitsDna && typeof arbeitsDna === 'object') {
    korpusText = baueArbeitsDnaText(arbeitsDna)
    profilSoundFeeling = typeof arbeitsDna.dna_summary === 'string' ? arbeitsDna.dna_summary : null
    profilTopTags = Array.isArray(arbeitsDna.funding_keywords)
      ? (arbeitsDna.funding_keywords as string[]).slice(0, 8).join(', ')
      : ''
    korpusQuelle = 'arbeits_dna'
  } else {
    const altR = await directusFetch(base, token, AKTIVE_MEDIUM_DNA_QUERY, { mediumId: medium_id })
    const altDna = (altR.data?.medium_dna as Record<string, unknown>[] | undefined)?.[0] ?? null
    if (!altDna) {
      throw new Error(`Kein Korpus für "${medium_id}": weder Arbeits-DNA noch aktive medium_dna.`)
    }
    korpusText = baueMediumDnaText(altDna)
    if (!korpusText.trim()) {
      throw new Error(`Bestehende medium_dna für "${medium_id}" ist inhaltsleer.`)
    }
    profilSoundFeeling = typeof altDna.sound_feeling === 'string' ? altDna.sound_feeling : null
    profilTopTags = ''
    korpusQuelle = 'medium_dna_profil'
  }

  // Web-Crawl: vom Orchestrator durchgereicht; sonst hier selbst holen.
  let webKorpus: string | null = params.webKorpus ?? null
  if (webKorpus === undefined || webKorpus === null) {
    if (websiteUrl) {
      const firecrawlBase = process.env.FIRECRAWL_URL || 'http://127.0.0.1:8891'
      try {
        const crawlRes = await fetch(`${firecrawlBase}/v1/scrape`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: websiteUrl, formats: ['markdown'] }),
          signal: AbortSignal.timeout(60_000),
        })
        if (crawlRes.ok) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const crawlJson = (await crawlRes.json()) as any
          const md: unknown = crawlJson?.data?.markdown ?? crawlJson?.markdown
          if (typeof md === 'string' && md.length > 0) webKorpus = md
        }
      } catch {
        // Crawl-Fehler nicht fatal
      }
    }
  }

  const bestehendesProfil =
    profilSoundFeeling || profilTopTags
      ? { soundFeeling: profilSoundFeeling ?? null, topTags: profilTopTags }
      : null

  const kombiniertRaw = webKorpus
    ? `MEDIEN-PROFIL:\n${korpusText}\n\n---\nWEBSEITE (gecrawlt, Zusatzkontext):\n${webKorpus.slice(0, 5000)}`
    : korpusText
  const kombinierterKorpus = kombiniertRaw.slice(0, 6500)

  const userPrompt = buildUserPrompt({
    mediumName,
    websiteUrl,
    webKorpus: kombinierterKorpus,
    bestehendesProfil,
  })

  const rawContent = await callLLM({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    temperature: 0,
    // 4000 statt 2400: gleicher Truncation-Schutz wie beim Profil-Schritt
    // (Claude schreibt laenger als das fruehere qwen, Limit stammt von dort).
    max_tokens: 4000,
    timeoutMs: 1_200_000,
    stream: true,
    expectJson: true,
  })

  const rohAntwort = parseOllamaAntwort(rawContent)
  const { tags, exclusion_tags, gefilterteTags } = filterVokabular(rohAntwort)

  let warnung: string | undefined
  if (tags.length < 10) {
    warnung = `Nur ${tags.length} valide Tags nach Vokabular-Filter (${gefilterteTags} gefiltert). Ziel: 10–15.`
  }

  const schaerfe = calcSchaerfe(
    buildSchaerfeInput({ webKorpus: kombinierterKorpus, bestehendesProfil, tags, exclusion_tags })
  )

  const versionId = `v${neueVersion}-app-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const datenbasis = webKorpus ? `${korpusQuelle}+web+app` : `${korpusQuelle}+app`

  const dnaData = {
    medium_id,
    medium_name: mediumName,
    version: neueVersion,
    version_id: versionId,
    is_active: false,
    veredelt_at: new Date().toISOString(),
    veredelt_by: 'matching-app-ein-knopf',
    schaerfe_prozent: schaerfe,
    sound_feeling: String(rohAntwort.sound_feeling ?? '').trim(),
    tags: tags as unknown as DnaTag[],
    exclusion_tags: exclusion_tags as unknown as ExclusionTag[],
    foerderpraxis: {},
    vocabulary_version_at_creation: 3,
    antragsteller_typ: 'medium',
    quellen: {
      datenbasis,
      webseite_url: websiteUrl ?? undefined,
      gemessen_am: new Date().toISOString(),
      gemessen_durch: 'matching-app-ein-knopf',
    },
  }

  const createR = await directusFetch(base, token, CREATE_MEDIUM_DNA, { data: dnaData })
  if (createR.errors?.length) {
    throw new Error('medium_dna-Write fehlgeschlagen: ' + createR.errors[0]?.message)
  }
  const created = createR.data?.create_medium_dna_item as { id: number }

  return {
    id: created.id,
    version: neueVersion,
    schaerfe_prozent: schaerfe,
    tag_count: tags.length,
    sound_feeling: String(rohAntwort.sound_feeling ?? '').trim(),
    tags: tags as { tag_slug: string; gewicht: number; begruendung: string }[],
    hatte_crawl: Boolean(webKorpus),
    ...(warnung ? { warnung } : {}),
  }
}

// ─── 3. DNA-Version aktiv schalten ──────────────────────────────────────────────

const LOAD_VERSION_QUERY = `
  query LoadVersion($id: ID!) {
    medium_dna_by_id(id: $id) { id medium_id version is_active }
  }
`
const AKTIVE_VERSIONEN_QUERY = `
  query AktiveVersionen($mediumId: String!) {
    medium_dna(filter: { medium_id: { _eq: $mediumId }, is_active: { _eq: true } }, limit: -1) { id }
  }
`
const SET_ACTIVE_MUTATION = `
  mutation SetActive($id: ID!, $data: update_medium_dna_input!) {
    update_medium_dna_item(id: $id, data: $data) { id is_active }
  }
`

/**
 * Schaltet die Version `numericId` aktiv und deaktiviert alle anderen aktiven
 * Versionen desselben Mediums. Idempotent (bereits aktiv → no-op).
 */
export async function aktiviereDna(base: string, token: string, numericId: number): Promise<void> {
  const loadR = await directusFetch(base, token, LOAD_VERSION_QUERY, { id: String(numericId) })
  if (loadR.errors?.length) throw new Error('Aktivieren (laden): ' + loadR.errors[0]?.message)
  const ziel = (loadR.data?.medium_dna_by_id as { medium_id: string; is_active: boolean } | null) ?? null
  if (!ziel) throw new Error(`Keine DNA-Version mit id ${numericId}`)
  if (ziel.is_active) return

  const aktivR = await directusFetch(base, token, AKTIVE_VERSIONEN_QUERY, { mediumId: ziel.medium_id })
  if (aktivR.errors?.length) throw new Error('Aktivieren (aktive laden): ' + aktivR.errors[0]?.message)
  const aktivIds = ((aktivR.data?.medium_dna as { id: number }[]) ?? [])
    .map(x => Number(x.id))
    .filter(x => isFinite(x) && x !== numericId)

  for (const oldId of aktivIds) {
    const r = await directusFetch(base, token, SET_ACTIVE_MUTATION, { id: String(oldId), data: { is_active: false } })
    if (r.errors?.length) throw new Error(`Deaktivieren ${oldId}: ` + r.errors[0]?.message)
  }

  const r = await directusFetch(base, token, SET_ACTIVE_MUTATION, { id: String(numericId), data: { is_active: true } })
  if (r.errors?.length) throw new Error(`Aktivieren ${numericId}: ` + r.errors[0]?.message)
}

/**
 * Stösst nach der DNA-Aktivierung einen Erst-/Re-Match für das Medium an
 * (Adapter-Endpoint auf dem Host). Best effort: Fehler werden geschluckt —
 * der 6h-Re-Match-Cron holt das Matching sonst ohnehin nach.
 */
export async function triggerErstMatch(mediumSlug: string): Promise<void> {
  const base = process.env.HERMES_API_URL
  if (!base || !mediumSlug) return
  try {
    await fetch(`${base.replace(/\/$/, '')}/medium-matchen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ medium: mediumSlug }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    // best effort — Cron ist das Sicherheitsnetz
  }
}
