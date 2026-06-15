import { TtlCache } from './ttlCache'
import { BEXIO_INVOICE_STATUS_TTL_MS } from './bexioInvoiceStatusCache'

/**
 * Caches the public `network_link` of Bexio orders (Auftrag) per order id —
 * same short TTL and rationale as the invoice-status cache: the Top-Ups page
 * resolves a handful of order links on each load, and they change rarely.
 */
let cache: TtlCache<string | null> | undefined

export function getBexioOrderLinkCache(): TtlCache<string | null> {
  if (!cache) {
    cache = new TtlCache<string | null>({ ttlMs: BEXIO_INVOICE_STATUS_TTL_MS })
  }
  return cache
}
