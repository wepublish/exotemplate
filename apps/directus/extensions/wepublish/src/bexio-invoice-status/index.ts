import {
  createError,
  ForbiddenError,
  InvalidPayloadError
} from '@directus/errors'
import { defineEndpoint } from '@directus/extensions-sdk'
import {
  getInvoicePdf,
  getInvoiceStatus,
  getOrderNetworkLink,
  getOrderPdf,
  type BexioDocumentPdf,
  type BexioInvoiceStatus
} from '../shared/bexio'
import { getBexioInvoiceStatusCache } from '../shared/cache/bexioInvoiceStatusCache'
import { getBexioOrderLinkCache } from '../shared/cache/bexioOrderLinkCache'

const MISSING_ENV_ERROR = createError('500', 'Missing env variables.')

function parseIds(raw: unknown): number[] {
  return Array.from(
    new Set(
      String(raw ?? '')
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  )
}

/**
 * GET /bexio-invoice-status?ids=1,2,3&orderIds=4,5
 *
 * For each invoice id returns the live Bexio status
 * (`draft|pending|paid|partial|canceled|unpaid|unknown`) plus the public,
 * login-free `networkLink` (Bexio `network.bexio.com` URL) shown to client-role
 * users. For each order id returns the order's public `networkLink`. Used by the
 * Top-Ups page for status badges and the customer-facing invoice/order links.
 *
 * Cached per id (see the bexio caches) so a page full of rows doesn't hammer
 * Bexio. A single id that errors resolves to a null/unknown entry instead of
 * failing the whole batch.
 */
export default defineEndpoint((router, { env }) => {
  router.get('/', async (req: any, res, next) => {
    try {
      if (!req.accountability?.user) {
        return next(new ForbiddenError())
      }

      const bexioToken = env.BEXIO_TOKEN
      if (!bexioToken) {
        return next(new MISSING_ENV_ERROR())
      }

      const ids = parseIds(req.query?.ids)
      const orderIds = parseIds(req.query?.orderIds)

      const statusCache = getBexioInvoiceStatusCache()
      const orderCache = getBexioOrderLinkCache()

      const [invoiceEntries, orderEntries] = await Promise.all([
        Promise.all(
          ids.map(async (id): Promise<BexioInvoiceStatus> => {
            try {
              return await statusCache.getOrCompute(String(id), () =>
                getInvoiceStatus(bexioToken, id)
              )
            } catch {
              return { id, statusId: null, key: 'unknown', networkLink: null }
            }
          })
        ),
        Promise.all(
          orderIds.map(
            async (id): Promise<{ id: number; networkLink: string | null }> => {
              try {
                const networkLink = await orderCache.getOrCompute(
                  String(id),
                  () => getOrderNetworkLink(bexioToken, id)
                )
                return { id, networkLink }
              } catch {
                return { id, networkLink: null }
              }
            }
          )
        )
      ])

      const statuses: Record<number, BexioInvoiceStatus> = {}
      for (const entry of invoiceEntries) {
        statuses[entry.id] = entry
      }
      const orders: Record<number, { networkLink: string | null }> = {}
      for (const entry of orderEntries) {
        orders[entry.id] = { networkLink: entry.networkLink }
      }

      res.send({ statuses, orders })
    } catch (error) {
      return next(error)
    }
  })

  // PDF proxies: let a client-role user open the actual invoice / order document
  // without a Bexio login. We fetch the PDF with our Bexio token and hand the
  // base64 to the frontend, which opens it as a blob.
  function pdfHandler(
    fetchPdf: (token: string, id: number) => Promise<BexioDocumentPdf>
  ) {
    return async (req: any, res: any, next: any) => {
      try {
        if (!req.accountability?.user) {
          return next(new ForbiddenError())
        }
        const bexioToken = env.BEXIO_TOKEN
        if (!bexioToken) {
          return next(new MISSING_ENV_ERROR())
        }
        const id = Number(req.params?.id)
        if (!Number.isInteger(id) || id <= 0) {
          return next(new InvalidPayloadError({ reason: 'Invalid id' }))
        }
        const pdf = await fetchPdf(bexioToken, id)
        res.send(pdf)
      } catch (error) {
        return next(error)
      }
    }
  }

  router.get('/invoice/:id/pdf', pdfHandler(getInvoicePdf))
  router.get('/order/:id/pdf', pdfHandler(getOrderPdf))
})
