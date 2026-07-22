/**
 * working-dna-jobs.ts — Job-Verwaltung für asynchrone Arbeits-DNA-Generierung.
 * Persistiert in Directus (faas_jobs, typ "working_dna") — überlebt Deploys.
 * Job-Key: medium_id — verhindert Doppel-Start für dasselbe Medium.
 */
import {
  createPersistentJob,
  getPersistentJob,
  patchPersistentJob,
  findRunningPersistentJob,
  type PersistentJob,
} from './faas-jobs-store'

export interface ArbeitsDnaResult {
  score: number
  summary_len: number
  dimensionen_count: number
  batches?: number
  artikel_gesamt?: number
}

export interface WorkingDnaJob extends PersistentJob<ArbeitsDnaResult> {
  /** medium_id (Slug) des Mediums. */
  medium_id: string
}

const MAX_AGE_MS = 60 * 60_000

function mitMedium(j: PersistentJob<ArbeitsDnaResult>): WorkingDnaJob {
  return { ...j, medium_id: j.key }
}

/** Erstellt einen neuen Job für ein Medium. */
export async function createWorkingDnaJob(medium_id: string): Promise<WorkingDnaJob> {
  return mitMedium(await createPersistentJob<ArbeitsDnaResult>('working_dna', medium_id))
}

/** Gibt den Job mit der übergebenen ID zurück, oder undefined. */
export async function getWorkingDnaJob(id: string): Promise<WorkingDnaJob | undefined> {
  const j = await getPersistentJob<ArbeitsDnaResult>('working_dna', id)
  return j ? mitMedium(j) : undefined
}

/** Schreibt einen partiellen Update auf einen bestehenden Job. */
export async function setWorkingDnaJob(
  id: string,
  patch: { status?: 'running' | 'done' | 'error'; result?: ArbeitsDnaResult; error?: string }
): Promise<void> {
  return patchPersistentJob(id, patch)
}

/**
 * Gibt den laufenden Job für ein Medium zurück, falls vorhanden.
 * Verhindert Doppel-Starts für dasselbe Medium.
 */
export async function findRunningWorkingDnaByMedium(medium_id: string): Promise<WorkingDnaJob | undefined> {
  const j = await findRunningPersistentJob<ArbeitsDnaResult>('working_dna', medium_id, MAX_AGE_MS)
  return j ? mitMedium(j) : undefined
}
