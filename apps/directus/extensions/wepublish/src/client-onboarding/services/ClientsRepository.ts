import { EndpointContext } from '../types'

// Thin wrapper around Directus' ItemsService for the `Clients` collection —
// exists so controllers never duplicate the "new ItemsService, then updateOne"
// boilerplate.
export class ClientsRepository {
  private readonly items: any

  private constructor(items: any) {
    this.items = items
  }

  static async create(
    ctx: EndpointContext,
    accountability: any
  ): Promise<ClientsRepository> {
    const schema = await ctx.getSchema()
    const items = new ctx.services.ItemsService('Clients', {
      schema,
      accountability
    })
    return new ClientsRepository(items)
  }

  async setBexioContactId(
    clientId: string,
    bexioContactId: number
  ): Promise<void> {
    await this.items.updateOne(clientId, { bexio_contact_id: bexioContactId })
  }

  async setClockodoCustomerId(
    clientId: string,
    clockodoCustomerId: string
  ): Promise<void> {
    await this.items.updateOne(clientId, {
      clockodo_customer_id: clockodoCustomerId
    })
  }
}
