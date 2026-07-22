/**
 * /api/measure-medium-dna — Asynchrone Medien-DNA-Messung (v3-Mess-Kern).
 *
 * ASYNC-DESIGN: Ein qwen-Call dauert ~146s, Cloudflare bricht synchrone
 * Requests nach ~100s ab (524). Daher fire-and-forget: der POST kehrt
 * sofort mit job_id zurück; die Messung läuft im Hintergrund; der Client
 * pollt via GET.
 *
 * Das Messergebnis wird IMMER als nicht-aktive medium_dna-Version in
 * Directus geschrieben — überlebt einen Container-Neustart.
 *
 * POST { medium_id: string }
 *   → 202 { job_id: string; status: 'running' }
 *   → 200 { job_id: string; status: 'running' }  (wenn bereits ein Job läuft)
 *
 * GET ?job_id=<id>
 *   → 200 { id, status, startedAt, result?, error? }
 *   → 404 { error: 'Job nicht gefunden' }
 */

import type { NextApiRequest, NextApiResponse } from 'next'
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
import { callLLM } from '@/lib/llm'
import {
  createJob,
  getJob,
  setJob,
  findRunningByMedium,
  type DnaJob,
} from '@/lib/dna-jobs'

// ─── Typen ────────────────────────────────────────────────────────────────────

type JobStatusResponse = Pick<DnaJob, 'id' | 'medium_id' | 'status' | 'startedAt' | 'result' | 'error'>

interface JobStartResponse {
  job_id: string
  status: 'running'
}

interface ErrorResponse {
  error: string
}

// ─── Directus-Queries ─────────────────────────────────────────────────────────

/**
 * Lädt Name, Website und Arbeits-DNA aus faas_medien (slug = medium_id).
 * arbeits_dna ist das Stufe-1-Profil (10 Dimensionen + dna_summary).
 */
const FAAS_MEDIEN_QUERY = `
  query FaasMedienFuerMessung($slug: String!) {
    faas_medien(
      filter: { slug: { _eq: $slug } }
      limit: 1
    ) {
      id
      name
      website
      arbeits_dna
    }
  }
`

const HOECHSTE_VERSION_QUERY = `
  query HoechsteVersion($mediumId: String!) {
    medium_dna(
      filter: { medium_id: { _eq: $mediumId } }
      sort: ["-version"]
      limit: 1
    ) {
      version
    }
  }
`

/**
 * Lädt die bestehende aktive medium_dna eines Mediums — Fallback-Korpus für die
 * profil-basierte v3-Migration etablierter Medien (wepublish/cueltuer/…), die
 * (noch) keine Arbeits-DNA haben. sound_feeling + tags + sektionen liefern den
 * inhaltlichen Korpus für den v3-Mess-Kern.
 */
const AKTIVE_MEDIUM_DNA_QUERY = `
  query AktiveMediumDna($mediumId: String!) {
    medium_dna(
      filter: { medium_id: { _eq: $mediumId }, is_active: { _eq: true } }
      limit: 1
    ) {
      sound_feeling
      tags
      sektionen
    }
  }
`

const CREATE_MEDIUM_DNA_MUTATION = `
  mutation CreateMediumDna($data: create_medium_dna_input!) {
    create_medium_dna_item(data: $data) {
      id
      version
      schaerfe_prozent
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

// ─── Arbeits-DNA als Text aufbereiten ─────────────────────────────────────────

/**
 * Serialisiert die Arbeits-DNA (Stufe-1-Profil, 10 Dimensionen) als lesbaren
 * Text für den v3-Mess-Kern. dna_summary kommt zuerst, dann alle Dimensionen
 * als Aufzählung. Leere Arrays / fehlende Felder werden übersprungen.
 */
export function baueArbeitsDnaText(dna: Record<string, unknown>): string {
  const zeilen: string[] = []

  if (typeof dna.dna_summary === 'string' && dna.dna_summary.trim()) {
    zeilen.push(`Zusammenfassung:\n${dna.dna_summary.trim()}`)
  }

  const dimensionen: [string, string][] = [
    ['Kernthemen', 'core_themes'],
    ['Redaktionelle Haltung', 'editorial_stance'],
    ['Gesellschaftliche Wirkung', 'societal_impact'],
    ['Zielgruppen', 'target_groups'],
    ['Geografischer Fokus', 'geographic_focus'],
    ['Finanzierungsmodell', 'funding_model_hints'],
    ['Matching-Keywords', 'funding_keywords'],
    ['Stärken für Anträge', 'grant_strengths'],
    ['Passende Stiftungsthemen', 'matching_foundation_themes'],
  ]

  for (const [label, key] of dimensionen) {
    const val = dna[key]
    if (typeof val === 'string' && val.trim()) {
      zeilen.push(`${label}: ${val.trim()}`)
    } else if (Array.isArray(val) && val.length > 0) {
      zeilen.push(`${label}: ${(val as string[]).join(', ')}`)
    }
  }

  return zeilen.join('\n\n')
}

/**
 * Serialisiert eine BESTEHENDE medium_dna (altes/Opus-Profil) als Korpus für die
 * v3-Re-Messung: sound_feeling + Themen-Tags (Slug + Begründung) + sektionen-Inhalt.
 * Robust gegen beide Schemata (flache `tags` ODER `sektionen`-Gruppen).
 */
export function baueMediumDnaText(dna: Record<string, unknown>): string {
  const zeilen: string[] = []

  if (typeof dna.sound_feeling === 'string' && dna.sound_feeling.trim()) {
    zeilen.push(`Selbstverstaendnis / Sound:\n${dna.sound_feeling.trim()}`)
  }

  const tags = dna.tags
  if (Array.isArray(tags) && tags.length > 0) {
    const tz: string[] = []
    for (const t of tags as Record<string, unknown>[]) {
      if (!t || typeof t !== 'object') continue
      const slug = String(t.tag_slug ?? t.tag ?? '').trim()
      const beg = String(t.begruendung ?? '').trim()
      if (slug) tz.push(beg ? `${slug}: ${beg}` : slug)
    }
    if (tz.length) zeilen.push(`Themen-Tags:\n${tz.join('\n')}`)
  }

  const sektionen = dna.sektionen
  if (sektionen && typeof sektionen === 'object' && !Array.isArray(sektionen)) {
    for (const [bereich, inhalt] of Object.entries(sektionen as Record<string, unknown>)) {
      if (Array.isArray(inhalt)) {
        const slugs = (inhalt as unknown[])
          .map(x => (x && typeof x === 'object' ? String((x as Record<string, unknown>).tag_slug ?? (x as Record<string, unknown>).tag ?? '') : String(x)))
          .filter(Boolean)
        if (slugs.length) zeilen.push(`${bereich}: ${slugs.join(', ')}`)
      } else if (typeof inhalt === 'string' && inhalt.trim()) {
        zeilen.push(`${bereich}: ${inhalt.trim()}`)
      }
    }
  }

  return zeilen.join('\n\n')
}

// ─── Kern-Messung (fire-and-forget) ───────────────────────────────────────────

/**
 * Führt die vollständige DNA-Messung durch und schreibt das Ergebnis
 * in Directus (is_active = false) sowie in den Job-Store.
 *
 * Diese Funktion wird OHNE await gestartet — Fehler werden im Job
 * festgehalten, nicht in der HTTP-Response.
 */
async function runMeasurement(jobId: string, medium_id: string): Promise<void> {
  const directusBase = process.env.DIRECTUS_URL || 'http://localhost:8055'
  const directusToken = process.env.DIRECTUS_TOKEN || ''

  // ── 1. faas_medien laden (Name, Website, Arbeits-DNA) ──────────────────────
  interface FaasMedienShape {
    id: number
    name: string
    website: string | null
    arbeits_dna: Record<string, unknown> | null
  }

  const medienR = await directusFetch(directusBase, directusToken, FAAS_MEDIEN_QUERY, { slug: medium_id })
  if (medienR.errors?.length) {
    throw new Error('Directus-Fehler (faas_medien): ' + medienR.errors[0]?.message)
  }
  const medienArr: FaasMedienShape[] = medienR.data?.faas_medien ?? []
  const faasMedium = medienArr[0] ?? null

  if (!faasMedium) {
    throw new Error(`Kein Medium mit slug "${medium_id}" in faas_medien gefunden`)
  }

  // Arbeits-DNA ist der Standard-Korpus (Stufe 1). Fehlt sie (etablierte Medien),
  // greift weiter unten der Fallback auf die bestehende medium_dna (v3-Migration).
  const arbeitsDna = faasMedium.arbeits_dna

  const mediumName = faasMedium.name
  const websiteUrl =
    typeof faasMedium.website === 'string' && faasMedium.website.startsWith('http')
      ? faasMedium.website
      : null

  // ── 2. Höchste Version ermitteln ────────────────────────────────────────────
  let neueVersion = 1
  try {
    const r = await directusFetch(directusBase, directusToken, HOECHSTE_VERSION_QUERY, { mediumId: medium_id })
    const versionArr = (r.data?.medium_dna as { version: number | null }[]) ?? []
    const hoechste = versionArr[0]?.version ?? 0
    neueVersion = hoechste + 1
  } catch {
    // Fallback: Version 1
    neueVersion = 1
  }

  // ── 3. Korpus aufbereiten — zwei Quellen ───────────────────────────────────
  // (a) Arbeits-DNA (Stufe 1, z.B. bajour) — Standardweg, oder
  // (b) Fallback: die bestehende aktive medium_dna (profil-basierte v3-Migration
  //     etablierter Medien wepublish/cueltuer/… ohne Arbeits-DNA).
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
    const altR = await directusFetch(directusBase, directusToken, AKTIVE_MEDIUM_DNA_QUERY, { mediumId: medium_id })
    const altDna = (altR.data?.medium_dna as Record<string, unknown>[] | undefined)?.[0] ?? null
    if (!altDna) {
      throw new Error(
        `Kein Korpus für "${medium_id}": weder Arbeits-DNA in faas_medien noch eine aktive medium_dna.`
      )
    }
    korpusText = baueMediumDnaText(altDna)
    if (!korpusText.trim()) {
      throw new Error(`Bestehende medium_dna für "${medium_id}" ist inhaltsleer — kein Korpus für die v3-Messung.`)
    }
    profilSoundFeeling = typeof altDna.sound_feeling === 'string' ? altDna.sound_feeling : null
    profilTopTags = ''
    korpusQuelle = 'medium_dna_profil'
  }

  // ── 4. Optionaler Web-Crawl (Zusatzkontext, Arbeits-DNA hat Priorität) ─────
  let webKorpus: string | null = null

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
        const crawlJson = await crawlRes.json() as any
        const md: unknown = crawlJson?.data?.markdown ?? crawlJson?.markdown
        if (typeof md === 'string' && md.length > 0) {
          webKorpus = md
        }
      }
    } catch {
      // Crawl-Fehler → kein Abbruch, Arbeits-DNA reicht als Korpus
    }
  }

  // ── 5. Bestehendes Profil (sound_feeling + Top-Tags-Hinweis) ───────────────
  const bestehendesProfil =
    profilSoundFeeling || profilTopTags
      ? { soundFeeling: profilSoundFeeling ?? null, topTags: profilTopTags }
      : null

  // ── 6. User-Prompt bauen — Arbeits-DNA-Text als Primärkorpus ───────────────
  // buildUserPrompt erwartet webKorpus als Hauptinhalt; wir übergeben den
  // Arbeits-DNA-Text dort + optionalen echten Web-Crawl als Zusatz.
  const kombinierterKorpusRaw = webKorpus
    ? `MEDIEN-PROFIL:\n${korpusText}\n\n---\nWEBSEITE (gecrawlt, Zusatzkontext):\n${webKorpus.slice(0, 5000)}`
    : korpusText
  // vLLM-Kontextlimit 8192: Vokabular-Liste + System-Prompt belegen bereits ~4000
  // Tokens fix. Korpus deckeln, damit input_tokens + max_tokens (2400) sicher unter
  // 8192 bleiben (sonst HTTP 400 «input+output > context»).
  const kombinierterKorpus = kombinierterKorpusRaw.slice(0, 6500)

  const userPrompt = buildUserPrompt({
    mediumName,
    websiteUrl,
    webKorpus: kombinierterKorpus,
    bestehendesProfil,
  })

  // ── 6. vLLM-Call (grosszügiger Timeout — Client wartet nicht) ──────────────
  // callLLM beinhaltet Retry-Logik (3×, 5s Backoff, nur bei Verbindungsabbruch).
  // Ellenlänge: temp=0. max_tokens=2400 — qwen3.6 stoppt bei der DNA von selbst bei
  // ~1544–2000 Tokens, 2400 schneidet also nichts ab; der niedrigere Wert nimmt vLLM
  // nur die Vorab-Reservierung (8192-Kontext), die Ausgabe bleibt identisch zum Pool-Lauf.
  const rawContent = await callLLM({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    temperature: 0,
    max_tokens: 2400,
    // 20 Min: der lange Mess-Call (~2000 Output-Tokens) decodet unter dem Pool-Lauf
    // mit nur ~4 tok/s/Sequenz (bandbreitenlimitiert, 8 parallele Pool-Reqs) → ~10-12 Min.
    timeoutMs: 1_200_000,
    // Streaming: ohne das killt undici den langen Call bei seinem 300s-headersTimeout
    // («fetch failed»). Mit Streaming kommen die Header sofort; AbortSignal bleibt das Limit.
    stream: true,
  })

  // ── 7. Antwort parsen + Vokabular-Filter ────────────────────────────────────
  const rohAntwort = parseOllamaAntwort(rawContent)
  const { tags, exclusion_tags, gefilterteTags } = filterVokabular(rohAntwort)

  let warnung: string | undefined
  if (tags.length < 10) {
    warnung = `Nur ${tags.length} valide Tags nach Vokabular-Filter (${gefilterteTags} gefiltert). Ziel: 10–15.`
  }

  // ── 8. Schärfe berechnen ────────────────────────────────────────────────────
  // kombinierterKorpus enthält Arbeits-DNA + optionalen Web-Crawl.
  // buildSchaerfeInput wertet webKorpus auf len > 400 aus — das trifft zu.
  const schaerfeInput = buildSchaerfeInput({
    webKorpus: kombinierterKorpus,
    bestehendesProfil,
    tags,
    exclusion_tags,
  })
  const schaerfe = calcSchaerfe(schaerfeInput)

  // ── 9. Neue DNA-Version in Directus anlegen (is_active = FALSE) ─────────────
  const versionId = `v${neueVersion}-app-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const datenbasis = webKorpus ? `${korpusQuelle}+web+app` : `${korpusQuelle}+app`

  const dnaData = {
    medium_id,
    medium_name: mediumName,
    version: neueVersion,
    version_id: versionId,
    is_active: false,
    // medium_dna-Pflichtfelder (nicht-nullable, kein Default):
    veredelt_at: new Date().toISOString(),
    veredelt_by: 'matching-app-finale',
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
      gemessen_durch: 'matching-app-finale',
    },
  }

  const createR = await directusFetch(directusBase, directusToken, CREATE_MEDIUM_DNA_MUTATION, { data: dnaData })
  if (createR.errors?.length) {
    throw new Error('Directus-Mutation fehlgeschlagen: ' + createR.errors[0]?.message)
  }
  const created = createR.data?.create_medium_dna_item as { id: number; version: number; schaerfe_prozent: number }
  const neueId: number = created.id

  // ── 10. Job als done markieren ──────────────────────────────────────────────
  await setJob(jobId, {
    status: 'done',
    result: {
      id: neueId,
      version: neueVersion,
      schaerfe_prozent: schaerfe,
      tag_count: tags.length,
      sound_feeling: String(rohAntwort.sound_feeling ?? '').trim(),
      tags: (tags as { tag_slug: string; gewicht: number; begruendung: string }[]),
      hatte_crawl: Boolean(webKorpus),
      ...(warnung ? { warnung } : {}),
    },
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
    const job = await getJob(job_id)
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
  // denselben zurückgeben (kein zweiter Start).
  const existing = await findRunningByMedium(medium_id)
  if (existing) {
    res.status(200).json({ job_id: existing.id, status: 'running' })
    return
  }

  // Neuen Job anlegen und Messung fire-and-forget starten.
  const job = await createJob(medium_id)

  // Fire-and-forget: kein await — Response kehrt SOFORT zurück.
  runMeasurement(job.id, medium_id).catch((e: unknown) => {
    void setJob(job.id, {
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    }).catch(() => {})
  })

  res.status(202).json({ job_id: job.id, status: 'running' })
}
