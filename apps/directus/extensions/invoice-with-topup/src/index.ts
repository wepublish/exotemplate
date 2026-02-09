import { createError, ForbiddenError } from '@directus/errors'
import { defineEndpoint } from '@directus/extensions-sdk'
import Bexio, { InvoicesStatic } from 'bexio'

// https://office.bexio.com/user_manager/editRights/id/1
const BEXIO_USER_ID = 1

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

      const bexioToken = env.BEXIO_TOKEN

      if (!bexioToken) {
        return next(new MISSING_ENV_ERROR())
      }

      const bexioInvoice = await createBexioInvoice(bexioToken)

      if (!bexioInvoice?.id) {
        return next(new BEXIO_ERROR())
      }

      res.send(bexioInvoice)
    } catch (error) {
      return next(error)
    }
  })
})

async function createBexioInvoice(
  bexioToken: string
): Promise<InvoicesStatic.Invoice> {
  const bexio = new Bexio(bexioToken)

  return await bexio.invoices.create({
    contact_id: 2,
    user_id: BEXIO_USER_ID,
    positions: [],
    title: 'TEST'
  })
}
