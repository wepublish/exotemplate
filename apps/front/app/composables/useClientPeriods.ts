import type { ClientPeriod } from '~~/types/DirectusTypes'

export const useUseClientPeriods = () => {
  const userStore = useUserStore()

  function getClientPeriodById (id: number | undefined): ClientPeriod | undefined {
    if (!id) {return undefined}

    for (const client of userStore.clients) {
      const foundPeriod = client.periods.find(p => (p as ClientPeriod).id === id)
      if (foundPeriod) return foundPeriod as ClientPeriod
    }
    return undefined
  }
  

  return {
    getClientPeriodById
  }
}
