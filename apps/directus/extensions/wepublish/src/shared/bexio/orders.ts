import { bexioRequest } from './client'
import {
  BEXIO_ACCOUNT_ID,
  BEXIO_MWST_ID,
  BEXIO_UNIT_ID,
  BEXIO_USER_ID
} from './constants'

/**
 * Bexio recurring orders (`kb_order` / "Auftrag") + deriving the first invoice
 * from one. The `bexio` npm SDK exposes `orders.create()` but cannot express
 * a `repetition` config nor the "create invoice from order" call, so these go
 * through the thin `bexioRequest` adapter.
 *
 * The pure `build*Payload` functions are unit-tested; the thin `create*`
 * wrappers just POST those payloads. When the live Bexio API disagrees with a
 * payload shape (see LIVE-VERIFY notes), adjust the builder only — the tests
 * pin the expected output.
 */

export type OrderPeriodicity = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface BexioOrderPosition {
  type: 'KbPositionCustom'
  text: string
  amount: string
  unit_id: number
  account_id: number
  tax_id: number
  unit_price: string
}

export interface BexioOrderCreatePayload {
  contact_id: number
  user_id: number
  title: string
  is_valid_from: string
  // 0 = mwst_type "including taxes"; with `mwst_is_net: true` the position
  // prices are net and VAT is added on top — same model as `invoice-with-topup`.
  mwst_type: number
  mwst_is_net: boolean
  positions: BexioOrderPosition[]
}

export interface HostingOrderInput {
  contactId: number
  title: string
  text: string
  /** Price per unit (e.g. 390 CHF / month). */
  unitPrice: number
  /** Number of units in the recurring order (e.g. 12 months). */
  quantity: number
  /** ISO date the order is valid from (e.g. 31.12.<year>). */
  validFrom: string
}

/**
 * Build the `POST /2.0/kb_order` body for a hosting order: a single custom
 * position of `quantity` units at `unitPrice`, net + VAT. The We.Share
 * percentage is a We.Publish-internal figure stored on our side, NOT part of
 * the Bexio order positions, so it deliberately does not appear here.
 */
export function buildHostingOrderPayload(
  input: HostingOrderInput
): BexioOrderCreatePayload {
  return {
    contact_id: input.contactId,
    user_id: BEXIO_USER_ID,
    title: input.title,
    is_valid_from: input.validFrom,
    mwst_type: 0,
    mwst_is_net: true,
    positions: [
      {
        type: 'KbPositionCustom',
        text: input.text,
        amount: String(input.quantity),
        unit_id: BEXIO_UNIT_ID,
        account_id: BEXIO_ACCOUNT_ID,
        tax_id: BEXIO_MWST_ID,
        unit_price: String(input.unitPrice)
      }
    ]
  }
}

export interface BexioOrderRepetitionPayload {
  /** Top-level start date the repetition runs from (required by Bexio). */
  start: string
  repetition: {
    /** Period unit, e.g. 'yearly'. */
    type: OrderPeriodicity
    /** Numeric factor — every N units (e.g. 1 = every year). */
    interval: number
  }
}

/**
 * Build the `POST /2.0/kb_order/{id}/repetition` body that turns the order into
 * a recurring one (e.g. yearly).
 *
 * Confirmed against Bexio's validation: `start` is a top-level required field,
 * and `repetition` carries `type` (the period unit, required) plus `interval`
 * (the numeric factor — "every N units", NOT the unit token).
 */
export function buildOrderRepetitionPayload(input: {
  periodicity: OrderPeriodicity
  startDate: string
}): BexioOrderRepetitionPayload {
  return {
    start: input.startDate,
    repetition: {
      type: input.periodicity,
      interval: 1
    }
  }
}

export interface BexioOrderInvoicePayload {
  positions: Array<{ id: number; type: string; amount: string }>
}

const DEFAULT_POSITION_TYPE = 'KbPositionCustom'

/**
 * Build the `POST /2.0/kb_order/{id}/invoice` body. The first invoice must bill
 * only the remaining months (e.g. 7 of 12), so we take over each order position
 * (by `id` + its `type`) and set the quantity to `billedUnits` (partial
 * delivery). Bexio rejects positions without a `type`, so it is carried over
 * from the order (falling back to the custom-position type). The endpoint does
 * NOT accept an `is_valid_from` field — Bexio dates the invoice itself.
 */
export function buildOrderInvoicePayload(input: {
  orderPositions: Array<{ id: number; type?: string }>
  billedUnits: number
}): BexioOrderInvoicePayload {
  return {
    positions: input.orderPositions.map((position) => ({
      id: position.id,
      type: position.type || DEFAULT_POSITION_TYPE,
      amount: String(input.billedUnits)
    }))
  }
}

export interface BexioOrderResponse {
  id: number
  document_nr?: string
  total_gross?: string
  is_recurring?: boolean
  positions?: Array<{ id: number; type?: string }>
  [key: string]: unknown
}

export interface BexioInvoiceResponse {
  id: number
  total_gross?: string
  kb_item_status_id?: number
  document_nr?: string
  [key: string]: unknown
}

export function createOrder(
  token: string,
  payload: BexioOrderCreatePayload
): Promise<BexioOrderResponse> {
  return bexioRequest<BexioOrderResponse>(
    token,
    'POST',
    '/2.0/kb_order',
    payload
  )
}

export function createOrderRepetition(
  token: string,
  orderId: number,
  payload: BexioOrderRepetitionPayload
): Promise<unknown> {
  return bexioRequest(
    token,
    'POST',
    `/2.0/kb_order/${orderId}/repetition`,
    payload
  )
}

export function createInvoiceFromOrder(
  token: string,
  orderId: number,
  payload: BexioOrderInvoicePayload
): Promise<BexioInvoiceResponse> {
  return bexioRequest<BexioInvoiceResponse>(
    token,
    'POST',
    `/2.0/kb_order/${orderId}/invoice`,
    payload
  )
}
