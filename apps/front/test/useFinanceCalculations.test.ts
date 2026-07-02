import { describe, expect, it } from 'vitest'
import { useFinanceCalculations } from '../app/composables/useFinanceCalculations'

const { getHostingInvoiceTotals, getHostingOrderAnnualTotal } =
  useFinanceCalculations()

describe('getHostingInvoiceTotals', () => {
  it('bills only the remaining months and adds 8.1% VAT', () => {
    // 7 of 12 months at 390 CHF.
    const { net, vat, gross } = getHostingInvoiceTotals(390, 7)
    expect(net).toBe(2730)
    expect(vat).toBe(221.13) // 2730 * 0.081
    expect(gross).toBeCloseTo(2951.13, 2)
  })

  it('handles the full year', () => {
    const { net, gross } = getHostingInvoiceTotals(390, 12)
    expect(net).toBe(4680)
    expect(gross).toBeCloseTo(5059.08, 2)
  })

  it('rounds VAT to two decimals', () => {
    const { vat } = getHostingInvoiceTotals(333, 1)
    // 333 * 0.081 = 26.973 -> 26.97
    expect(vat).toBe(26.97)
  })

  it('treats undefined inputs as zero', () => {
    expect(getHostingInvoiceTotals(undefined, undefined)).toEqual({
      net: 0,
      vat: 0,
      gross: 0
    })
  })
})

describe('getHostingOrderAnnualTotal', () => {
  it('multiplies unit price by the order quantity', () => {
    expect(getHostingOrderAnnualTotal(390, 12)).toBe(4680)
  })

  it('treats undefined inputs as zero', () => {
    expect(getHostingOrderAnnualTotal(undefined, 12)).toBe(0)
    expect(getHostingOrderAnnualTotal(390, undefined)).toBe(0)
  })
})
