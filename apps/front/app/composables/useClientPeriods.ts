import { createItem, readItems } from '@directus/sdk'
import type { ClientPeriod, Period } from '~~/types/DirectusTypes'

export const useUseClientPeriods = () => {
  const userStore = useUserStore()
  const { directus } = useDirectus()

  function getClientPeriodById(
    id: number | undefined
  ): ClientPeriod | undefined {
    if (!id) {
      return undefined
    }

    for (const client of userStore.clients) {
      const foundPeriod = client.periods.find(
        (p) => (p as ClientPeriod).id === id
      )
      if (foundPeriod) return foundPeriod as ClientPeriod
    }
    return undefined
  }

  /**
   * All shared period definitions (the `Periods` collection, e.g. "1. Halbjahr
   * 2026"), newest first. A definition is linked to a client to form a billing
   * period (`Clients_Periods`).
   */
  async function fetchPeriodDefinitions(): Promise<Period[]> {
    return (await directus.request(
      readItems('Periods', {
        filter: { status: { _neq: 'archived' } } as any,
        sort: ['-from'],
        limit: -1
      })
    )) as Period[]
  }

  /**
   * Creates a billing period for a client by linking it to a period definition
   * (`Clients_Periods` junction row). Returns the new junction row, whose
   * numeric `id` is the `clientPeriodId` the rest of the app keys on.
   */
  async function createClientPeriod(
    clientId: string,
    periodId: string
  ): Promise<ClientPeriod> {
    return (await directus.request(
      createItem('Clients_Periods', {
        Clients_id: clientId,
        Periods_id: periodId
      } as any)
    )) as ClientPeriod
  }

  return {
    getClientPeriodById,
    fetchPeriodDefinitions,
    createClientPeriod
  }
}
