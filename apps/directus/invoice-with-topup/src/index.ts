import { ForbiddenError } from '@directus/errors'
import { defineEndpoint } from '@directus/extensions-sdk'

export default defineEndpoint((router, {}) => {
  router.get('/', async (_req: Request & any, res, next) => {
    const accountability = _req.accountability

    // check for user permission
    if (!accountability.user) {
      return next(new ForbiddenError())
    }
  })
})

async function createBexioInvoice() {}
