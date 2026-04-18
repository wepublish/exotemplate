import { InvalidPayloadError } from '@directus/errors'
import {
  asyncHandler,
  forwardAxiosError,
  requireAdmin,
  requireEnv
} from '../guards'
import { InfraService } from '../services/InfraService'
import { BaseController } from './BaseController'

const INFRA_ENV_KEYS = [
  'INFRA_CONFIGURATOR_URL',
  'INFRA_CONFIGURATOR_API_KEY'
] as const

// Terraform identifier: ^[a-z][a-z0-9_]*$
const MEDIUM_NAME_PATTERN = /^[a-z][a-z0-9_]*$/

export class InfraController extends BaseController {
  register(router: any): void {
    const proxy = (handler: any) => asyncHandler(handler, forwardAxiosError)

    router.post('/create-medium', proxy(this.createMedium))
    router.get('/infra-status/:medium_name', proxy(this.getStatus))
    router.delete('/cancel-medium/:medium_name', proxy(this.cancelMedium))
    router.get('/infra-configuration', proxy(this.getConfiguration))
    router.get('/infra-pending-prs', proxy(this.getPendingPrs))
    router.get('/media-health', proxy(this.getMediaHealth))
    router.get('/media-health/:medium_name', proxy(this.getMediumHealth))
  }

  private buildService(req: any, next: any): InfraService | null {
    if (!requireAdmin(req, next)) return null
    const env = requireEnv(this.ctx.env, INFRA_ENV_KEYS, next)
    if (!env) return null
    return new InfraService(
      env.INFRA_CONFIGURATOR_URL,
      env.INFRA_CONFIGURATOR_API_KEY
    )
  }

  private createMedium = async (req: any, res: any, next: any) => {
    const infra = this.buildService(req, next)
    if (!infra) return

    const {
      medium_name,
      has_staging,
      website_enabled,
      custom_website_hostnames
    } = req.body ?? {}

    if (!medium_name || typeof medium_name !== 'string') {
      return next(
        new InvalidPayloadError({
          reason: 'Missing required param: medium_name'
        })
      )
    }
    if (!MEDIUM_NAME_PATTERN.test(medium_name)) {
      return next(
        new InvalidPayloadError({
          reason:
            'medium_name must be a valid Terraform identifier (lowercase letters, digits, underscores; must start with a letter)'
        })
      )
    }

    const data = await infra.createMedium({
      medium_name,
      has_staging,
      website_enabled,
      custom_website_hostnames
    })
    return res.json(data)
  }

  private getStatus = async (req: any, res: any, next: any) => {
    const infra = this.buildService(req, next)
    if (!infra) return
    const data = await infra.getOnboardingStatus(req.params.medium_name)
    return res.json(data)
  }

  private cancelMedium = async (req: any, res: any, next: any) => {
    const infra = this.buildService(req, next)
    if (!infra) return
    const data = await infra.cancelOnboarding(req.params.medium_name)
    return res.json(data)
  }

  private getConfiguration = async (req: any, res: any, next: any) => {
    const infra = this.buildService(req, next)
    if (!infra) return
    const data = await infra.getConfiguration()
    return res.json(data)
  }

  private getPendingPrs = async (req: any, res: any, next: any) => {
    const infra = this.buildService(req, next)
    if (!infra) return
    const data = await infra.getPendingPrs()
    return res.json(data)
  }

  private getMediaHealth = async (req: any, res: any, next: any) => {
    const infra = this.buildService(req, next)
    if (!infra) return
    const data = await infra.getMediaHealth()
    return res.json(data)
  }

  private getMediumHealth = async (req: any, res: any, next: any) => {
    const infra = this.buildService(req, next)
    if (!infra) return
    const data = await infra.getMediumHealth(req.params.medium_name)
    return res.json(data)
  }
}
