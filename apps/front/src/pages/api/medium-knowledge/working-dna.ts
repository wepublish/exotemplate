/**
 * /api/medium-knowledge/working-dna — Asynchrone Arbeits-DNA-Generierung (Stufe 1).
 *
 * ASYNC-DESIGN: Ein qwen-Call dauert unter Last mehrere Minuten.
 * Cloudflare bricht synchrone Requests nach ~100s ab (524).
 * Daher fire-and-forget: POST kehrt sofort mit job_id zurück;
 * Generierung läuft im Hintergrund; Client pollt via GET.
 *
 * Das Ergebnis wird in faas_medien.arbeits_dna + arbeits_dna_stand geschrieben.
 * Die Arbeits-DNA (Stufe 1) ist BEWUSST getrennt von medium_dna (Stufe 2 / v3-DNA).
 *
 * POST { medium_id: string }
 *   → 202 { job_id: string; status: 'running' }
 *   → 200 { job_id: string; status: 'running' }  (wenn bereits ein Job läuft)
 *
 * GET ?job_id=<id>
 *   → 200 { id, medium_id, status, startedAt, result?, error? }
 *   → 404 { error: 'Job nicht gefunden' }
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { callLLM, parseJsonLoose } from '@/lib/llm'
import {
  createWorkingDnaJob,
  getWorkingDnaJob,
  setWorkingDnaJob,
  findRunningWorkingDnaByMedium,
  type WorkingDnaJob,
  type ArbeitsDnaResult,
} from '@/lib/working-dna-jobs'

// ─── Typen ────────────────────────────────────────────────────────────────────

type JobStatusResponse = Pick<WorkingDnaJob, 'id' | 'medium_id' | 'status' | 'startedAt' | 'result' | 'error'>

interface JobStartResponse {
  job_id: string
  status: 'running'
}

interface ErrorResponse {
  error: string
}

// ─── Arbeits-DNA-Dimensionen ──────────────────────────────────────────────────

export interface ArbeitsDnaDimensionen {
  core_themes: string[]
  editorial_stance: string[]
  societal_impact: string[]
  target_groups: string[]
  geographic_focus: string
  funding_model_hints: string[]
  funding_keywords: string[]
  grant_strengths: string[]
  matching_foundation_themes: string[]
  dna_summary: string
}

export interface ArbeitsDnaGespeichert extends ArbeitsDnaDimensionen {
  score: number
  korpus_count: number
  generiert_am: string
  batches?: number
  korpus_zeichen?: number
}

// ─── Batch-Bildung ────────────────────────────────────────────────────────────

/**
 * Fasst eine sortierte Liste von Knowledge-Einträgen zu Batches zusammen.
 * Jeder Batch enthält höchstens `maxZeichenProBatch` Zeichen.
 * Format pro Eintrag: «[category] title:\ncontent»
 * Gibt höchstens `maxBatches` Batches zurück.
 */
export function bildeBatches(
  eintraege: { category: string; title: string; content: string }[],
  maxZeichenProBatch: number,
  maxBatches: number
): { batches: string[]; gekappt: boolean } {
  const batches: string[] = []
  let aktuellerBatch: string[] = []
  let aktuelleZeichen = 0

  for (const eintrag of eintraege) {
    if (batches.length >= maxBatches) {
      return { batches, gekappt: true }
    }
    const zeile = `[${eintrag.category}] ${eintrag.title}:\n${eintrag.content}`
    if (aktuelleZeichen + zeile.length > maxZeichenProBatch && aktuellerBatch.length > 0) {
      batches.push(aktuellerBatch.join('\n\n'))
      aktuellerBatch = []
      aktuelleZeichen = 0
    }
    aktuellerBatch.push(zeile.slice(0, maxZeichenProBatch))
    aktuelleZeichen += Math.min(zeile.length, maxZeichenProBatch)
  }

  if (aktuellerBatch.length > 0 && batches.length < maxBatches) {
    batches.push(aktuellerBatch.join('\n\n'))
  }

  return { batches, gekappt: false }
}

// ─── Scoring (Base44-Logik) ───────────────────────────────────────────────────

/**
 * Berechnet den Arbeits-DNA-Score (0–100).
 *
 * Punkte:
 *   +35  wenn Artikel oder Newsletter im Korpus vorhanden
 *   +20  wenn mindestens 1 manuelles Dokument (auto_scraped=false) vorhanden
 *   +20  wenn previous_application-Dokument vorhanden
 *   +10  wenn Website/Beschreibung vorhanden (website gesetzt)
 *   +15  wenn funding_keywords >= 8
 */
export function berechneArbeitsDnaScore(params: {
  hatArtikelOderNewsletter: boolean
  hatManuelles: boolean
  hatPreviousApplication: boolean
  hatWebsite: boolean
  fundingKeywordsAnzahl: number
}): number {
  let score = 0
  if (params.hatArtikelOderNewsletter) score += 35
  if (params.hatManuelles) score += 20
  if (params.hatPreviousApplication) score += 20
  if (params.hatWebsite) score += 10
  if (params.fundingKeywordsAnzahl >= 8) score += 15
  return Math.min(100, score)
}

// ─── LLM-Prompt ───────────────────────────────────────────────────────────────

export const WORKING_DNA_SYSTEM = `Du bist Analyst für die publizistische DNA eines Mediums für Fundraising. Analysiere das Medium aus dem gelieferten Korpus und den Stammdaten.

Gib AUSSCHLIESSLICH ein JSON-Objekt zurück mit diesen Feldern:
- core_themes: Kernthemen des Mediums (Array von Strings, 3–7 Einträge)
- editorial_stance: Redaktionelle Haltung und Weltanschauung (Array von Strings, 2–5 Einträge)
- societal_impact: Gesellschaftliche Wirkung und Relevanz (Array von Strings, 2–4 Einträge)
- target_groups: Zielgruppen des Mediums (Array von Strings, 2–5 Einträge)
- geographic_focus: Geografischer Fokus (einzelner String, z.B. «Schweiz», «DACH», «regional: Graz»)
- funding_model_hints: Hinweise zum Finanzierungsmodell und Fördergeschichte (Array von Strings, 2–5 Einträge)
- funding_keywords: Keywords für Stiftungs-Matching, 8–15 präzise Begriffe die Stiftungsthemen widerspiegeln (Array von Strings)
- grant_strengths: Stärken für Förderanträge — was macht dieses Medium besonders förderwürdig? (Array von Strings, 3–6 Einträge)
- matching_foundation_themes: Passende Stiftungsthemen und -bereiche, in denen das Medium Förderung suchen sollte (Array von Strings, 3–7 Einträge)
- dna_summary: Fliesstext 300–500 Wörter, prägnant und besprechbar — für die Erstbesprechung mit dem Medium. Beschreibt publizistisches Profil, Stärken, Positionierung und Förderrelevanz. Kein Marketingsprech, keine leeren Floskeln.

REGELN:
- Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, kein Text davor oder danach.
- Keine Förderbeträge nennen.
- Kein Vokabular-Zwang (das ist Stufe 2).
- Echte Einschätzung auf Basis des gelieferten Korpus — keine Platzhalter.
- Sprache: Deutsch, mit korrekten Umlauten (ä, ö, ü).`

// MAP-Phase: kompakte Zusammenfassung eines Artikelbatches
export const MAP_SYSTEM = `Du fasst Medien-Inhalte für eine spätere DNA-Analyse zusammen. Gib eine dichte Zusammenfassung (6–10 Sätze, KEINE Einleitung) dieser Beiträge: wiederkehrende Kernthemen, redaktionelle Haltung und Tonalität, Zielgruppen, geografischer Fokus, auffällige Schwerpunkte und wiederkehrende Stichworte. Nur Fakten aus dem Text.`

// ─── Directus-Queries ─────────────────────────────────────────────────────────

const FAAS_MEDIEN_QUERY = `
  query FaasMediumBySlug($slug: String!) {
    faas_medien(
      filter: { slug: { _eq: $slug } }
      limit: 1
    ) {
      id
      name
      website
    }
  }
`

const KNOWLEDGE_QUERY = `
  query KnowledgeForDna($medium: String!) {
    medium_knowledge(
      filter: { medium_id: { _eq: $medium } }
      sort: ["-date_created"]
      limit: -1
    ) {
      id
      category
      title
      content
      source_url
      auto_scraped
      date_created
    }
  }
`

const UPDATE_ARBEITS_DNA_MUTATION = `
  mutation UpdateArbeitsDna($id: ID!, $data: update_faas_medien_input!) {
    update_faas_medien_item(id: $id, data: $data) {
      id
      arbeits_dna_stand
    }
  }
`

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DirectusResponse = { data: any; errors?: { message: string }[] }

async function directusFetch(
  base: string,
  token: string,
  query: string,
  variables: Record<string, unknown>
): Promise<DirectusResponse> {
  const res = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Directus HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json() as Promise<DirectusResponse>
}

// ─── Kern-Generierung (fire-and-forget) ───────────────────────────────────────

/**
 * Führt die vollständige Arbeits-DNA-Generierung durch und schreibt das
 * Ergebnis nach faas_medien.arbeits_dna sowie in den Job-Store.
 *
 * Diese Funktion wird OHNE await gestartet — Fehler werden im Job
 * festgehalten, nicht in der HTTP-Response.
 */
async function runWorkingDna(jobId: string, medium_id: string): Promise<void> {
  const directusBase = process.env.DIRECTUS_URL || 'http://localhost:8055'
  const directusToken = process.env.DIRECTUS_TOKEN || ''

  // ── 1. faas_medien laden (name, website, numerische id) ─────────────────────
  const mediumR = await directusFetch(directusBase, directusToken, FAAS_MEDIEN_QUERY, { slug: medium_id })
  if (mediumR.errors?.length) {
    throw new Error('Directus-Fehler (faas_medien): ' + mediumR.errors[0]?.message)
  }

  const mediumArr = (mediumR.data?.faas_medien ?? []) as {
    id: number
    name: string
    website: string | null
  }[]
  const medium = mediumArr[0]
  if (!medium) {
    throw new Error(`Kein faas_medien-Eintrag für slug "${medium_id}" gefunden`)
  }

  // ── 2. medium_knowledge laden (gesamter Korpus) ──────────────────────────────
  const knowledgeR = await directusFetch(directusBase, directusToken, KNOWLEDGE_QUERY, { medium: medium_id })
  if (knowledgeR.errors?.length) {
    throw new Error('Directus-Fehler (medium_knowledge): ' + knowledgeR.errors[0]?.message)
  }

  const rawItems = (knowledgeR.data?.medium_knowledge ?? []) as {
    id: number
    category: string
    title: string
    content: string | null
    source_url: string | null
    auto_scraped: boolean
    date_created: string
  }[]

  // Sortierung: manuelle zuerst (auto_scraped=false), dann auto
  const manuell = rawItems.filter(i => !i.auto_scraped)
  const auto = rawItems.filter(i => i.auto_scraped)
  const sortiert = [...manuell, ...auto]

  // ── 3. Score-Parameter ermitteln (aus dem Roh-Set) ────────────────────────────
  const kategorien = rawItems.map(i => i.category)
  const hatArtikelOderNewsletter =
    kategorien.includes('published_article') || kategorien.includes('newsletter')
  const hatManuelles = manuell.length > 0
  const hatPreviousApplication = kategorien.includes('previous_application')
  const hatWebsite = Boolean(medium.website && medium.website.startsWith('http'))

  // ── 4. Einträge filtern + auf 180 deckeln ────────────────────────────────────
  const MAX_EINTRAEGE = 180
  const gefiltert = sortiert
    .filter(i => (i.content?.trim() ?? '').length > 0)
    .slice(0, MAX_EINTRAEGE)

  // ── 5. MAP-Phase: Batches bilden und je einen LLM-Call machen ─────────────────
  const BATCH_MAX_ZEICHEN = 14_000
  const MAX_BATCHES = 15

  let batchSummaries: string[]
  let gesamtZeichen = 0
  let gekappt = false

  if (gefiltert.length === 0) {
    batchSummaries = []
  } else {
    const batchInput = gefiltert.map(i => ({
      category: i.category,
      title: i.title,
      content: i.content?.trim() ?? '',
    }))

    const { batches, gekappt: warGekappt } = bildeBatches(batchInput, BATCH_MAX_ZEICHEN, MAX_BATCHES)
    gekappt = warGekappt
    gesamtZeichen = batches.reduce((sum, b) => sum + b.length, 0)

    batchSummaries = []
    // Map-Phase GEBÜNDELT PARALLEL: vLLM batcht gleichzeitige Anfragen (continuous
    // batching) — 5 auf einmal statt sequentiell ist drastisch schneller (~3-6 Min
    // statt ~30 Min) und teilt sich den Durchsatz mit dem laufenden DNA-Lauf, ohne
    // ihn zu pausieren. Fehlerhafte Batches → leerer String → werden übersprungen.
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
      for (const s of ergebnisse) {
        if (s.length > 0) batchSummaries.push(s)
      }
      fertig += chunk.length
      await setWorkingDnaJob(jobId, {
        status: 'running',
        result: { score: 0, summary_len: 0, dimensionen_count: 0, phase: `map ${fertig}/${batches.length}` } as ArbeitsDnaResult & { phase: string },
      })
    }
  }

  // ── 6. REDUCE-Phase: Gesamtanalyse aus den Batch-Zusammenfassungen ────────────
  const artikelZahl = gefiltert.length
  const batchAnzahl = batchSummaries.length

  let reduceUser: string
  if (batchAnzahl === 0) {
    reduceUser = [
      `Medium: ${medium.name}`,
      medium.website ? `Website: ${medium.website}` : null,
      '\nKORPUS: (Noch keine Einträge vorhanden — DNA auf Basis von Stammdaten generieren.)',
    ]
      .filter(Boolean)
      .join('\n')
  } else {
    const korpusHinweis = gekappt
      ? `(${batchAnzahl} Stapel über ${artikelZahl} Beiträge — gesamter Korpus war grösser, wurde auf ${MAX_BATCHES} Stapel gekappt)`
      : `(${batchAnzahl} Stapel über ${artikelZahl} Beiträge)`

    // Kontextlimit (vLLM 8192 Tokens): die gebündelten Zusammenfassungen auf
    // ~14'000 Zeichen kappen, damit Input + max_tokens (2000) sicher unter 8192
    // bleiben (sonst HTTP 400 «input+output > context»).
    const summariesText = batchSummaries.join('\n\n---\n\n').slice(0, 14_000)
    reduceUser = [
      `Medium: ${medium.name}`,
      medium.website ? `Website: ${medium.website}` : null,
      `\nZUSAMMENFASSUNGEN DER GESAMTEN BERICHTERSTATTUNG ${korpusHinweis}:\n\n${summariesText}`,
    ]
      .filter(Boolean)
      .join('\n')
  }

  const rawContent = await callLLM({
    system: WORKING_DNA_SYSTEM,
    user: reduceUser,
    temperature: 0.3,
    max_tokens: 2000,
    timeoutMs: 600_000,
  })

  // ── 7. JSON parsen (robust) ───────────────────────────────────────────────────
  const roh = parseJsonLoose(rawContent) as Partial<ArbeitsDnaDimensionen>

  // Defensive Defaults für alle Felder
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

  // ── 8. Score berechnen ────────────────────────────────────────────────────────
  const score = berechneArbeitsDnaScore({
    hatArtikelOderNewsletter,
    hatManuelles,
    hatPreviousApplication,
    hatWebsite,
    fundingKeywordsAnzahl: dimensionen.funding_keywords.length,
  })

  // ── 9. In Directus speichern (faas_medien.arbeits_dna + arbeits_dna_stand) ────
  const jetzt = new Date().toISOString()
  const zuSpeichern: ArbeitsDnaGespeichert = {
    ...dimensionen,
    score,
    korpus_count: artikelZahl,
    generiert_am: jetzt,
    batches: batchAnzahl,
    korpus_zeichen: gesamtZeichen,
  }

  const updateR = await directusFetch(
    directusBase,
    directusToken,
    UPDATE_ARBEITS_DNA_MUTATION,
    {
      id: String(medium.id),
      data: {
        arbeits_dna: zuSpeichern,
        arbeits_dna_stand: jetzt,
      },
    }
  )
  if (updateR.errors?.length) {
    throw new Error('Directus-Mutation fehlgeschlagen: ' + updateR.errors[0]?.message)
  }

  // ── 10. Job als done markieren ────────────────────────────────────────────────
  await setWorkingDnaJob(jobId, {
    status: 'done',
    result: {
      score,
      summary_len: dimensionen.dna_summary.length,
      dimensionen_count: Object.values(dimensionen).filter(v =>
        Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.length > 0 : false
      ).length,
      batches: batchAnzahl,
      artikel_gesamt: artikelZahl,
    } as ArbeitsDnaResult,
  })
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<JobStartResponse | JobStatusResponse | ErrorResponse>
) {
  // ── GET: Polling-Endpoint ───────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { job_id } = req.query
    if (!job_id || typeof job_id !== 'string') {
      res.status(400).json({ error: 'job_id (string) als Query-Parameter erforderlich' })
      return
    }
    const job = await getWorkingDnaJob(job_id)
    if (!job) {
      res.status(404).json({ error: 'Job nicht gefunden' })
      return
    }
    const payload: JobStatusResponse = {
      id: job.id,
      medium_id: job.medium_id,
      status: job.status,
      startedAt: job.startedAt,
      ...(job.result !== undefined ? { result: job.result } : {}),
      ...(job.error !== undefined ? { error: job.error } : {}),
    }
    res.status(200).json(payload)
    return
  }

  // ── POST: Job starten ───────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Nur POST und GET erlaubt' })
    return
  }

  const { medium_id } = req.body ?? {}
  if (!medium_id || typeof medium_id !== 'string') {
    res.status(400).json({ error: 'medium_id (string) erforderlich' })
    return
  }

  // Doppel-Start verhindern: wenn bereits ein Job für dieses Medium läuft,
  // denselben zurückgeben.
  const existing = await findRunningWorkingDnaByMedium(medium_id)
  if (existing) {
    res.status(200).json({ job_id: existing.id, status: 'running' })
    return
  }

  // Neuen Job anlegen und Generierung fire-and-forget starten.
  const job = await createWorkingDnaJob(medium_id)

  // Fire-and-forget: kein await — Response kehrt SOFORT zurück.
  runWorkingDna(job.id, medium_id).catch((e: unknown) => {
    void setWorkingDnaJob(job.id, {
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    }).catch(() => {})
  })

  res.status(202).json({ job_id: job.id, status: 'running' })
}
