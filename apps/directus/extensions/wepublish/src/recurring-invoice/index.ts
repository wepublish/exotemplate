import {
  ContainsNullValuesError,
  createError,
  ForbiddenError,
  InvalidPayloadError
} from '@directus/errors'
import { defineEndpoint } from '@directus/extensions-sdk'
import { Client, ClientPeriod, Invoice } from '../DirectusTypes'
import {
  buildHostingOrderPayload,
  buildOrderInvoicePayload,
  buildOrderRepetitionPayload,
  createInvoiceFromOrder,
  createOrder,
  createOrderRepetition,
  type OrderPeriodicity
} from '../shared/bexio'

const MISSING_ENV_ERROR = createError('500', 'Missing env variables.')
const BEXIO_ERROR = createError(
  '500',
  'Could not create the recurring order / invoice on Bexio. Unexpected error. See the logs.'
)

/**
 * POST /recurring-invoice
 *
 * Creates the third, "hosting" billing type: a RECURRING Bexio order (kb_order /
 * "Auftrag") plus a first invoice derived from it that bills only the remaining
 * months (e.g. 7 of 12). The result is stored in the standalone `Invoices`
 * collection — NOT `TopUps` — so it never counts toward the client's available
 * hours.
 *
 * Admin-only: creating a recurring billing arrangement is a privileged action,
 * and the frontend only exposes the button to administrators.
 */
export default defineEndpoint((router, { env, services, getSchema }) => {
  router.post('/', async (_req: Request & any, res, next) => {
    try {
      const accountability = _req.accountability

      if (!accountability?.user) {
        return next(new ForbiddenError())
      }
      if (accountability?.admin !== true) {
        return next(new ForbiddenError())
      }

      const bexioToken = env.BEXIO_TOKEN
      if (!bexioToken) {
        return next(new MISSING_ENV_ERROR())
      }

      const {
        clientPeriodId,
        type,
        title,
        text,
        unitPrice,
        quantity,
        billedUnits,
        periodicity,
        billingDate,
        orderDate
      } = _req.body

      if (
        !clientPeriodId ||
        !title ||
        !text ||
        !unitPrice ||
        !quantity ||
        !billedUnits ||
        !billingDate ||
        !orderDate
      ) {
        return next(
          new InvalidPayloadError({
            reason:
              'Missing body params (clientPeriodId, title, text, unitPrice, quantity, billedUnits, billingDate, orderDate are required).'
          })
        )
      }

      const ItemsService = services.ItemsService
      const schema = await getSchema()

      const clientPeriodService = new ItemsService<ClientPeriod>(
        'Clients_Periods',
        { schema, accountability }
      )
      const invoiceService = new ItemsService<Invoice>('Invoices', {
        schema,
        accountability
      })

      const clientPeriod = await clientPeriodService.readOne(clientPeriodId, {
        fields: ['*', 'Clients_id.*']
      })

      const bexioContactId = (clientPeriod?.Clients_id as Client)
        ?.bexio_contact_id

      if (!clientPeriod || !bexioContactId) {
        return next(
          new ContainsNullValuesError({
            collection: 'Clients_Periods',
            field: 'id'
          })
        )
      }

      // Step 1: create the recurring order (Auftrag) for the full quantity.
      const order = await createOrder(
        bexioToken,
        buildHostingOrderPayload({
          contactId: Number(bexioContactId),
          title: title.toString(),
          text: text.toString(),
          unitPrice: Number(unitPrice),
          quantity: Number(quantity),
          validFrom: new Date(orderDate).toISOString()
        })
      )

      if (!order?.id) {
        return next(new BEXIO_ERROR())
      }

      // Step 1b: make it recurring (yearly by default).
      await createOrderRepetition(
        bexioToken,
        order.id,
        buildOrderRepetitionPayload({
          periodicity: (periodicity as OrderPeriodicity) || 'yearly',
          startDate: new Date(orderDate).toISOString()
        })
      )

      // Step 2: derive the first invoice, billing only the remaining months.
      const orderPositions = (order.positions ?? []).map((p) => ({
        id: p.id,
        type: p.type
      }))
      const invoice = await createInvoiceFromOrder(
        bexioToken,
        order.id,
        buildOrderInvoicePayload({
          orderPositions,
          billedUnits: Number(billedUnits)
        })
      )

      if (!invoice?.id) {
        return next(new BEXIO_ERROR())
      }

      const invoiceId = await invoiceService.createOne({
        status: 'published',
        clientPeriod: clientPeriodId,
        type: (type as string) || 'hosting',
        title: title.toString(),
        description: text.toString(),
        bexioOrderId: order.id,
        bexioInvoiceId: invoice.id,
        unitPrice: Number(unitPrice),
        quantity: Number(quantity),
        billedUnits: Number(billedUnits),
        periodicity: (periodicity as string) || 'yearly',
        amount: invoice.total_gross ? Number(invoice.total_gross) : null
      })

      res.send({ bexioOrder: order, bexioInvoice: invoice, invoiceId })
    } catch (error) {
      return next(error)
    }
  })
})
