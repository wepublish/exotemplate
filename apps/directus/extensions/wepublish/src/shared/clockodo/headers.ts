import type { BillingEnv } from '../billing/env'

/**
 * Shared Clockodo HTTP headers. Centralised so all wrappers identify
 * themselves with the same `External-Application` string and pull credentials
 * from the same place.
 */
export function clockodoHeaders(env: BillingEnv): Record<string, string> {
  return {
    'X-Clockodo-External-Application': 'Inside We.Publish Nuxt Application',
    'X-ClockodoApiUser': env.clockodoApiEmail,
    'X-ClockodoApiKey': env.clockodoApiKey
  }
}
