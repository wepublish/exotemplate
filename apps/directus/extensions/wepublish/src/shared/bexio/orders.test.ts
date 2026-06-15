import { describe, expect, it } from 'vitest'
import {
  BEXIO_ACCOUNT_ID,
  BEXIO_MWST_ID,
  BEXIO_UNIT_ID,
  BEXIO_USER_ID
} from './constants'
import {
  buildHostingOrderPayload,
  buildOrderInvoicePayload,
  buildOrderRepetitionPayload
} from './orders'

describe('buildHostingOrderPayload', () => {
  const base = {
    contactId: 42,
    title: 'We.Care (Hosting / Betrieb) & We.Share',
    text: 'We.Care (Hosting / Betrieb) & We.Share. Gemäss vertraglicher Vereinbarung.',
    unitPrice: 390,
    quantity: 12,
    validFrom: '2026-12-31'
  }

  it('builds a single net+VAT custom position with the shared Bexio constants', () => {
    const payload = buildHostingOrderPayload(base)

    expect(payload.contact_id).toBe(42)
    expect(payload.user_id).toBe(BEXIO_USER_ID)
    expect(payload.title).toBe(base.title)
    expect(payload.is_valid_from).toBe('2026-12-31')
    expect(payload.mwst_type).toBe(0)
    expect(payload.mwst_is_net).toBe(true)

    expect(payload.positions).toHaveLength(1)
    expect(payload.positions[0]).toEqual({
      type: 'KbPositionCustom',
      text: base.text,
      amount: '12',
      unit_id: BEXIO_UNIT_ID,
      account_id: BEXIO_ACCOUNT_ID,
      tax_id: BEXIO_MWST_ID,
      unit_price: '390'
    })
  })

  it('stringifies the quantity and unit price (Bexio expects strings)', () => {
    const payload = buildHostingOrderPayload({
      ...base,
      quantity: 6,
      unitPrice: 250
    })
    expect(payload.positions[0]?.amount).toBe('6')
    expect(payload.positions[0]?.unit_price).toBe('250')
  })
})

describe('buildOrderRepetitionPayload', () => {
  it('puts start at the top level, type as the unit and interval as a numeric factor', () => {
    const payload = buildOrderRepetitionPayload({
      periodicity: 'yearly',
      startDate: '2026-12-31'
    })

    expect(payload).toEqual({
      start: '2026-12-31',
      repetition: { type: 'yearly', interval: 1 }
    })
  })

  it('uses the periodicity as the repetition type', () => {
    expect(
      buildOrderRepetitionPayload({
        periodicity: 'monthly',
        startDate: '2026-01-01'
      }).repetition.type
    ).toBe('monthly')
  })
})

describe('buildOrderInvoicePayload', () => {
  it('takes over each order position by id + type with the billed unit count', () => {
    const payload = buildOrderInvoicePayload({
      orderPositions: [
        { id: 100, type: 'KbPositionCustom' },
        { id: 101, type: 'KbPositionArticle' }
      ],
      billedUnits: 7
    })

    expect(payload).toEqual({
      positions: [
        { id: 100, type: 'KbPositionCustom', amount: '7' },
        { id: 101, type: 'KbPositionArticle', amount: '7' }
      ]
    })
  })

  it('falls back to the custom-position type when the order omits it', () => {
    const payload = buildOrderInvoicePayload({
      orderPositions: [{ id: 100 }],
      billedUnits: 7
    })
    expect(payload.positions[0]?.type).toBe('KbPositionCustom')
  })

  it('bills the full count when remaining months equals the order quantity', () => {
    const payload = buildOrderInvoicePayload({
      orderPositions: [{ id: 1, type: 'KbPositionCustom' }],
      billedUnits: 12
    })
    expect(payload.positions[0]?.amount).toBe('12')
  })

  it('sends only positions (no is_valid_from — Bexio rejects it)', () => {
    const payload = buildOrderInvoicePayload({
      orderPositions: [{ id: 1, type: 'KbPositionCustom' }],
      billedUnits: 7
    })
    expect(Object.keys(payload)).toEqual(['positions'])
  })
})
