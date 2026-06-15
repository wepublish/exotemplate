import type { Client, ClientPeriod, Period } from '~~/types/DirectusTypes'

/**
 * App-wide "current client / billing period" selection.
 *
 * The **single source of truth is the URL**: every app route is prefixed with
 * `/:clientPeriodId` (see the `pages:extend` hook in nuxt.config.ts), so this
 * store simply *derives* the selection from `route.params.clientPeriodId`. There
 * is no writable selection state — to change the selection you navigate (the
 * `ClientPeriodSelector` swaps the path segment). This keeps the selection in
 * the URL on every page, never lost on navigation, and shareable/reloadable.
 *
 * The only persisted bit is the *last-used* period id (localStorage), used to
 * pick a sensible default when landing on the bare `/` root.
 */
const LAST_USED_KEY = 'wep-one:last-client-period'

export interface SelectablePeriod {
  id: number
  periodName: string | null
  from: string
  to: string
}

export const useClientSelection = defineStore('useClientSelection', () => {
  const userStore = useUserStore()
  const route = useRoute()

  const clients = computed<Client[]>(() => userStore.clients)

  const selectedClientPeriodId = computed<number | undefined>(() => {
    const raw = route.params.clientPeriodId
    if (raw == null || raw === '') return undefined
    const id = Number(raw)
    return Number.isFinite(id) ? id : undefined
  })

  function periodsOf(client: Client | undefined): ClientPeriod[] {
    return (client?.periods || []) as ClientPeriod[]
  }

  const selectedClient = computed<Client | undefined>(() => {
    const id = selectedClientPeriodId.value
    if (!id) return undefined
    return clients.value.find((client) =>
      periodsOf(client).some((cp) => cp.id === id)
    )
  })

  const selectedClientId = computed<string | undefined>(
    () => selectedClient.value?.id
  )

  const clientPeriods = computed<SelectablePeriod[]>(() =>
    periodsOf(selectedClient.value).map((clientPeriod) => {
      const period = clientPeriod.Periods_id as Period
      return {
        id: clientPeriod.id,
        periodName: period.name,
        from: period.from,
        to: period.to
      }
    })
  )

  const selectedPeriod = computed<SelectablePeriod | undefined>(() =>
    clientPeriods.value.find(
      (period) => period.id === selectedClientPeriodId.value
    )
  )

  /** Newest period id of an arbitrary client — used by the selector to navigate
   *  to a sensible period when the client is switched. */
  function newestPeriodIdForClient(clientId: string): number | undefined {
    const list = periodsOf(clients.value.find((c) => c.id === clientId))
    if (!list.length) return undefined
    return list.reduce((a, b) =>
      ((a.Periods_id as Period)?.from ?? '') >=
      ((b.Periods_id as Period)?.from ?? '')
        ? a
        : b
    ).id
  }

  function isValidClientPeriodId(id: number | undefined): boolean {
    if (!id) return false
    return clients.value.some((client) =>
      periodsOf(client).some((cp) => cp.id === id)
    )
  }

  /** Best default period for the bare `/` root: the last-used one if it's still
   *  valid, otherwise the newest period of the first client. */
  function defaultClientPeriodId(): number | undefined {
    if (import.meta.client) {
      try {
        const stored = Number(window.localStorage.getItem(LAST_USED_KEY))
        if (isValidClientPeriodId(stored)) return stored
      } catch {
        // ignore unavailable/blocked storage
      }
    }
    const first = clients.value[0]
    return first ? newestPeriodIdForClient(first.id) : undefined
  }

  // Remember the last valid selection so a later visit to `/` resumes it.
  if (import.meta.client) {
    watch(selectedClientPeriodId, (id) => {
      if (!id) return
      try {
        window.localStorage.setItem(LAST_USED_KEY, String(id))
      } catch {
        // ignore unavailable/blocked storage
      }
    })
  }

  return {
    clients,
    selectedClientPeriodId,
    selectedClientId,
    selectedClient,
    clientPeriods,
    selectedPeriod,
    newestPeriodIdForClient,
    isValidClientPeriodId,
    defaultClientPeriodId
  }
})
