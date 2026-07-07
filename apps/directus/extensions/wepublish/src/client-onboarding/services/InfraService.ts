import axios, { AxiosInstance } from 'axios'

export interface CreateMediumInput {
  medium_name: string
  has_staging?: boolean
  website_enabled?: boolean
  custom_website_hostnames?: string[]
}

// Thin proxy over the standalone infrastructure-configurator service. All
// endpoints require a bearer token held exclusively in Directus env.
export class InfraService {
  private readonly http: AxiosInstance

  constructor(baseUrl: string, apiKey: string) {
    this.http = axios.create({
      baseURL: baseUrl.replace(/\/+$/, ''),
      headers: { Authorization: `Bearer ${apiKey}` }
    })
  }

  async createMedium(input: CreateMediumInput): Promise<any> {
    const { data } = await this.http.post('/onboarding/create-medium', {
      medium_name: input.medium_name,
      has_staging: input.has_staging ?? false,
      website_enabled: input.website_enabled ?? true,
      custom_website_hostnames: input.custom_website_hostnames ?? []
    })
    return data
  }

  async getOnboardingStatus(mediumName: string): Promise<any> {
    const { data } = await this.http.get(
      `/onboarding/status/${encodeURIComponent(mediumName)}`
    )
    return data
  }

  async cancelOnboarding(mediumName: string): Promise<any> {
    const { data } = await this.http.delete(
      `/onboarding/cancel/${encodeURIComponent(mediumName)}`
    )
    return data
  }

  async getConfiguration(): Promise<any> {
    const { data } = await this.http.get('/configuration')
    return data
  }

  async getPendingPrs(): Promise<any> {
    const { data } = await this.http.get('/configuration/pending-prs')
    return data
  }

  async getMediaHealth(): Promise<any> {
    const { data } = await this.http.get('/media-health')
    return data
  }

  async getMediumHealth(mediumName: string): Promise<any> {
    const { data } = await this.http.get(
      `/media-health/${encodeURIComponent(mediumName)}`
    )
    return data
  }

  async getReviewInstances(): Promise<any> {
    const { data } = await this.http.get('/review-instances')
    return data
  }

  async getReviewInstancesForMedium(mediumName: string): Promise<any> {
    const { data } = await this.http.get(
      `/review-instances/${encodeURIComponent(mediumName)}`
    )
    return data
  }

  async getDeployments(): Promise<any> {
    const { data } = await this.http.get('/deployments')
    return data
  }
}
