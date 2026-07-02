import { describe, it, expect } from 'vitest'
import { statusMeta, formatLatency } from '../app/utils/monitoring'

describe('statusMeta', () => {
  it('maps healthy to a green check', () => {
    const m = statusMeta('healthy')
    expect(m.color).toBe('success')
    expect(m.labelKey).toBe('monitoring.status.healthy')
  })

  it('maps unhealthy to a warning', () => {
    expect(statusMeta('unhealthy').color).toBe('warning')
  })

  it('maps unreachable to an error', () => {
    expect(statusMeta('unreachable').color).toBe('error')
  })

  it('maps unknown (and anything unexpected) to neutral', () => {
    expect(statusMeta('unknown').color).toBe('neutral')
    // @ts-expect-error — defensive default for an unexpected value
    expect(statusMeta('weird').color).toBe('neutral')
  })
})

describe('formatLatency', () => {
  it('formats a millisecond value, rounding to the nearest ms', () => {
    expect(formatLatency(47)).toBe('47 ms')
    expect(formatLatency(120.6)).toBe('121 ms')
  })

  it('returns null when there is no measurement', () => {
    expect(formatLatency(null)).toBeNull()
  })
})
