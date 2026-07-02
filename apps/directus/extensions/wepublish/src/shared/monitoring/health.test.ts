import { describe, it, expect } from 'vitest'
import {
  buildClientMonitoring,
  buildOverviewMonitoring,
  normalizeEnvironmentHealth,
  normalizeEnvironments,
  overallStatus
} from './health'

describe('normalizeEnvironmentHealth', () => {
  it('maps a healthy probe, exposing latency and no message', () => {
    expect(
      normalizeEnvironmentHealth({ status: 'healthy', response_time_ms: 47 })
    ).toEqual({
      status: 'healthy',
      responseTimeMs: 47,
      message: null
    })
  })

  it('keeps the message on a failed probe', () => {
    expect(
      normalizeEnvironmentHealth({
        status: 'unreachable',
        response_time_ms: 5000,
        message: 'fetch failed'
      })
    ).toEqual({
      status: 'unreachable',
      responseTimeMs: 5000,
      message: 'fetch failed'
    })
  })

  it('coerces an unexpected status to "unknown" with null latency', () => {
    expect(normalizeEnvironmentHealth({ status: 'weird' })).toEqual({
      status: 'unknown',
      responseTimeMs: null,
      message: null
    })
  })

  it('treats a missing environment as unknown', () => {
    expect(normalizeEnvironmentHealth(undefined)).toEqual({
      status: 'unknown',
      responseTimeMs: null,
      message: null
    })
  })
})

describe('normalizeEnvironments', () => {
  it('normalizes both environments', () => {
    expect(
      normalizeEnvironments({
        production: { status: 'healthy', response_time_ms: 47 },
        staging: { status: 'unreachable', response_time_ms: 5000, message: 'x' }
      })
    ).toEqual({
      production: { status: 'healthy', responseTimeMs: 47, message: null },
      staging: { status: 'unreachable', responseTimeMs: 5000, message: 'x' }
    })
  })

  it('returns null for an absent environment', () => {
    expect(
      normalizeEnvironments({
        production: { status: 'healthy', response_time_ms: 10 }
      })
    ).toEqual({
      production: { status: 'healthy', responseTimeMs: 10, message: null },
      staging: null
    })
  })

  it('returns both null when there is no health object', () => {
    expect(normalizeEnvironments(undefined)).toEqual({
      production: null,
      staging: null
    })
  })
})

describe('overallStatus', () => {
  it('is healthy when all present environments are healthy', () => {
    expect(
      overallStatus({
        production: { status: 'healthy', responseTimeMs: 1, message: null },
        staging: { status: 'healthy', responseTimeMs: 2, message: null }
      })
    ).toBe('healthy')
  })

  it('reports the worst status across environments', () => {
    expect(
      overallStatus({
        production: { status: 'healthy', responseTimeMs: 1, message: null },
        staging: { status: 'unreachable', responseTimeMs: 5000, message: 'x' }
      })
    ).toBe('unreachable')
  })

  it('is unknown when no environment is present', () => {
    expect(overallStatus({ production: null, staging: null })).toBe('unknown')
  })
})

describe('buildClientMonitoring', () => {
  it('is notConfigured when the client has no medium_name', () => {
    expect(buildClientMonitoring({ mediumName: null, raw: null })).toEqual({
      state: 'notConfigured',
      mediumName: null,
      environments: null,
      overall: null,
      checkedAt: null
    })
  })

  it('is notMonitored when infra returns no data for the medium', () => {
    expect(buildClientMonitoring({ mediumName: 'bajour', raw: null })).toEqual({
      state: 'notMonitored',
      mediumName: 'bajour',
      environments: null,
      overall: null,
      checkedAt: null
    })
  })

  it('builds an ok result with per-environment latency and overall status', () => {
    expect(
      buildClientMonitoring({
        mediumName: 'bajour',
        raw: {
          name: 'bajour',
          health: {
            production: { status: 'healthy', response_time_ms: 121 },
            staging: {
              status: 'unreachable',
              response_time_ms: 5002,
              message: 'timeout'
            }
          },
          checked_at: '2026-07-02T08:08:19.660Z'
        }
      })
    ).toEqual({
      state: 'ok',
      mediumName: 'bajour',
      environments: {
        production: { status: 'healthy', responseTimeMs: 121, message: null },
        staging: {
          status: 'unreachable',
          responseTimeMs: 5002,
          message: 'timeout'
        }
      },
      overall: 'unreachable',
      checkedAt: '2026-07-02T08:08:19.660Z'
    })
  })
})

describe('buildOverviewMonitoring', () => {
  it('maps every medium, sorted by name, with overall status', () => {
    expect(
      buildOverviewMonitoring({
        health: {
          hauptstadt: {
            production: { status: 'healthy', response_time_ms: 69 },
            staging: {
              status: 'unreachable',
              response_time_ms: 5000,
              message: 'fetch failed'
            }
          },
          bajour: {
            production: { status: 'healthy', response_time_ms: 47 },
            staging: { status: 'healthy', response_time_ms: 67 }
          }
        },
        checked_at: '2026-03-27T10:00:00.000Z'
      })
    ).toEqual({
      media: [
        {
          mediumName: 'bajour',
          environments: {
            production: {
              status: 'healthy',
              responseTimeMs: 47,
              message: null
            },
            staging: { status: 'healthy', responseTimeMs: 67, message: null }
          },
          overall: 'healthy'
        },
        {
          mediumName: 'hauptstadt',
          environments: {
            production: {
              status: 'healthy',
              responseTimeMs: 69,
              message: null
            },
            staging: {
              status: 'unreachable',
              responseTimeMs: 5000,
              message: 'fetch failed'
            }
          },
          overall: 'unreachable'
        }
      ],
      checkedAt: '2026-03-27T10:00:00.000Z'
    })
  })

  it('returns an empty list when there is no health data', () => {
    expect(buildOverviewMonitoring(undefined)).toEqual({
      media: [],
      checkedAt: null
    })
  })
})
