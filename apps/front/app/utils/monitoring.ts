/**
 * Frontend types + presentational mappers for uptime monitoring. Mirrors the
 * shapes returned by the backend `/monitoring/*` endpoints (see the extension's
 * shared/monitoring/health.ts). Kept pure and framework-free so it's unit-tested.
 */

export type HealthStatus = 'healthy' | 'unhealthy' | 'unreachable' | 'unknown'

export interface EnvironmentHealth {
  status: HealthStatus
  responseTimeMs: number | null
  message: string | null
}

export interface MediumEnvironments {
  production: EnvironmentHealth | null
  staging: EnvironmentHealth | null
}

export type ClientMonitoringState = 'ok' | 'notConfigured' | 'notMonitored'

export interface ClientMonitoring {
  state: ClientMonitoringState
  mediumName: string | null
  environments: MediumEnvironments | null
  overall: HealthStatus | null
  checkedAt: string | null
}

export interface MediumMonitoring {
  mediumName: string
  environments: MediumEnvironments
  overall: HealthStatus
}

export interface OverviewMonitoring {
  media: MediumMonitoring[]
  checkedAt: string | null
}

export interface StatusMeta {
  color: 'success' | 'warning' | 'error' | 'neutral'
  icon: string
  labelKey: string
}

export function statusMeta(status: HealthStatus): StatusMeta {
  switch (status) {
    case 'healthy':
      return {
        color: 'success',
        icon: 'lucide:circle-check',
        labelKey: 'monitoring.status.healthy'
      }
    case 'unhealthy':
      return {
        color: 'warning',
        icon: 'lucide:triangle-alert',
        labelKey: 'monitoring.status.unhealthy'
      }
    case 'unreachable':
      return {
        color: 'error',
        icon: 'lucide:circle-x',
        labelKey: 'monitoring.status.unreachable'
      }
    default:
      return {
        color: 'neutral',
        icon: 'lucide:circle-help',
        labelKey: 'monitoring.status.unknown'
      }
  }
}

/** Human-readable latency, rounded to the nearest millisecond. */
export function formatLatency(ms: number | null): string | null {
  if (ms == null) return null
  return `${Math.round(ms)} ms`
}
