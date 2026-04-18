import { defineEndpoint } from '@directus/extensions-sdk'
import { BexioController } from './controllers/BexioController'
import { ClockodoController } from './controllers/ClockodoController'
import { InfraController } from './controllers/InfraController'
import { JiraController } from './controllers/JiraController'
import { SlackController } from './controllers/SlackController'
import { BaseController } from './controllers/BaseController'
import { EndpointContext } from './types'

// Mounts all client-onboarding routes. Each integration lives in its own
// controller (see ./controllers/*) and exposes a `register(router)` method.
export default defineEndpoint((router, ctx) => {
  const endpointCtx: EndpointContext = {
    env: ctx.env,
    services: ctx.services,
    getSchema: ctx.getSchema
  }

  const controllers: BaseController[] = [
    new JiraController(endpointCtx),
    new SlackController(endpointCtx),
    new BexioController(endpointCtx),
    new ClockodoController(endpointCtx),
    new InfraController(endpointCtx)
  ]

  for (const controller of controllers) {
    controller.register(router)
  }
})
