/**
 * /api/calculate-amount — Asynchrone Betrag-Recherche (fire-and-forget).
 *
 * ASYNC-DESIGN: Ein qwen-Call dauert unter Last Minuten, Cloudflare bricht
 * synchrone Requests nach ~100s ab (524). Daher fire-and-forget: der POST
 * kehrt sofort mit job_id zurück; der Client pollt via GET.
 *
 * POST { stiftung_id: string | number, medium_id: string }
 *   → 202 { job_id: string; status: 'running' }      (neuer Job)
 *   → 200 { job_id: string; status: 'running' }      (Paar läuft bereits)
 *
 * GET ?job_id=<id>
 *   → 200 { id, key, status, startedAt, result?, error? }
 *   → 404 { error: 'Job nicht gefunden' }
 *
 * Ein fertiges Ergebnis wird zusätzlich in match_results.betrag_recherche
 * persistiert (best effort) — damit überlebt der Betrag Reload, Navigation
 * und Container-Neustarts und erscheint direkt in der Match-Liste.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import {
  createAmountJob,
  getAmountJob,
  setAmountJob,
  findRunningByKey,
  type AmountJob,
} from '@/lib/amount-jobs'
import { callLLM } from '@/lib/llm'
import {
  istSonderZiel, mapSonderItem, sonderRef, SONDER_FELDER, type SonderZiel,
} from '@/lib/sonder-gesuch'

// ─── Typen ────────────────────────────────────────────────────────────────────

type JobStatusResponse = Pick<AmountJob, 'id' | 'key' | 'status' | 'startedAt' | 'result' | 'error'>

interface JobStartResponse {
  job_id: string
  status: 'running'
}

interface ErrorResponse {
  error: string
  raw?: string
}

// ─── Directus-GraphQL-Query ──────────────────────────────────────────────────

const QUERY = `
  query BetragsRecherche($stiftungId: GraphQLStringOrFloat!, $mediumId: String!) {
    stiftungen(filter: { id: { _eq: $stiftungId } }, limit: 1) {
      id
      name: Stiftungsname
      kategorie
      sitz
      land
      zwecktext
      foerderbedingungen
      foerdersummen_range
      foerderbeitraege
    }

    stiftungs_dna(
      filter: {
        stiftung_id: { id: { _eq: $stiftungId } }
        is_active: { _eq: true }
      }
      limit: 1
    ) {
      sound_feeling
      foerderpraxis
    }

    medium_dna(
      filter: {
        medium_id: { _eq: $mediumId }
        is_active: { _eq: true }
      }
      limit: 1
    ) {
      medium_name
      sound_feeling
      tags
    }

    applications(
      filter: { stiftung_id: { _eq: $stiftungId }, status: { _eq: "zugesagt" } }
      limit: 10
      sort: ["-entschieden_am"]
    ) {
      betrag_zugesagt_chf
      betrag_chf
      medium_id
    }
  }
`

// ─── Prompt-Builder ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Du bist ein extrem kritischer Experte für Stiftungsfinanzierung im Schweizer Mediensektor. Schlage einen realistischen, massgeschneiderten Förderbetrag (CHF) für dieses Match vor.

REGELN:
- Niemals pauschal 50'000.
- Passe an Grösse des Mediums und Art der Stiftung an.
- Kleine Stiftungen / Anschubfinanzierung: 2'000–10'000.
- Lokale Projekte: 10'000–25'000.
- Grosse Stiftungen / etablierte Medien: 30'000–50'000.
- Sehr grosse Projekte / Lotteriefonds: 50'000–100'000.
- Ist die Stiftung für Kleinbeiträge bekannt, bleibe unter 15'000.
- WENN frühere Zusagen dieser Stiftung vorliegen, ist das der STÄRKSTE Anker — orientiere den Betrag nah daran.
- Begründe, warum genau dieser Betrag zur Mediengrösse und zur Stiftung passt.
- Antworte AUSSCHLIESSLICH als JSON {"suggested_amount": number, "reasoning": string}.`

function buildUserPrompt(data: {
  // Stiftung
  name: string | null
  kategorie: string | null
  sitz: string | null
  land: string | null
  zwecktext: string | null
  foerderbedingungen: string | null
  foerdersummen_range: string | null
  foerderbeitraege: string | null
  // Stiftungs-DNA
  dna_sound_feeling: string | null
  dna_foerderpraxis: unknown
  // Medium-DNA
  medium_name: string | null
  medium_sound_feeling: string | null
  medium_tags: string[]
  // Lern-Loop: frühere Zusagen dieser Stiftung
  prior_zusagen: string
}): string {
  const clean = (v: unknown): string => {
    if (v == null) return '(keine Angabe)'
    if (typeof v === 'string') return v.trim() || '(keine Angabe)'
    if (typeof v === 'object') {
      const s = JSON.stringify(v)
      return s === '{}' || s === '[]' ? '(keine Angabe)' : s
    }
    return String(v)
  }

  const topTags = data.medium_tags.slice(0, 8).join(', ') || '(keine Angabe)'

  return `## Stiftung
Name: ${clean(data.name)}
Kategorie: ${clean(data.kategorie)}
Sitz: ${clean(data.sitz)} / ${clean(data.land)}
Zweck: ${clean(data.zwecktext)}
Förderbedingungen: ${clean(data.foerderbedingungen)}
Fördersummen-Bereich: ${clean(data.foerdersummen_range)}
Förderbeiträge (Richtgrössen): ${clean(data.foerderbeitraege)}

## Stiftungs-DNA
Förderpraxis: ${clean(data.dna_foerderpraxis)}
Sound / Feeling: ${clean(data.dna_sound_feeling)}

## Medium
Name: ${clean(data.medium_name)}
Sound / Feeling: ${clean(data.medium_sound_feeling)}
Top-Tags: ${topTags}

## Frühere Zusagen dieser Stiftung (Lern-Loop — stärkster Anker, wenn vorhanden)
${data.prior_zusagen}`
}

// ─── Tags aus Medium-DNA robust extrahieren ───────────────────────────────────

function extractMediumTags(rawTags: unknown): string[] {
  if (!rawTags) return []
  if (Array.isArray(rawTags)) {
    return rawTags
      .map((t: unknown) => {
        if (typeof t === 'string') return t
        if (t && typeof t === 'object' && 'tag_slug' in t) return String((t as { tag_slug: unknown }).tag_slug)
        if (t && typeof t === 'object' && 'slug' in t) return String((t as { slug: unknown }).slug)
        return null
      })
      .filter((t): t is string => !!t)
  }
  if (typeof rawTags === 'string') {
    try {
      const parsed = JSON.parse(rawTags)
      if (Array.isArray(parsed)) {
        return parsed.map((t: unknown) => (typeof t === 'string' ? t : String(t)))
      }
    } catch {
      // kein gültiges JSON — leer lassen
    }
  }
  return []
}

// ─── LLM-Antwort parsen (geteilt: Stiftungs- und Sonder-Pfad) ────────────────

function parseAmountAntwort(rawContent: string): {
  suggested_amount: number
  reasoning: string
  currency: 'CHF'
} {
  const trimmed = rawContent.trim()
  // Erstes vollständiges JSON-Objekt mit suggested_amount herausschneiden
  const jsonMatch = trimmed.match(/\{[^{}]*"suggested_amount"[^{}]*\}/)
  const toParse = jsonMatch ? jsonMatch[0] : trimmed

  let parsed: { suggested_amount: unknown; reasoning: unknown }
  try {
    parsed = JSON.parse(toParse) as { suggested_amount: unknown; reasoning: unknown }
  } catch {
    throw new Error(
      `LLM-Antwort konnte nicht als JSON geparst werden: ${rawContent.slice(0, 400)}`
    )
  }

  const amount = Number(parsed.suggested_amount)
  // amount === 0 ist eine GÜLTIGE Antwort: das LLM sagt damit «kein konkreter Betrag
  // empfehlbar» (z.B. wenn der Förderer keine klassische Stiftung ist) — kein Fehler.
  // Nur fehlende/nicht-numerische/negative Werte sind ein echter Parse-Fehler.
  if (!isFinite(amount) || amount < 0) {
    throw new Error(
      `suggested_amount ungültig oder nicht vorhanden: ${rawContent.slice(0, 400)}`
    )
  }

  return {
    suggested_amount: Math.round(amount),
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : String(parsed.reasoning ?? ''),
    currency: 'CHF' as const,
  }
}

// ─── Persistenz des Ergebnisses ──────────────────────────────────────────────

/**
 * Schreibt das fertige Ergebnis in match_results.betrag_recherche (Medium-Ebene,
 * projekt_id-loser Treffer). Best effort: gibt es keinen Match-Datensatz für das
 * Paar (z.B. Aufruf aus den Schnellaktionen), wird still übersprungen — das
 * Job-Ergebnis bleibt davon unberührt.
 */
async function persistBetrag(
  stiftung_id: string,
  medium_id: string,
  result: { suggested_amount: number; reasoning: string; currency: 'CHF' }
): Promise<void> {
  const directusBase = process.env.DIRECTUS_URL || 'http://localhost:8055'
  const directusToken = process.env.DIRECTUS_TOKEN || ''
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${directusToken}`,
  }

  const filter = encodeURIComponent(JSON.stringify({
    _and: [
      { medium_id: { _eq: medium_id } },
      { stiftung_id: { _eq: stiftung_id } },
      { projekt_id: { _null: true } },
    ],
  }))
  const findRes = await fetch(
    `${directusBase}/items/match_results?filter=${filter}&fields=id&limit=1`,
    { headers, signal: AbortSignal.timeout(15_000) }
  )
  const found = (await findRes.json()) as { data?: { id: string }[] }
  const matchId = found.data?.[0]?.id
  if (!matchId) return

  await fetch(`${directusBase}/items/match_results/${matchId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      betrag_recherche: { ...result, computed_at: new Date().toISOString() },
    }),
    signal: AbortSignal.timeout(15_000),
  })
}

// ─── Kern-Berechnung (fire-and-forget) ───────────────────────────────────────

/**
 * Führt die Betrag-Recherche durch (Directus-Query + Ollama-Call)
 * und schreibt das Ergebnis in den Job-Store.
 *
 * Diese Funktion wird OHNE await gestartet — Fehler werden im Job
 * festgehalten, nicht in der HTTP-Response.
 */
async function runCalc(jobId: string, stiftung_id: string, medium_id: string): Promise<void> {
  const directusBase = process.env.DIRECTUS_URL || 'http://localhost:8055'
  const directusToken = process.env.DIRECTUS_TOKEN || ''

  // ── 1. Directus-Daten laden ──────────────────────────────────────────────
  type DirectusData = {
    stiftungen: {
      id: string
      name: string | null
      kategorie: string | null
      sitz: string | null
      land: string | null
      zwecktext: string | null
      foerderbedingungen: string | null
      foerdersummen_range: string | null
      foerderbeitraege: string | null
    }[]
    stiftungs_dna: {
      sound_feeling: string | null
      foerderpraxis: string | null
    }[]
    medium_dna: {
      medium_name: string | null
      sound_feeling: string | null
      tags: unknown
    }[]
    applications: {
      betrag_zugesagt_chf: number | null
      betrag_chf: number | null
      medium_id: string | null
    }[]
  }

  const directusRes = await fetch(`${directusBase}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${directusToken}`,
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { stiftungId: stiftung_id, mediumId: medium_id },
    }),
    signal: AbortSignal.timeout(30_000),
  })

  const directusJson = await directusRes.json()
  if (directusJson.errors?.length) {
    throw new Error('Directus-Fehler: ' + directusJson.errors[0]?.message)
  }
  const directusData = directusJson.data as DirectusData

  const stiftung = directusData.stiftungen?.[0]
  if (!stiftung) {
    throw new Error(`Stiftung ${stiftung_id} nicht gefunden`)
  }

  const dna = directusData.stiftungs_dna?.[0] ?? null
  const medDna = directusData.medium_dna?.[0] ?? null
  const mediumTags = extractMediumTags(medDna?.tags)

  // Lern-Loop: frühere Zusagen DIESER Stiftung als Anker für den Betrag.
  const priorZusagen = (directusData.applications ?? [])
    .map((a) => ({ betrag: a.betrag_zugesagt_chf ?? a.betrag_chf, medium: a.medium_id }))
    .filter((a): a is { betrag: number; medium: string | null } => typeof a.betrag === 'number' && a.betrag > 0)
  const priorZusagenText =
    priorZusagen.length > 0
      ? priorZusagen.map((a) => `CHF ${a.betrag}${a.medium ? ` (${a.medium})` : ''}`).join(', ')
      : '(keine früheren Zusagen erfasst)'

  // ── 2. Prompt bauen ──────────────────────────────────────────────────────
  const userPrompt = buildUserPrompt({
    name: stiftung.name,
    kategorie: stiftung.kategorie,
    sitz: stiftung.sitz,
    land: stiftung.land,
    zwecktext: stiftung.zwecktext,
    foerderbedingungen: stiftung.foerderbedingungen,
    foerdersummen_range: stiftung.foerdersummen_range,
    foerderbeitraege: stiftung.foerderbeitraege,
    dna_sound_feeling: dna?.sound_feeling ?? null,
    dna_foerderpraxis: dna?.foerderpraxis ?? null,
    medium_name: medDna?.medium_name ?? null,
    medium_sound_feeling: medDna?.sound_feeling ?? null,
    medium_tags: mediumTags,
    prior_zusagen: priorZusagenText,
  })

  // ── 3. vLLM-Call (grosszügiger Timeout — Client wartet nicht) ──────────────
  // callLLM beinhaltet Retry-Logik (3×, 5s Backoff, nur bei Verbindungsabbruch).
  const rawContent = await callLLM({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    temperature: 0.2,
    max_tokens: 1200,
    timeoutMs: 300_000, // 5 Minuten
  })

  // ── 4. Antwort parsen + Job als done markieren ───────────────────────────
  const result = parseAmountAntwort(rawContent)
  await setAmountJob(jobId, { status: 'done', result })

  // ── 6. Ergebnis persistieren (best effort, blockiert den Job nicht) ───────
  try {
    await persistBetrag(stiftung_id, medium_id, result)
  } catch (e) {
    console.warn('[calculate-amount] Persistieren fehlgeschlagen:', e)
  }
}

// ─── Sonder-Förderer (kirchen/foerderer/lotteriefonds/sponsoren) ─────────────

const SONDER_KATEGORIE: Record<SonderZiel, string> = {
  kirchen: 'Kirche / kirchliche Förderstelle',
  foerderer: 'Öffentlicher oder privater Förderer',
  lotteriefonds: 'Lotteriefonds',
  sponsoren: 'Sponsor (B2B)',
}

/** Pendant zu persistBetrag: schreibt in sonder_match_results.betrag_recherche. */
async function persistSonderBetrag(
  ziel: SonderZiel,
  zielId: string,
  medium_id: string,
  result: { suggested_amount: number; reasoning: string; currency: 'CHF' }
): Promise<void> {
  const directusBase = process.env.DIRECTUS_URL || 'http://localhost:8055'
  const directusToken = process.env.DIRECTUS_TOKEN || ''
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${directusToken}`,
  }

  const filter = encodeURIComponent(JSON.stringify({
    _and: [
      { medium_id: { _eq: medium_id } },
      { ziel_collection: { _eq: ziel } },
      { ziel_id: { _eq: zielId } },
    ],
  }))
  const findRes = await fetch(
    `${directusBase}/items/sonder_match_results?filter=${filter}&fields=id&limit=1`,
    { headers, signal: AbortSignal.timeout(15_000) }
  )
  const found = (await findRes.json()) as { data?: { id: string }[] }
  const matchId = found.data?.[0]?.id
  if (!matchId) return

  await fetch(`${directusBase}/items/sonder_match_results/${matchId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      betrag_recherche: { ...result, computed_at: new Date().toISOString() },
    }),
    signal: AbortSignal.timeout(15_000),
  })
}

/**
 * Betrag-Recherche für einen Sonder-Förderer. Gleicher LLM-Prompt und
 * Parse-Pfad wie runCalc — nur die Datenquelle ist die Sonder-Collection
 * (DNA-Felder direkt auf dem Item, vertrauliches bemerkungen-Feld bewusst
 * nicht gelesen) und die Zusagen-Anker laufen über applications.sonder_ref.
 */
async function runCalcSonder(
  jobId: string,
  ziel: SonderZiel,
  zielId: string,
  medium_id: string
): Promise<void> {
  const directusBase = process.env.DIRECTUS_URL || 'http://localhost:8055'
  const directusToken = process.env.DIRECTUS_TOKEN || ''
  const headers = { Authorization: `Bearer ${directusToken}` }
  const ref = sonderRef(ziel, zielId)

  // ── 1. Sonder-Item laden ─────────────────────────────────────────────────
  const ir = await fetch(
    `${directusBase}/items/${ziel}/${encodeURIComponent(zielId)}?fields=${SONDER_FELDER[ziel].join(',')}`,
    { headers, signal: AbortSignal.timeout(30_000) }
  )
  const item = (await ir.json())?.data
  if (!ir.ok || !item) {
    throw new Error(`${ziel}/${zielId} nicht gefunden`)
  }
  const felder = mapSonderItem(ziel, item)

  // ── 2. Medium-DNA + frühere Zusagen (über sonder_ref) ────────────────────
  const KONTEXT = `
    query SonderBetragKontext($mediumId: String!, $ref: String!) {
      medium_dna(
        filter: { medium_id: { _eq: $mediumId }, is_active: { _eq: true } }
        limit: 1
      ) {
        medium_name
        sound_feeling
        tags
      }
      applications(
        filter: { sonder_ref: { _eq: $ref }, status: { _eq: "zugesagt" } }
        limit: 10
        sort: ["-entschieden_am"]
      ) {
        betrag_zugesagt_chf
        betrag_chf
        medium_id
      }
    }
  `
  const kr = await fetch(`${directusBase}/graphql`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: KONTEXT, variables: { mediumId: medium_id, ref } }),
    signal: AbortSignal.timeout(30_000),
  })
  const kj = await kr.json()
  if (kj.errors?.length) {
    throw new Error('Directus-Fehler: ' + kj.errors[0]?.message)
  }
  const medDna = kj.data?.medium_dna?.[0] ?? null
  const mediumTags = extractMediumTags(medDna?.tags)

  const priorZusagen = ((kj.data?.applications ?? []) as {
    betrag_zugesagt_chf: number | null
    betrag_chf: number | null
    medium_id: string | null
  }[])
    .map((a) => ({ betrag: a.betrag_zugesagt_chf ?? a.betrag_chf, medium: a.medium_id }))
    .filter((a): a is { betrag: number; medium: string | null } => typeof a.betrag === 'number' && a.betrag > 0)
  const priorZusagenText =
    priorZusagen.length > 0
      ? priorZusagen.map((a) => `CHF ${a.betrag}${a.medium ? ` (${a.medium})` : ''}`).join(', ')
      : '(keine früheren Zusagen erfasst)'

  // ── 3. Prompt bauen (gleiche Slots wie der Stiftungs-Pfad) ───────────────
  const userPrompt = buildUserPrompt({
    name: felder.stiftungName,
    kategorie: SONDER_KATEGORIE[ziel],
    sitz: felder.stiftungSitz,
    land: felder.stiftungLand,
    zwecktext: felder.stiftungZweck,
    foerderbedingungen: null,
    foerdersummen_range: null,
    foerderbeitraege: null,
    dna_sound_feeling: felder.stiftungSound,
    dna_foerderpraxis: felder.stiftungFoerderpraxis,
    medium_name: medDna?.medium_name ?? medium_id,
    medium_sound_feeling: medDna?.sound_feeling ?? null,
    medium_tags: mediumTags,
    prior_zusagen: priorZusagenText,
  })

  // ── 4. vLLM-Call + parsen + done ─────────────────────────────────────────
  const rawContent = await callLLM({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    temperature: 0.2,
    max_tokens: 1200,
    timeoutMs: 300_000,
  })
  const result = parseAmountAntwort(rawContent)
  await setAmountJob(jobId, { status: 'done', result })

  // ── 5. Persistieren (best effort) ────────────────────────────────────────
  try {
    await persistSonderBetrag(ziel, zielId, medium_id, result)
  } catch (e) {
    console.warn('[calculate-amount] Sonder-Persistieren fehlgeschlagen:', e)
  }
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
    const job = await getAmountJob(job_id)
    if (!job) {
      res.status(404).json({ error: 'Job nicht gefunden' })
      return
    }
    const payload: JobStatusResponse = {
      id: job.id,
      key: job.key,
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

  const { stiftung_id, medium_id, ziel } = req.body ?? {}

  if (!stiftung_id || !medium_id) {
    res.status(400).json({ error: 'stiftung_id und medium_id erforderlich' })
    return
  }
  if (ziel && !istSonderZiel(ziel)) {
    res.status(400).json({ error: 'ziel muss kirchen, foerderer, lotteriefonds oder sponsoren sein' })
    return
  }

  // Sonder-Pfad: Job-Key ist der sonder_ref (<coll>:<id>) — kollisionsfrei
  // mit echten Stiftungs-IDs, Doppel-Start-Schutz greift unverändert.
  const stiftungIdStr = ziel ? sonderRef(ziel, String(stiftung_id)) : String(stiftung_id)
  const mediumIdStr = String(medium_id)

  // Doppel-Start verhindern: wenn bereits ein Job für dieses Paar läuft,
  // denselben zurückgeben.
  const existing = await findRunningByKey(stiftungIdStr, mediumIdStr)
  if (existing) {
    res.status(200).json({ job_id: existing.id, status: 'running' })
    return
  }

  // Neuen Job anlegen und Berechnung fire-and-forget starten.
  const job = await createAmountJob(stiftungIdStr, mediumIdStr)

  // Fire-and-forget: kein await — Response kehrt SOFORT zurück.
  const lauf = ziel
    ? runCalcSonder(job.id, ziel as SonderZiel, String(stiftung_id), mediumIdStr)
    : runCalc(job.id, stiftungIdStr, mediumIdStr)
  lauf.catch((e: unknown) => {
    void setAmountJob(job.id, {
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    }).catch(() => {})
  })

  res.status(202).json({ job_id: job.id, status: 'running' })
}
