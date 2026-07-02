export type InvoiceStatusKey =
  | 'draft'
  | 'pending'
  | 'paid'
  | 'partial'
  | 'canceled'
  | 'unpaid'
  | 'unknown'

export interface BexioInvoiceStatus {
  id: number
  statusId: number | null
  key: InvoiceStatusKey
  /** Public, login-free customer link (null while draft / not yet shareable). */
  networkLink: string | null
  /** Due date ("zahlbar bis") — Bexio `is_valid_to`. Null if not set. */
  dueDate: string | null
}

export interface BexioLinks {
  statuses: Record<number, BexioInvoiceStatus>
  orderLinks: Record<number, string | null>
}

type BadgeColor =
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'neutral'
  | 'primary'

const STATUS_BADGE: Record<InvoiceStatusKey, BadgeColor> = {
  draft: 'neutral',
  pending: 'info',
  unpaid: 'warning',
  partial: 'warning',
  paid: 'success',
  canceled: 'error',
  unknown: 'neutral'
}

/**
 * Fetches, in one batched server-cached request, the live Bexio status + public
 * `networkLink` for a set of invoice ids and the public `networkLink` for a set
 * of order ids. Used by the Top-Ups page for status badges and the
 * customer-facing (login-free) invoice/order links shown to client-role users.
 */
export function useBexioInvoiceStatus() {
  const { getCustomEndpoint } = useDirectus()

  const onlyPositive = (ids: number[]) =>
    Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)))

  async function fetchBexioLinks(
    invoiceIds: number[],
    orderIds: number[] = []
  ): Promise<BexioLinks> {
    const ids = onlyPositive(invoiceIds)
    const orders = onlyPositive(orderIds)
    if (!ids.length && !orders.length) return { statuses: {}, orderLinks: {} }

    const { data } = await getCustomEndpoint('bexio-invoice-status', {
      ids: ids.join(','),
      orderIds: orders.join(',')
    })
    const resp = data as {
      statuses?: Record<number, BexioInvoiceStatus>
      orders?: Record<number, { networkLink: string | null }>
    }
    const orderLinks: Record<number, string | null> = {}
    for (const [id, entry] of Object.entries(resp.orders ?? {})) {
      orderLinks[Number(id)] = entry?.networkLink ?? null
    }
    return { statuses: resp.statuses ?? {}, orderLinks }
  }

  function statusBadge(key: InvoiceStatusKey | undefined): {
    color: BadgeColor
    labelKey: string
  } {
    const resolved = key ?? 'unknown'
    return {
      color: STATUS_BADGE[resolved] ?? 'neutral',
      labelKey: `billing.invoiceStatus.${resolved}`
    }
  }

  function base64ToBlobUrl(base64: string, mime: string): string {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return URL.createObjectURL(new Blob([bytes], { type: mime }))
  }

  /**
   * Opens a Bexio document PDF (proxied through our backend) in a new tab —
   * the login-free way for a client to view the invoice/order. The tab is
   * reserved synchronously before the await so popup blockers allow it.
   */
  async function openDocumentPdf(
    kind: 'invoice' | 'order',
    id: number
  ): Promise<void> {
    const win = window.open('', '_blank')
    try {
      const { data } = await getCustomEndpoint(
        `bexio-invoice-status/${kind}/${id}/pdf`,
        {}
      )
      const pdf = data as { base64: string; mime: string | null }
      const url = base64ToBlobUrl(pdf.base64, pdf.mime ?? 'application/pdf')
      if (win) win.location.href = url
      else window.open(url, '_blank')
    } catch (error) {
      win?.close()
      throw error
    }
  }

  return {
    fetchBexioLinks,
    statusBadge,
    openInvoicePdf: (id: number) => openDocumentPdf('invoice', id),
    openOrderPdf: (id: number) => openDocumentPdf('order', id)
  }
}
