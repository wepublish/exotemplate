/**
 * Regressionstests für die Starter-Extraktion aus
 * /api/medium-knowledge/generate-dna.ts (Task 7, Step 1): `starteGenerateDnaJob`
 * ist jetzt eine eigenständige, exportierte Funktion, die POST-Handler UND die
 * neue Portal-Route /api/portal/dna-erzeugen teilen. Dieser Test hält fest,
 * dass sich das Aussenverhalten der bestehenden Route dabei NICHT verändert.
 *
 * generate-dna-jobs wird gemockt (Muster wie portal-routen.test.ts):
 * relativer Pfad statt '@/lib/generate-dna-jobs', weil next/jest den
 * '@/'-Alias nur in Import-Statements umschreibt, nicht im jest.mock-String.
 * Beide Pfade lösen auf dieselbe Datei auf.
 *
 * `global.fetch` wird auf eine sofort abgelehnte Promise gesetzt: sobald
 * `createGenerateJob` einen "neuen" Lauf auslöst, feuert intern
 * `runGenerate(...).catch(...)` fire-and-forget und würde ohne diesen Mock
 * einen echten Directus-Call versuchen (30s-Timeout). Der Mock lässt das
 * sofort und deterministisch fehlschlagen, ohne den Test zu verzögern; der
 * Fehler wird von der eigenen .catch-Kette aufgefangen (setGenerateJob-Mock).
 */
import type { NextApiRequest, NextApiResponse } from 'next'

jest.mock('./generate-dna-jobs', () => ({
  createGenerateJob: jest.fn(),
  getGenerateJob: jest.fn(),
  setGenerateJob: jest.fn(),
  findRunningGenerateByMedium: jest.fn(),
}))

import { createGenerateJob, getGenerateJob, setGenerateJob, findRunningGenerateByMedium } from './generate-dna-jobs'
import handler, { starteGenerateDnaJob } from '../pages/api/medium-knowledge/generate-dna'

const createMock = createGenerateJob as jest.Mock
const getMock = getGenerateJob as jest.Mock
const setMock = setGenerateJob as jest.Mock
const findRunningMock = findRunningGenerateByMedium as jest.Mock

function makeRes() {
  let status = 200
  let body: unknown
  const res = {
    status: jest.fn((s: number) => {
      status = s
      return res
    }),
    json: jest.fn((j: unknown) => {
      body = j
      return res
    }),
    setHeader: jest.fn(),
  } as unknown as NextApiResponse
  return { res, getStatus: () => status, getJson: () => body as Record<string, unknown> }
}

function makeReq(opts: { method: string; body?: unknown; query?: Record<string, unknown> }): NextApiRequest {
  return { method: opts.method, body: opts.body ?? {}, query: opts.query ?? {} } as unknown as NextApiRequest
}

const NEUER_JOB = { id: 'job-1', key: 'bajour', medium_id: 'bajour', phase: 'sammeln', status: 'running', startedAt: '2026-07-09T08:00:00.000Z' }

beforeEach(() => {
  jest.clearAllMocks()
  setMock.mockResolvedValue(undefined)
  // Siehe Kommentar oben: verhindert einen echten Netzwerk-Versuch aus dem
  // fire-and-forget runGenerate-Lauf, den createGenerateJob auslöst.
  global.fetch = jest.fn().mockRejectedValue(new Error('kein Netzwerk in Tests'))
})

describe('starteGenerateDnaJob (extrahierter Starter)', () => {
  it('kein laufender Job: legt einen neuen an, running:false', async () => {
    findRunningMock.mockResolvedValue(undefined)
    createMock.mockResolvedValue(NEUER_JOB)

    const ergebnis = await starteGenerateDnaJob('bajour')

    expect('fehler' in ergebnis).toBe(false)
    expect(ergebnis).toEqual({ jobId: 'job-1', running: false })
    expect(createMock).toHaveBeenCalledWith('bajour')
  })

  it('bereits laufender Job für dieses Medium: liefert dessen id, running:true, KEIN neuer Job', async () => {
    findRunningMock.mockResolvedValue(NEUER_JOB)

    const ergebnis = await starteGenerateDnaJob('bajour')

    expect(ergebnis).toEqual({ jobId: 'job-1', running: true })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('leeres medium: {fehler}', async () => {
    const ergebnis = await starteGenerateDnaJob('')
    expect('fehler' in ergebnis).toBe(true)
    expect(createMock).not.toHaveBeenCalled()
    expect(findRunningMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/medium-knowledge/generate-dna (Route nutzt den Starter, Aussenverhalten unverändert)', () => {
  it('neuer Job: 202 { job_id, status: "running" }', async () => {
    findRunningMock.mockResolvedValue(undefined)
    createMock.mockResolvedValue(NEUER_JOB)
    const { res, getStatus, getJson } = makeRes()

    await handler(makeReq({ method: 'POST', body: { medium_id: 'bajour' } }), res)

    expect(getStatus()).toBe(202)
    expect(getJson()).toEqual({ job_id: 'job-1', status: 'running' })
  })

  it('bereits laufender Job: 200 { job_id, status: "running" } (kein 202)', async () => {
    findRunningMock.mockResolvedValue(NEUER_JOB)
    const { res, getStatus, getJson } = makeRes()

    await handler(makeReq({ method: 'POST', body: { medium_id: 'bajour' } }), res)

    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({ job_id: 'job-1', status: 'running' })
  })

  it('ohne medium_id: 400', async () => {
    const { res, getStatus } = makeRes()
    await handler(makeReq({ method: 'POST', body: {} }), res)
    expect(getStatus()).toBe(400)
  })

  it('GET ohne job_id: 400', async () => {
    const { res, getStatus } = makeRes()
    await handler(makeReq({ method: 'GET' }), res)
    expect(getStatus()).toBe(400)
  })

  it('GET mit unbekannter job_id: 404', async () => {
    getMock.mockResolvedValue(undefined)
    const { res, getStatus } = makeRes()
    await handler(makeReq({ method: 'GET', query: { job_id: 'unbekannt' } }), res)
    expect(getStatus()).toBe(404)
  })

  it('GET mit bekannter job_id: 200 mit Job-Status', async () => {
    getMock.mockResolvedValue({ ...NEUER_JOB, status: 'done', phase: 'fertig' })
    const { res, getStatus, getJson } = makeRes()
    await handler(makeReq({ method: 'GET', query: { job_id: 'job-1' } }), res)
    expect(getStatus()).toBe(200)
    expect(getJson()).toMatchObject({ id: 'job-1', medium_id: 'bajour', status: 'done', phase: 'fertig' })
  })

  it('andere Methode: 405', async () => {
    const { res, getStatus } = makeRes()
    await handler(makeReq({ method: 'DELETE' }), res)
    expect(getStatus()).toBe(405)
  })
})
