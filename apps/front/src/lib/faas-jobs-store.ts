/**
 * faas-jobs-store.ts — persistente Job-Ablage in Directus (Collection faas_jobs).
 *
 * Ersetzt die In-Memory-Maps der vier Job-Stores: Jobs überleben Deploys und
 * Container-Neustarts. Die Wrapper (amount-jobs, dna-jobs, working-dna-jobs,
 * generate-dna-jobs) behalten ihre Export-Namen, werden aber async.
 *
 * Frische-Schutz: findRunningPersistentJob ignoriert running-Zeilen, die älter
 * als maxAgeMs sind — ein vom Deploy getöteter Job blockiert keinen Neustart.
 */

export type JobTyp = 'betrag' | 'dna_messung' | 'working_dna' | 'generate_dna'
export type JobStatus = 'running' | 'done' | 'error'

export interface PersistentJob<R = unknown> {
  id: string
  key: string
  status: JobStatus
  startedAt: number
  phase?: string
  result?: R
  error?: string
}

type Row = {
  id: string
  typ: string
  key: string
  status: JobStatus
  phase: string | null
  ergebnis: unknown
  fehler: string | null
  started_at: string
}

const base = () => (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '')
const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.DIRECTUS_TOKEN || ''}`,
})

function vonRow<R>(r: Row): PersistentJob<R> {
  return {
    id: r.id,
    key: r.key,
    status: r.status,
    startedAt: Date.parse(r.started_at),
    ...(r.phase ? { phase: r.phase } : {}),
    ...(r.ergebnis != null ? { result: r.ergebnis as R } : {}),
    ...(r.fehler ? { error: r.fehler } : {}),
  }
}

export async function createPersistentJob<R = unknown>(
  typ: JobTyp,
  key: string,
  phase?: string
): Promise<PersistentJob<R>> {
  const res = await fetch(`${base()}/items/faas_jobs`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      typ,
      key,
      status: 'running',
      phase: phase ?? null,
      started_at: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const json = (await res.json()) as { data?: Row }
  if (!res.ok || !json.data) throw new Error(`faas_jobs: Anlegen fehlgeschlagen (${res.status})`)
  return vonRow<R>(json.data)
}

export async function getPersistentJob<R = unknown>(
  typ: JobTyp,
  id: string
): Promise<PersistentJob<R> | undefined> {
  const filter = encodeURIComponent(JSON.stringify({ _and: [{ id: { _eq: id } }, { typ: { _eq: typ } }] }))
  const res = await fetch(`${base()}/items/faas_jobs?filter=${filter}&limit=1`, {
    headers: headers(),
    signal: AbortSignal.timeout(15_000),
  })
  const json = (await res.json()) as { data?: Row[] }
  const row = json.data?.[0]
  return row ? vonRow<R>(row) : undefined
}

export async function patchPersistentJob(
  id: string,
  patch: { status?: JobStatus; phase?: string; result?: unknown; error?: string }
): Promise<void> {
  const body: Record<string, unknown> = {}
  if (patch.status !== undefined) body.status = patch.status
  if (patch.phase !== undefined) body.phase = patch.phase
  if (patch.result !== undefined) body.ergebnis = patch.result
  if (patch.error !== undefined) body.fehler = patch.error
  await fetch(`${base()}/items/faas_jobs/${id}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
}

export async function findRunningPersistentJob<R = unknown>(
  typ: JobTyp,
  key: string,
  maxAgeMs: number
): Promise<PersistentJob<R> | undefined> {
  const seit = new Date(Date.now() - maxAgeMs).toISOString()
  const filter = encodeURIComponent(
    JSON.stringify({
      _and: [
        { typ: { _eq: typ } },
        { key: { _eq: key } },
        { status: { _eq: 'running' } },
        { started_at: { _gte: seit } },
      ],
    })
  )
  const res = await fetch(`${base()}/items/faas_jobs?filter=${filter}&limit=1&sort=-started_at`, {
    headers: headers(),
    signal: AbortSignal.timeout(15_000),
  })
  const json = (await res.json()) as { data?: Row[] }
  const row = json.data?.[0]
  return row ? vonRow<R>(row) : undefined
}
