import {
  createError,
  ForbiddenError,
  InvalidPayloadError
} from '@directus/errors'
import { defineEndpoint } from '@directus/extensions-sdk'
import Bexio, { InvoicesStatic, PositionStatic } from 'bexio'

// https://office.bexio.com/user_manager/editRights/id/1
const BEXIO_USER_ID = 1
// TODO: will change every year
// https://office.bexio.com/index.php/accountingSettings/vatSettingsYear/id/4
const BEXIO_MWST_ID = 3
const BEXIO_UNIT_ID = 2

const MISSING_ENV_ERROR = createError('500', 'Missing env variables.')
const BEXIO_ERROR = createError(
  '500',
  'Could not create invoice on Bexio. Unexpected error. See the logs.'
)

export default defineEndpoint((router, { env }) => {
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
      const { text, amount, unit_price } = _req.body

      if (!text || !amount || !unit_price) {
        return next(
          new InvalidPayloadError({
            reason: 'Missing body params text, amount or unit_price!'
          })
        )
      }

      const bexioInvoice = await createBexioInvoice({
        bexioToken,
        text: text.toString(),
        amount: amount.toString(),
        unit_price: unit_price.toString()
      })

      if (!bexioInvoice?.id) {
        return next(new BEXIO_ERROR())
      }

      res.send(bexioInvoice)
    } catch (error) {
      return next(error)
    }
  })
})

async function createBexioInvoice({
  bexioToken,
  text,
  amount,
  unit_price
}: {
  bexioToken: string
  text: string
  amount: string
  unit_price: string
}): Promise<InvoicesStatic.Invoice> {
  const bexio = new Bexio(bexioToken)

  const position: PositionStatic.PositionCreate = {
    text,
    type: 'KbPositionCustom',
    amount,
    unit_id: BEXIO_UNIT_ID,
    tax_id: BEXIO_MWST_ID,
    unit_price
  }

  return await bexio.invoices.create({
    contact_id: 2,
    user_id: BEXIO_USER_ID,
    positions: [position],
    title: 'TEST'
  })
}
