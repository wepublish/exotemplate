import { readItems } from '@directus/sdk'
import type { InvoicesStatic, OrdersStatic } from 'bexio'
import type { Invoice } from '~~/types/DirectusTypes'

export interface CreateHostingInvoiceInput {
  clientPeriodId: number
  /** Invoice type discriminator; defaults to 'hosting'. */
  type?: string
  title: string
  text: string
  unitPrice: number
  /** Units in the recurring order (e.g. 12 months). */
  quantity: number
  /** Units billed in the first invoice (e.g. 7 of 12). */
  billedUnits: number
  /** 'yearly' (the only periodicity used so far). */
  periodicity: string
  /** ISO date for the first invoice. */
  billingDate: string
  /** ISO date the recurring order is valid from (e.g. 31.12.<year>). */
  orderDate: string
}

export interface CreateHostingInvoiceResult {
  bexioOrder: OrdersStatic.OrderSmall
  bexioInvoice: InvoicesStatic.Invoice
  invoiceId: string
}

/**
 * The standalone `Invoices` collection: order-backed invoices (currently the
 * recurring hosting type) that do NOT count toward available hours. Creation
 * goes through the backend `recurring-invoice` endpoint (order → repetition →
 * first partial invoice → Invoices row); listing reads the collection directly,
 * scoped by the client period via the Client policy's row-level permission.
 */
export function useInvoices() {
  const { directus, postCustomEndpoint } = useDirectus()

  async function createHostingInvoice(
    input: CreateHostingInvoiceInput
  ): Promise<CreateHostingInvoiceResult> {
    const { data } = await postCustomEndpoint('recurring-invoice', {
      ...input
    })
    return data as CreateHostingInvoiceResult
  }

  async function loadInvoices(clientPeriodId: number): Promise<Invoice[]> {
    return (await directus.request(
      readItems('Invoices', {
        filter: { clientPeriod: { _eq: clientPeriodId } },
        sort: ['-date_created'],
        limit: -1
      })
    )) as Invoice[]
  }

  return {
    createHostingInvoice,
    loadInvoices
  }
}
