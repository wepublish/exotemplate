import {
  ContainsNullValuesError,
  createError,
  ForbiddenError,
  InvalidPayloadError
} from '@directus/errors'
import { defineEndpoint } from '@directus/extensions-sdk'
import Bexio, { InvoicesStatic, PositionStatic } from 'bexio'
import { Client, ClientPeriod, TopUp } from '../DirectusTypes'

// https://office.bexio.com/user_manager/editRights/id/1
const BEXIO_USER_ID = 1
const BEXIO_MWST_ID = 47
const BEXIO_UNIT_ID = 2
const BEXIO_ACCOUNT_ID = 150 // Ertrag Dienstleistungen (account_no 3400)

const MISSING_ENV_ERROR = createError('500', 'Missing env variables.')
const BEXIO_ERROR = createError(
  '500',
  'Could not create invoice on Bexio. Unexpected error. See the logs.'
)

export default defineEndpoint((router, { env, services, getSchema }) => {
  router.post('/', async (_req: Request & any, res, next) => {
    try {
      const accountability = _req.accountability

      // check for user permission
      if (!accountability.user) {
        return next(new ForbiddenError())
      }

      // check for env variables
      const bexioToken = env.BEXIO_TOKEN

      if (!bexioToken) {
        return next(new MISSING_ENV_ERROR())
      }

      // get body params
      const {
        clientPeriodId,
        title,
        text,
        amount,
        unit_price,
        wepPercentage,
        billingDate
      } = _req.body

      if (
        !clientPeriodId ||
        !title ||
        !text ||
        !amount ||
        !unit_price ||
        !billingDate
      ) {
        return next(
          new InvalidPayloadError({
            reason: 'Missing body params text, amount or unit_price!'
          })
        )
      }

      // load client period table data
      const ItemsService = services.ItemsService
      const schema = await getSchema()

      const clientPeriodService = new ItemsService<ClientPeriod>(
        'Clients_Periods',
        { schema, accountability }
      )
      const topUpService = new ItemsService<TopUp>('TopUps', {
        schema,
        accountability
      })

      const clientPeriod = await clientPeriodService.readOne(clientPeriodId, {
        fields: ['*', 'Clients_id.*']
      })

      const bexioContactId = (clientPeriod.Clients_id as Client)
        .bexio_contact_id

      if (!clientPeriod || !bexioContactId) {
        return next(
          new ContainsNullValuesError({
            collection: 'Clients_Periods',
            field: 'id'
          })
        )
      }

      const bexioInvoice = await createBexioInvoice({
        bexioToken,
        contactId: Number(bexioContactId),
        title: title.toString(),
        text: text.toString(),
        amount: amount.toString(),
        unit_price: unit_price.toString(),
        billingDate: new Date(billingDate)
      })

      if (!bexioInvoice?.id || !bexioInvoice.total_gross) {
        return next(new BEXIO_ERROR())
      }

      // create new topup
      const topUpId = await topUpService.createOne({
        status: 'published',
        clientPeriod: clientPeriodId,
        bexioInvoiceId: bexioInvoice.id,
        amount: Number(bexioInvoice.total_gross),
        hourlyRate: Number(unit_price),
        wepPercentage: Number(wepPercentage),
        note: title
      })

      res.send({ bexioInvoice, topUpId })
    } catch (error) {
      return next(error)
    }
  })
})

async function createBexioInvoice({
  bexioToken,
  contactId,
  title,
  text,
  amount,
  unit_price,
  billingDate
}: {
  bexioToken: string
  contactId: number
  title: string
  text: string
  amount: string
  unit_price: string
  billingDate: Date
}): Promise<InvoicesStatic.Invoice> {
  const bexio = new Bexio(bexioToken)

  const position: PositionStatic.PositionCreate = {
    text,
    type: 'KbPositionCustom',
    amount,
    unit_id: BEXIO_UNIT_ID,
    account_id: BEXIO_ACCOUNT_ID,
    tax_id: BEXIO_MWST_ID,
    unit_price
  }

  return await bexio.invoices.create({
    contact_id: contactId,
    user_id: BEXIO_USER_ID,
    positions: [position],
    title,
    is_valid_from: billingDate.toISOString(),
    mwst_type: 0,
    mwst_is_net: true
  })
}
