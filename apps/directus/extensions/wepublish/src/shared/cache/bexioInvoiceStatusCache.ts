import type { BexioInvoiceStatus } from '../bexio/invoiceStatus'
import { TtlCache } from './ttlCache'

/**
 * Caches live Bexio invoice statuses per invoice id. The Top-Ups page asks for
 * the status of every invoice it lists on each load; without a cache that would
 * fan out one Bexio round-trip per invoice per page view and risk rate limits.
 * Short TTL so a "Bezahlt" flip shows up within ~10 minutes.
 */
export const BEXIO_INVOICE_STATUS_TTL_MS = 10 * 60 * 1000

let cache: TtlCache<BexioInvoiceStatus> | undefined

export function getBexioInvoiceStatusCache(): TtlCache<BexioInvoiceStatus> {
  if (!cache) {
    cache = new TtlCache<BexioInvoiceStatus>({
      ttlMs: BEXIO_INVOICE_STATUS_TTL_MS
    })
  }
  return cache
}
