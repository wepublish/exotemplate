import { InvalidPayloadError } from '@directus/errors'
import {
  asyncHandler,
  requireAdmin,
  requireBodyParams,
  requireEnv
} from '../guards'
import { BexioService } from '../services/BexioService'
import { ClientsRepository } from '../services/ClientsRepository'
import { BaseController } from './BaseController'

const BEXIO_ENV_KEYS = ['BEXIO_TOKEN'] as const

const CONTACT_PARAMS = [
  'clientId',
  'companyName',
  'email',
  'street',
  'streetNumber',
  'zip',
  'city'
] as const

export class BexioController extends BaseController {
  register(router: any): void {
    router.post('/create-bexio-contact', asyncHandler(this.createContact))
    router.get('/bexio-contact/:contactId', asyncHandler(this.getContact))
  }

  private getContact = async (req: any, res: any, next: any) => {
    if (!requireAdmin(req, next)) return
    const env = requireEnv(this.ctx.env, BEXIO_ENV_KEYS, next)
    if (!env) return

    const id = Number(req.params?.contactId)
    if (!Number.isFinite(id) || id <= 0) {
      return next(
        new InvalidPayloadError({
          reason: 'Path param contactId must be a positive number'
        })
      )
    }

    const bexio = new BexioService(env.BEXIO_TOKEN)
    const contact = await bexio.getContact(id)
    if (!contact) return res.status(404).json({ error: 'contact_not_found' })
    return res.json({ contact })
  }

  private createContact = async (req: any, res: any, next: any) => {
    if (!requireAdmin(req, next)) return
    const env = requireEnv(this.ctx.env, BEXIO_ENV_KEYS, next)
    if (!env) return

    const params = requireBodyParams(req.body, CONTACT_PARAMS, next)
    if (!params) return

    const bexio = new BexioService(env.BEXIO_TOKEN)
    const contact = await bexio.createCompanyContact({
      companyName: String(params.companyName),
      email: String(params.email),
      street: String(params.street),
      streetNumber: String(params.streetNumber),
      zip: String(params.zip),
      city: String(params.city)
    })

    const clients = await ClientsRepository.create(this.ctx, req.accountability)
    await clients.setBexioContactId(String(params.clientId), contact.id)

    return res.json({ success: true, bexioContactId: contact.id })
  }
}
