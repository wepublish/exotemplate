import { EndpointContext } from '../types'

export abstract class BaseController {
  constructor(protected readonly ctx: EndpointContext) {}

  // Each controller attaches its own routes to the shared router.
  abstract register(router: any): void
}
