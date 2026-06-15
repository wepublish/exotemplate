import axios, { AxiosInstance } from 'axios'

const CLOCKODO_BASE_URL = 'https://my.clockodo.com/api'
const CLOCKODO_APP_HEADER = 'We.Publish ONE Onboarding'

interface ClockodoCustomer {
  id: number
  name: string
  active: boolean
  number?: string | null
}

export class ClockodoService {
  private readonly http: AxiosInstance

  constructor(email: string, apiKey: string) {
    this.http = axios.create({
      baseURL: CLOCKODO_BASE_URL,
      headers: {
        'X-Clockodo-External-Application': CLOCKODO_APP_HEADER,
        'X-ClockodoApiUser': email,
        'X-ClockodoApiKey': apiKey
      }
    })
  }

  // Triggers the Bexio → Clockodo customer sync add-on. The add-on routes are
  // not part of the versioned resource API and stay on the v2 path.
  async syncCustomersFromBexio(): Promise<void> {
    await this.http.put('/v2/addOns/billService/customers/sync', {
      overwrite_customers: false
    })
  }

  // Returns the first customer whose name matches `name` (case-insensitive,
  // trimmed). The Clockodo API has no server-side name filter, so this fetches
  // the full list and filters client-side. The legacy `/api/v2/customers` was
  // removed on 2026-05-01; v3 is paginated and returns rows under `data`, so we
  // request the max page size to cover the workspace in one call.
  async findCustomerByName(name: string): Promise<ClockodoCustomer | null> {
    const { data } = await this.http.get('/v3/customers', {
      params: { items_per_page: 1000 }
    })
    const customers: ClockodoCustomer[] = Array.isArray(data?.data)
      ? data.data
      : []
    const target = name.trim().toLowerCase()
    return (
      customers.find((c) => c.name?.trim().toLowerCase() === target) ?? null
    )
  }

  async getCustomerById(id: number): Promise<ClockodoCustomer | null> {
    try {
      // v3 returns the single resource under `data` (was `customer`).
      const { data } = await this.http.get(`/v3/customers/${id}`)
      const customer = data?.data
      if (!customer?.id) return null
      return {
        id: customer.id,
        name: String(customer.name ?? ''),
        active: Boolean(customer.active),
        number: customer.number ?? null
      }
    } catch (err: any) {
      if (err?.response?.status === 404) return null
      throw err
    }
  }
}
