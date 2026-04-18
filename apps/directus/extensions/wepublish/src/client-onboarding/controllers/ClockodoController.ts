import { InvalidPayloadError } from '@directus/errors'
import {
  asyncHandler,
  requireAdmin,
  requireBodyParams,
  requireEnv
} from '../guards'
import { CLOCKODO_CUSTOMER_NOT_FOUND_ERROR } from '../errors'
import { ClientsRepository } from '../services/ClientsRepository'
import { ClockodoService } from '../services/ClockodoService'
import { BaseController } from './BaseController'

const CLOCKODO_ENV_KEYS = ['CLOCKODO_API_EMAIL', 'CLOCKODO_API_KEY'] as const

export class ClockodoController extends BaseController {
  register(router: any): void {
    router.post('/sync-clockodo', asyncHandler(this.sync))
    router.get('/clockodo-customer/:customerId', asyncHandler(this.getCustomer))
  }

  private getCustomer = async (req: any, res: any, next: any) => {
    if (!requireAdmin(req, next)) return
    const env = requireEnv(this.ctx.env, CLOCKODO_ENV_KEYS, next)
    if (!env) return

    const id = Number(req.params?.customerId)
    if (!Number.isFinite(id) || id <= 0) {
      return next(
        new InvalidPayloadError({
          reason: 'Path param customerId must be a positive number'
        })
      )
    }

    const clockodo = new ClockodoService(
      env.CLOCKODO_API_EMAIL,
      env.CLOCKODO_API_KEY
    )
    const customer = await clockodo.getCustomerById(id)
    if (!customer) return res.status(404).json({ error: 'customer_not_found' })
    return res.json({ customer })
  }

  private sync = async (req: any, res: any, next: any) => {
    if (!requireAdmin(req, next)) return
    const env = requireEnv(this.ctx.env, CLOCKODO_ENV_KEYS, next)
    if (!env) return

    const params = requireBodyParams(req.body, ['clientId', 'clientName'], next)
    if (!params) return

    const clockodo = new ClockodoService(
      env.CLOCKODO_API_EMAIL,
      env.CLOCKODO_API_KEY
    )

    await clockodo.syncCustomersFromBexio()
    const customer = await clockodo.findCustomerByName(
      String(params.clientName)
    )
    if (!customer) {
      return next(new CLOCKODO_CUSTOMER_NOT_FOUND_ERROR())
    }

    const customerId = String(customer.id)
    const clients = await ClientsRepository.create(this.ctx, req.accountability)
    await clients.setClockodoCustomerId(String(params.clientId), customerId)

    return res.json({ success: true, clockodoCustomerId: customerId })
  }
}
