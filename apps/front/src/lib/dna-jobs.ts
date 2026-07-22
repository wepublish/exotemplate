/**
 * dna-jobs.ts — Job-Verwaltung für asynchrone DNA-Messungen.
 * Persistiert in Directus (faas_jobs, typ "dna_messung") — überlebt Deploys.
 */
import {
  createPersistentJob,
  getPersistentJob,
  patchPersistentJob,
  findRunningPersistentJob,
  type PersistentJob,
} from './faas-jobs-store'

export interface DnaJobResult {
  id: number
  version: number
  schaerfe_prozent: number
  tag_count: number
  sound_feeling: string
  tags: { tag_slug: string; gewicht: number; begruendung: string }[]
  hatte_crawl: boolean
  warnung?: string
}

export interface DnaJob extends PersistentJob<DnaJobResult> {
  medium_id: string
}

const MAX_AGE_MS = 60 * 60_000

function mitMedium(j: PersistentJob<DnaJobResult>): DnaJob {
  return { ...j, medium_id: j.key }
}

export async function createJob(medium_id: string): Promise<DnaJob> {
  return mitMedium(await createPersistentJob<DnaJobResult>('dna_messung', medium_id))
}

export async function getJob(id: string): Promise<DnaJob | undefined> {
  const j = await getPersistentJob<DnaJobResult>('dna_messung', id)
  return j ? mitMedium(j) : undefined
}

export async function setJob(
  id: string,
  patch: { status?: 'running' | 'done' | 'error'; result?: DnaJobResult; error?: string }
): Promise<void> {
  return patchPersistentJob(id, patch)
}

export async function findRunningByMedium(medium_id: string): Promise<DnaJob | undefined> {
  const j = await findRunningPersistentJob<DnaJobResult>('dna_messung', medium_id, MAX_AGE_MS)
  return j ? mitMedium(j) : undefined
}
