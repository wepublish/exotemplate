import { describe, expect, it } from 'vitest'
import { mapBexioInvoiceStatus } from './invoiceStatus'

describe('mapBexioInvoiceStatus', () => {
  // Bexio KB_ITEM_STATUS: Draft=7, Pending=8, Paid=9, Partial=16, Canceled=19, Unpaid=31
  it.each([
    [7, 'draft'],
    [8, 'pending'],
    [9, 'paid'],
    [16, 'partial'],
    [19, 'canceled'],
    [31, 'unpaid']
  ] as const)('maps kb_item_status_id %i to %s', (id, key) => {
    expect(mapBexioInvoiceStatus(id)).toBe(key)
  })

  it('falls back to "unknown" for unmapped ids', () => {
    expect(mapBexioInvoiceStatus(999)).toBe('unknown')
    expect(mapBexioInvoiceStatus(0)).toBe('unknown')
  })

  it('falls back to "unknown" for null/undefined', () => {
    expect(mapBexioInvoiceStatus(null)).toBe('unknown')
    expect(mapBexioInvoiceStatus(undefined)).toBe('unknown')
  })
})
