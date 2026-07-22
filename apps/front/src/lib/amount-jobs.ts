/**
 * amount-jobs.ts — Job-Verwaltung für asynchrone Betrag-Recherchen.
 * Persistiert in Directus (faas_jobs, typ "betrag") — überlebt Deploys.
 * Job-Key: `${stiftung_id}:${medium_id}` verhindert Doppel-Starts.
 */
import {
  createPersistentJob,
  getPersistentJob,
  patchPersistentJob,
  findRunningPersistentJob,
  type PersistentJob,
} from './faas-jobs-store'

export interface AmountJobResult {
  suggested_amount: number
  reasoning: string
  currency: 'CHF'
}

export type AmountJob = PersistentJob<AmountJobResult>

// Nach 15 Minuten gilt ein running-Job als verwaist (Deploy-Kill) und
// blockiert keinen Neustart mehr.
const MAX_AGE_MS = 15 * 60_000

export async function createAmountJob(stiftung_id: string, medium_id: string): Promise<AmountJob> {
  return createPersistentJob<AmountJobResult>('betrag', `${stiftung_id}:${medium_id}`)
}

export async function getAmountJob(id: string): Promise<AmountJob | undefined> {
  return getPersistentJob<AmountJobResult>('betrag', id)
}

export async function setAmountJob(
  id: string,
  patch: { status?: 'running' | 'done' | 'error'; result?: AmountJobResult; error?: string }
): Promise<void> {
  return patchPersistentJob(id, patch)
}

export async function findRunningByKey(
  stiftung_id: string,
  medium_id: string
): Promise<AmountJob | undefined> {
  return findRunningPersistentJob<AmountJobResult>('betrag', `${stiftung_id}:${medium_id}`, MAX_AGE_MS)
}
