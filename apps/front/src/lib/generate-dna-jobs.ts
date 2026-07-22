/**
 * generate-dna-jobs.ts — Job-Verwaltung für den Ein-Knopf-DNA-Flow.
 * Persistiert in Directus (faas_jobs, typ "generate_dna") — überlebt Deploys.
 * Der Lauf ist lang (~10–20 Min): sammeln → verdichten → messen → aktivieren.
 */
import {
  createPersistentJob,
  getPersistentJob,
  patchPersistentJob,
  findRunningPersistentJob,
  type PersistentJob,
} from './faas-jobs-store'

export interface QuellenStatistik {
  /** We.Publish: ob ein API-Schlüssel hinterlegt war. false → sichtbare Warnung. */
  wepublish_api_vorhanden: boolean
  wepublish_artikel_neu: number
  wepublish_newsletter_neu: number
  datensuppe_ordner_gefunden: boolean
  datensuppe_ordner_name: string | null
  datensuppe_dateien_neu: number
  web_crawl_ok: boolean
  korpus_eintraege_gesamt: number
}

/** Menschenlesbares Profil (aus der Verdichtung) — für PDF + Besprechung. */
export interface DnaProfil {
  dna_summary: string
  core_themes: string[]
  editorial_stance: string[]
  societal_impact: string[]
  target_groups: string[]
  geographic_focus: string
  funding_keywords: string[]
  grant_strengths: string[]
  matching_foundation_themes: string[]
}

export interface GenerateDnaResult {
  /** Directus-ID der neuen, sofort aktiv geschalteten medium_dna-Version. */
  id: number
  version: number
  schaerfe_prozent: number
  tag_count: number
  sound_feeling: string
  tags: { tag_slug: string; gewicht: number; begruendung: string }[]
  hatte_crawl: boolean
  aktiv_geschaltet: boolean
  /**
   * Optional: fehlt, wenn das Ergebnis nicht aus einem frischen Ein-Knopf-Lauf
   * stammt, sondern nachträglich aus der persistierten aktiven medium_dna
   * rekonstruiert wurde (Portal-DNA-Seite, Task 7. Die «neu»-Zähler eines
   * Erzeugungslaufs lassen sich im Nachhinein nicht ehrlich herleiten).
   * DnaPdf zeigt den Quellen-Abschnitt dann einfach nicht.
   */
  quellen?: QuellenStatistik
  /** Menschenlesbares Profil fürs PDF (aus der Verdichtungsphase). */
  profil: DnaProfil
  /** Sichtbare Hinweise (z.B. «kein We.Publish-Schlüssel», «<10 Tags»). */
  warnungen: string[]
}

export interface GenerateDnaJob extends PersistentJob<GenerateDnaResult> {
  medium_id: string
  phase: string
}

const MAX_AGE_MS = 180 * 60_000

function mitMedium(j: PersistentJob<GenerateDnaResult>): GenerateDnaJob {
  return { ...j, medium_id: j.key, phase: j.phase ?? 'sammeln' }
}

export async function createGenerateJob(medium_id: string): Promise<GenerateDnaJob> {
  return mitMedium(await createPersistentJob<GenerateDnaResult>('generate_dna', medium_id, 'sammeln'))
}

export async function getGenerateJob(id: string): Promise<GenerateDnaJob | undefined> {
  const j = await getPersistentJob<GenerateDnaResult>('generate_dna', id)
  return j ? mitMedium(j) : undefined
}

export async function setGenerateJob(
  id: string,
  patch: { status?: 'running' | 'done' | 'error'; phase?: string; result?: GenerateDnaResult; error?: string }
): Promise<void> {
  return patchPersistentJob(id, patch)
}

export async function findRunningGenerateByMedium(medium_id: string): Promise<GenerateDnaJob | undefined> {
  const j = await findRunningPersistentJob<GenerateDnaResult>('generate_dna', medium_id, MAX_AGE_MS)
  return j ? mitMedium(j) : undefined
}
