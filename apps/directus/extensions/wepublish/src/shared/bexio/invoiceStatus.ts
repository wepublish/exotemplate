import { bexioRequest } from './client'

/**
 * Live Bexio invoice status, surfaced on the Top-Ups page for every invoice
 * (regular top-ups + hosting). The `bexio` npm SDK has no plain status fetch,
 * so we GET the invoice via the thin adapter and normalise its
 * `kb_item_status_id` into a stable key the frontend maps to a localized label.
 */

export type InvoiceStatusKey =
  | 'draft'
  | 'pending'
  | 'paid'
  | 'partial'
  | 'canceled'
  | 'unpaid'
  | 'unknown'

/**
 * Bexio `kb_item_status_id` values, from `InvoicesStatic.KB_ITEM_STATUS`:
 * Draft=7, Pending=8, Paid=9, Partial=16, Canceled=19, Unpaid=31.
 */
const STATUS_BY_ID: Record<number, InvoiceStatusKey> = {
  7: 'draft',
  8: 'pending',
  9: 'paid',
  16: 'partial',
  19: 'canceled',
  31: 'unpaid'
}

export function mapBexioInvoiceStatus(
  statusId: number | null | undefined
): InvoiceStatusKey {
  if (statusId === null || statusId === undefined) return 'unknown'
  return STATUS_BY_ID[statusId] ?? 'unknown'
}

export interface BexioInvoiceStatus {
  id: number
  statusId: number | null
  key: InvoiceStatusKey
  /**
   * Public, login-free customer link (Bexio `network.bexio.com` URL). Shown to
   * client-role users so they can view the invoice without a Bexio account. May
   * be null (e.g. while the invoice is still a draft).
   */
  networkLink: string | null
  /** Due date ("zahlbar bis") — Bexio `is_valid_to`. Null if not set. */
  dueDate: string | null
}

export async function getInvoiceStatus(
  token: string,
  id: number
): Promise<BexioInvoiceStatus> {
  const invoice = await bexioRequest<{
    kb_item_status_id?: number
    network_link?: string | null
    is_valid_to?: string | null
  }>(token, 'GET', `/2.0/kb_invoice/${id}`)
  const statusId = invoice.kb_item_status_id ?? null
  return {
    id,
    statusId,
    key: mapBexioInvoiceStatus(statusId),
    networkLink: invoice.network_link ?? null,
    dueDate: invoice.is_valid_to ?? null
  }
}

/**
 * Public, login-free customer link for a Bexio order (Auftrag / kb_order). Same
 * `network.bexio.com` mechanism as invoices. Returns null when none exists yet.
 */
export async function getOrderNetworkLink(
  token: string,
  id: number
): Promise<string | null> {
  const order = await bexioRequest<{ network_link?: string | null }>(
    token,
    'GET',
    `/2.0/kb_order/${id}`
  )
  return order.network_link ?? null
}

export interface BexioDocumentPdf {
  name: string | null
  /** MIME type, e.g. 'application/pdf'. */
  mime: string | null
  /** base64-encoded file content. */
  base64: string
}

/**
 * The rendered PDF of a Bexio document. Bexio's PDF endpoints return JSON with a
 * base64 `content` field (NOT raw bytes). Proxied through our backend so a
 * client-role user can view the document without a Bexio login — the public
 * `network_link` is only present once a document is shared via the Bexio
 * network, so the PDF is the reliable fallback for issued invoices.
 */
async function getDocumentPdf(
  token: string,
  path: string
): Promise<BexioDocumentPdf> {
  const pdf = await bexioRequest<{
    name?: string
    mime_type?: string
    content: string
  }>(token, 'GET', path)
  return {
    name: pdf.name ?? null,
    mime: pdf.mime_type ?? 'application/pdf',
    base64: pdf.content
  }
}

export function getInvoicePdf(
  token: string,
  id: number
): Promise<BexioDocumentPdf> {
  return getDocumentPdf(token, `/2.0/kb_invoice/${id}/pdf`)
}

export function getOrderPdf(
  token: string,
  id: number
): Promise<BexioDocumentPdf> {
  return getDocumentPdf(token, `/2.0/kb_order/${id}/pdf`)
}
