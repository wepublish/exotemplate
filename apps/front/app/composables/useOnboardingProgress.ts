import { readItems, updateItem, type QueryFilter } from '@directus/sdk'
import type { Client } from '~~/types/DirectusTypes'

const CLIENT_FIELDS = [
  'id',
  'name',
  'status',
  'jira_short_code',
  'bexio_contact_id',
  'clockodo_customer_id',
  'slack_channel_id',
  'apiUrl',
  'onboarding_current_step',
  'onboarding_manual_checklist',
  'date_created',
  'date_updated'
]

export const ONBOARDING_STEP_COUNT = 8

export function useOnboardingProgress() {
  const directusStore = useDirectus()

  async function fetchAllClients(): Promise<Client[]> {
    const result = await directusStore.directus.request(
      readItems('Clients', {
        fields: CLIENT_FIELDS as any,
        filter: {
          status: { _neq: 'archived' }
        } as QueryFilter<any, any>,
        sort: ['name']
      })
    )
    return result as unknown as Client[]
  }

  async function fetchClient(clientId: string): Promise<Client | null> {
    const result = await directusStore.directus.request(
      readItems('Clients', {
        fields: CLIENT_FIELDS as any,
        filter: { id: { _eq: clientId } } as QueryFilter<any, any>,
        limit: 1
      })
    )
    const list = result as unknown as Client[]
    return list[0] ?? null
  }

  async function updateClientOnboarding(
    clientId: string,
    patch: Partial<Client>
  ): Promise<Client> {
    const result = await directusStore.directus.request(
      updateItem('Clients', clientId, patch as any)
    )
    return result as unknown as Client
  }

  return {
    fetchAllClients,
    fetchClient,
    updateClientOnboarding
  }
}

/**
 * Derives the 8-element step status array from a Client record.
 *
 * Step indices:
 *   0 Directus              → client record exists
 *   1 Jira                  → jira_short_code is set
 *   2 Slack                 → slack_channel_id is set
 *   3 Bexio                 → bexio_contact_id is set
 *   4 Clockodo              → clockodo_customer_id is set
 *   5 Infrastruktur         → apiUrl is set
 *   6 Manuelle Schritte     → onboarding_current_step > 6
 *   7 E-Mail                → onboarding_current_step > 7
 */
export type StepStatus = 'pending' | 'active' | 'completed' | 'error'

export function deriveStepStatuses(
  client: Pick<
    Client,
    | 'id'
    | 'jira_short_code'
    | 'bexio_contact_id'
    | 'clockodo_customer_id'
    | 'slack_channel_id'
    | 'apiUrl'
    | 'onboarding_current_step'
  > | null
): StepStatus[] {
  const s = Array<StepStatus>(ONBOARDING_STEP_COUNT).fill('pending')
  if (!client) return s
  const step = client.onboarding_current_step ?? 0

  if (client.id) s[0] = 'completed'
  if (client.jira_short_code) s[1] = 'completed'
  if (client.slack_channel_id) s[2] = 'completed'
  if (client.bexio_contact_id) s[3] = 'completed'
  if (client.clockodo_customer_id) s[4] = 'completed'
  if (client.apiUrl) s[5] = 'completed'
  if (step > 6) s[6] = 'completed'
  if (step > 7) s[7] = 'completed'
  return s
}

/** Returns the index of the first non-completed step (or last index if all done). */
export function deriveCurrentStep(statuses: StepStatus[]): number {
  const first = statuses.findIndex((s) => s !== 'completed')
  return first === -1 ? statuses.length - 1 : first
}

export function isOnboardingComplete(statuses: StepStatus[]): boolean {
  return statuses.every((s) => s === 'completed')
}
