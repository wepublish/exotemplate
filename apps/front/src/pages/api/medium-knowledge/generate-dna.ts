/**
 * /api/medium-knowledge/generate-dna — EIN-KNOPF-DNA-Flow.
 *
 * Verkettet die gesamte DNA-Pipeline in einem asynchronen Hintergrundlauf:
 *   1. SAMMELN    — We.Publish (Artikel, Newsletter falls die Instanz sie führt)
 *                   und Web-Crawl. Drive/datensuppe ist seit 29.07.2026 KEINE
 *                   Quelle mehr (Entscheid Jolanda), die Medien liefern selbst.
 *                   → alles in medium_knowledge. Warnt bei fehlendem We.Publish-Schlüssel.
 *   2. VERDICHTEN — Map-Reduce über den Korpus → faas_medien.arbeits_dna (PDF-Profil).
 *   3. MESSEN     — v3-Mess-Kern → neue medium_dna-Version.
 *   4. AKTIVIEREN — sofort aktiv schalten (alte Version bleibt als inaktive Historie).
 *
 * Ersetzt die getrennten Schritte Arbeits-DNA / finale v3-DNA durch EINEN Knopf.
 * Wiederholbar: bei neuen Quellen denselben Knopf erneut drücken (Dedup verhindert
 * doppelte Knowledge-Einträge, neue Messung legt eine neue aktive Version an).
 *
 * ASYNC (Cloudflare-100s-Limit): POST → 202 { job_id }, Client pollt via GET.
 *
 * POST { medium_id: string }   (medium_id = slug)
 * GET  ?job_id=<id>
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import {
  ladeDedup,
  ingestWepublish,
  ingestCrawl,
} from '@/lib/medium-quellen'
import {
  KNOWLEDGE_QUERY,
  erzeugeArbeitsDnaAusKorpus,
  messeFinaleDna,
  aktiviereDna,
  triggerErstMatch,
  type KnowledgeItem,
} from '@/lib/dna-pipeline'
import { schreibeMediumEvent } from '@/lib/medium-events'
import {
  createGenerateJob,
  getGenerateJob,
  setGenerateJob,
  findRunningGenerateByMedium,
  type GenerateDnaJob,
  type QuellenStatistik,
} from '@/lib/generate-dna-jobs'

// ─── Typen ────────────────────────────────────────────────────────────────────

type JobStatusResponse = Pick<GenerateDnaJob, 'id' | 'medium_id' | 'status' | 'phase' | 'startedAt' | 'result' | 'error'>
interface JobStartResponse { job_id: string; status: 'running' }
interface ErrorResponse { error: string }

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
  variables: Record<string, unknown>
): Promise<DirectusResponse> {
  const res = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Directus HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json() as Promise<DirectusResponse>
}

const FAAS_MEDIEN_QUERY = `
  query FaasMediumFuerGenerate($slug: String!) {
    faas_medien(filter: { slug: { _eq: $slug } }, limit: 1) {
      id
      name
      website
      wepublish_api_url
    }
  }
`

// ─── Kern-Lauf (fire-and-forget) ────────────────────────────────────────────────

async function runGenerate(jobId: string, medium_id: string): Promise<void> {
  const base = process.env.DIRECTUS_URL || 'http://localhost:8055'
  const token = process.env.DIRECTUS_TOKEN || ''
  const warnungen: string[] = []

  // ── faas_medien laden ──────────────────────────────────────────────────────
  const medienR = await directusFetch(base, token, FAAS_MEDIEN_QUERY, { slug: medium_id })
  if (medienR.errors?.length) throw new Error('Directus (faas_medien): ' + medienR.errors[0]?.message)
  const medium = (medienR.data?.faas_medien as {
    id: number
    name: string
    website: string | null
    wepublish_api_url: string | null
  }[] | undefined)?.[0]
  if (!medium) throw new Error(`Kein faas_medien-Eintrag für slug "${medium_id}"`)

  const websiteUrl =
    typeof medium.website === 'string' && medium.website.startsWith('http') ? medium.website : null

  // ── 1. SAMMELN ───────────────────────────────────────────────────────────────
  await setGenerateJob(jobId, { phase: 'sammeln' })
  const dedup = await ladeDedup(base, token, medium_id)

  const wp = await ingestWepublish(base, token, medium_id, medium.wepublish_api_url, medium.website, dedup)
  if (!wp.hatApi) {
    warnungen.push('Kein We.Publish-API-Schlüssel hinterlegt — Artikel und Newsletter wurden nicht geladen.')
  } else if (wp.fehler) {
    warnungen.push(`We.Publish-Abruf teilweise fehlgeschlagen: ${wp.fehler}`)
  } else if (wp.artikelNeu === 0 && wp.newsletterNeu === 0 && wp.uebersprungen === 0) {
    // Befund 29.07.2026: bei 4 von 6 Medien mit hinterlegtem Schlüssel lieferte
    // die URL zwar eine Antwort, aber null Artikel (falscher Endpoint oder
    // leere Instanz) — bisher OHNE jede Warnung. `uebersprungen === 0`
    // unterscheidet die echte Null-Antwort vom Normalfall «alles schon
    // importiert» (dann zählt der Dedup-Skip hoch und alles ist gut).
    warnungen.push('We.Publish-API erreichbar, aber keine Artikel oder Newsletter abrufbar — stimmt die hinterlegte API-URL?')
  }

  // Drive/datensuppe ist KEINE Quelle mehr (Entscheid Jolanda 29.07.2026: «die
  // drive-verbindung muss weg»). Der Mount existiert nicht mehr, der Lauf warnte
  // darum bei jedem Medium «Kein datensuppe-Ordner gefunden. Drive-Mount aktiv?»
  // — eine Warnung, die niemand beheben konnte und die die echten Hinweise
  // (fehlende We.Publish-Artikel) untergehen liess. Die Medien liefern ihre
  // Unterlagen selbst über das Portal, das ist der Weg.

  const cr = await ingestCrawl(base, token, medium_id, medium.website, dedup)
  if (websiteUrl && !cr.gecrawlt && cr.fehler) {
    warnungen.push(`Web-Crawl fehlgeschlagen: ${cr.fehler}`)
  }

  // ── Korpus neu laden (für die Verdichtung) ──────────────────────────────────
  const knowR = await directusFetch(base, token, KNOWLEDGE_QUERY, { medium: medium_id })
  if (knowR.errors?.length) throw new Error('Directus (medium_knowledge): ' + knowR.errors[0]?.message)
  const knowledge = (knowR.data?.medium_knowledge ?? []) as KnowledgeItem[]
  if (knowledge.length === 0) {
    warnungen.push('Korpus ist leer — keine Artikel, Unterlagen oder Crawl-Inhalte gefunden.')
  }

  // ── 2. VERDICHTEN (Map-Reduce → Arbeits-DNA/PDF-Profil) ─────────────────────
  await setGenerateJob(jobId, { phase: 'verdichten' })
  const arbeit = await erzeugeArbeitsDnaAusKorpus({
    base,
    token,
    mediumNumericId: medium.id,
    mediumName: medium.name,
    website: medium.website,
    knowledge,
    onProgress: phase => void setGenerateJob(jobId, { phase }),
  })

  // ── 3. MESSEN (v3-DNA, nicht-aktiv) ─────────────────────────────────────────
  await setGenerateJob(jobId, { phase: 'messen' })
  const gemessen = await messeFinaleDna({
    base,
    token,
    medium_id,
    mediumName: medium.name,
    websiteUrl,
    arbeitsDna: arbeit.zuSpeichern as unknown as Record<string, unknown>,
    // Crawl-Markdown durchreichen (kein Doppel-Crawl). '' = kein Web-Bonus, falls Crawl fehlte.
    webKorpus: cr.markdown ?? '',
  })
  if (gemessen.warnung) warnungen.push(gemessen.warnung)

  // ── 4. AKTIVIEREN (sofort scharf) ───────────────────────────────────────────
  await setGenerateJob(jobId, { phase: 'aktivieren' })
  let aktivGeschaltet = false
  try {
    await aktiviereDna(base, token, gemessen.id)
    aktivGeschaltet = true
    // Roadmap-Ereignis (fire-and-forget): DNA erstellt und scharf geschaltet.
    void schreibeMediumEvent({
      medium_id,
      typ: 'dna_aktiv',
      titel: `Fundraising-DNA erstellt und aktiv (Version ${gemessen.version})`,
      detail: `Schärfe ${gemessen.schaerfe_prozent}%`,
    })
    // Erst-Match sofort anstossen, statt auf den 6h-Cron zu warten (best effort)
    await triggerErstMatch(medium_id)
  } catch (e: unknown) {
    warnungen.push(`Aktivierung fehlgeschlagen — Version ${gemessen.version} liegt als inaktive Version bereit: ${e instanceof Error ? e.message : String(e)}`)
  }

  const quellen: QuellenStatistik = {
    wepublish_api_vorhanden: wp.hatApi,
    wepublish_artikel_neu: wp.artikelNeu,
    wepublish_newsletter_neu: wp.newsletterNeu,
    web_crawl_ok: cr.gecrawlt,
    korpus_eintraege_gesamt: knowledge.length,
  }

  await setGenerateJob(jobId, {
    status: 'done',
    phase: 'fertig',
    result: {
      id: gemessen.id,
      version: gemessen.version,
      schaerfe_prozent: gemessen.schaerfe_prozent,
      tag_count: gemessen.tag_count,
      sound_feeling: gemessen.sound_feeling,
      tags: gemessen.tags,
      hatte_crawl: gemessen.hatte_crawl,
      aktiv_geschaltet: aktivGeschaltet,
      quellen,
      profil: {
        dna_summary: arbeit.zuSpeichern.dna_summary ?? '',
        core_themes: arbeit.zuSpeichern.core_themes ?? [],
        editorial_stance: arbeit.zuSpeichern.editorial_stance ?? [],
        societal_impact: arbeit.zuSpeichern.societal_impact ?? [],
        target_groups: arbeit.zuSpeichern.target_groups ?? [],
        geographic_focus: arbeit.zuSpeichern.geographic_focus ?? '',
        funding_keywords: arbeit.zuSpeichern.funding_keywords ?? [],
        grant_strengths: arbeit.zuSpeichern.grant_strengths ?? [],
        matching_foundation_themes: arbeit.zuSpeichern.matching_foundation_themes ?? [],
      },
      warnungen,
    },
  })
}

// ─── Starter (geteilt mit /api/portal/dna-erzeugen, Task 7) ────────────────────

export type StarteGenerateDnaJobErgebnis = { jobId: string; running: boolean } | { fehler: string }

/**
 * Startet den Ein-Knopf-DNA-Lauf für ein Medium, oder liefert den bereits
 * laufenden Job zurück (Dedup über findRunningGenerateByMedium. Mehrfaches
 * Drücken des Knopfs, oder ein erneuter Seitenaufruf, legt KEINEN zweiten
 * Lauf an). `medium` ist der faas_medien-Slug.
 *
 * Reine Verkettungs-Logik, kein res.json() hier: der bestehende Route-Handler
 * UND /api/portal/dna-erzeugen (Task 7, DNA-Selbstservice) rufen dieselbe
 * Funktion und übersetzen `running` in ihren jeweiligen HTTP-Statuscode
 * (200 bei bereits laufend, 202 bei frisch gestartet).
 */
export async function starteGenerateDnaJob(medium: string): Promise<StarteGenerateDnaJobErgebnis> {
  if (!medium || typeof medium !== 'string') {
    return { fehler: 'medium_id (string) erforderlich' }
  }

  const existing = await findRunningGenerateByMedium(medium)
  if (existing) {
    return { jobId: existing.id, running: true }
  }

  const job = await createGenerateJob(medium)
  runGenerate(job.id, medium).catch((e: unknown) => {
    void setGenerateJob(job.id, { status: 'error', error: e instanceof Error ? e.message : String(e) }).catch(() => {})
  })

  return { jobId: job.id, running: false }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<JobStartResponse | JobStatusResponse | ErrorResponse>
) {
  if (req.method === 'GET') {
    const { job_id } = req.query
    if (!job_id || typeof job_id !== 'string') {
      res.status(400).json({ error: 'job_id (string) als Query-Parameter erforderlich' })
      return
    }
    const job = await getGenerateJob(job_id)
    if (!job) {
      res.status(404).json({ error: 'Job nicht gefunden' })
      return
    }
    res.status(200).json({
      id: job.id,
      medium_id: job.medium_id,
      status: job.status,
      phase: job.phase,
      startedAt: job.startedAt,
      ...(job.result !== undefined ? { result: job.result } : {}),
      ...(job.error !== undefined ? { error: job.error } : {}),
    })
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Nur POST und GET erlaubt' })
    return
  }

  const { medium_id } = req.body ?? {}
  if (!medium_id || typeof medium_id !== 'string') {
    res.status(400).json({ error: 'medium_id (string) erforderlich' })
    return
  }

  const gestartet = await starteGenerateDnaJob(medium_id)
  if ('fehler' in gestartet) {
    res.status(400).json({ error: gestartet.fehler })
    return
  }

  res.status(gestartet.running ? 200 : 202).json({ job_id: gestartet.jobId, status: 'running' })
}
