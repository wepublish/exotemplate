<script lang="ts" setup>
  import type { EntryGroupComputed } from '~~/types/ClockodoTypes'
  import WorkLog from './WorkLog.vue'
  import type {
    Client,
    ClientPeriod,
    JiraWarning,
    Period
  } from '~~/types/DirectusTypes'
  import type { WarningAction } from '~/components/warnings/WarningActions.vue'
  import ManualWorkEntries from './ManualWorkEntries.vue'

  const userStore = useUserStore()
  const { getCustomEndpoint } = useDirectus()
  const { listForClients, isHalted } = useJiraWarnings()
  const route = useRoute()
  const router = useRouter()

  const allWarnings = ref<JiraWarning[]>([])

  const {
    pendingActionFor,
    dispatchAction,
    haltConfirmWarning,
    confirmHalt,
    cancelHaltConfirmation
  } = useWarningActionRunner({
    onUpdate: (updated) => {
      const index = allWarnings.value.findIndex((w) => w.id === updated.id)
      if (index !== -1) allWarnings.value[index] = updated
    }
  })

  const selectedClientId = ref<string | undefined>(
    (route.query.clientId as string) || undefined
  )
  const selectedClientPeriodId = ref<number | undefined>(
    route.query.clientPeriodId ? Number(route.query.clientPeriodId) : undefined
  )

  /**
   * Jira issue key to drill into on arrival (e.g. when a user clicks the
   * "Im Dashboard ansehen" button in a Slack halt notification). The
   * WorkLog uses this to push the parent group onto its navigation stack
   * and scroll to the row.
   */
  const focusIssueKey = computed<string | undefined>(() =>
    typeof route.query.issue === 'string' ? route.query.issue : undefined
  )

  // sync selections to URL query params — preserve any query params we
  // don't own (e.g. `issue` for deep-linking into the Arbeitsprotokoll).
  watch(
    [selectedClientId, selectedClientPeriodId],
    ([clientId, clientPeriodId]) => {
      const { clientId: _a, clientPeriodId: _b, ...rest } = route.query
      router.replace({
        query: {
          ...rest,
          ...(clientId ? { clientId } : {}),
          ...(clientPeriodId ? { clientPeriodId: String(clientPeriodId) } : {})
        }
      })
    }
  )

  const clients = computed<Client[]>(() => userStore.clients)
  const selectedClient = computed<Client | undefined>(() =>
    clients.value?.find((client) => client.id === selectedClientId.value)
  )

  const clientPeriods = computed<
    {
      id: number
      periodName: string | null
      from: string
      to: string
    }[]
  >(() => {
    return ((selectedClient.value?.periods || []) as ClientPeriod[]).map(
      (clientPeriod) => {
        const period = clientPeriod.Periods_id as Period
        return {
          id: clientPeriod.id,
          periodName: period.name,
          from: period.from,
          to: period.to
        }
      }
    )
  })

  const selectedPeriod = computed(() => {
    if (!selectedClientPeriodId.value) return undefined
    return clientPeriods.value.find(
      (period) => period.id === selectedClientPeriodId.value
    )
  })

  // auto select period with the most recent 'from' date when none is pre-selected via URL
  watch(
    clientPeriods,
    (periods) => {
      if (!selectedClientPeriodId.value && periods.length) {
        const newest = periods.reduce((a, b) => (a.from >= b.from ? a : b))
        selectedClientPeriodId.value = newest.id
      }
    },
    { immediate: true }
  )

  // auto select first client only when no clientId is in the URL
  watch(
    clients,
    () => {
      if (!selectedClientId.value && clients.value.length) {
        selectedClientId.value = clients.value[0]?.id
      }
    },
    { immediate: true }
  )

  watch(
    () => clients.value.map((c) => c.id).join(','),
    async () => {
      const ids = clients.value.map((c) => c.id)
      if (!ids.length) {
        allWarnings.value = []
        return
      }
      try {
        allWarnings.value = await listForClients(ids)
      } catch {
        allWarnings.value = []
      }
    },
    { immediate: true }
  )

  function warningClientId(warning: JiraWarning): string | null {
    const ref = warning.client
    if (!ref) return null
    return typeof ref === 'string' ? ref : (ref.id ?? null)
  }

  const haltsForSelected = computed<JiraWarning[]>(() => {
    if (!selectedClientId.value) return []
    return allWarnings.value.filter(
      (w) => isHalted(w) && warningClientId(w) === selectedClientId.value
    )
  })

  const haltsForOtherClients = computed<JiraWarning[]>(() =>
    allWarnings.value.filter(
      (w) => isHalted(w) && warningClientId(w) !== selectedClientId.value
    )
  )

  const haltedOtherClientCount = computed<number>(() => {
    const ids = new Set<string>()
    for (const w of haltsForOtherClients.value) {
      const id = warningClientId(w)
      if (id) ids.add(id)
    }
    return ids.size
  })

  const haltedIssueKeysForSelected = computed<Set<string>>(
    () => new Set(haltsForSelected.value.map((w) => w.jira_issue_key))
  )

  /**
   * Every JiraWarning that belongs to the currently selected client, indexed
   * by its Jira issue key so the Arbeitsprotokoll table can attach the halt /
   * silence actions to the matching rows.
   */
  const warningsByIssueKeyForSelected = computed<Map<string, JiraWarning>>(
    () => {
      const map = new Map<string, JiraWarning>()
      if (!selectedClientId.value) return map
      for (const warning of allWarnings.value) {
        if (warningClientId(warning) !== selectedClientId.value) continue
        map.set(warning.jira_issue_key, warning)
      }
      return map
    }
  )

  const dataLoaderKey = computed<string>(
    () => `clientPeriodId-${selectedClientPeriodId.value}`
  )
  const {
    data: computedEntryGroups,
    pending,
    error
  } = await useAsyncData(dataLoaderKey, async () => {
    if (!selectedClientPeriodId.value) {
      return
    }

    try {
      const response = await getCustomEndpoint('aggregatedHours', {
        clientPeriodId: selectedClientPeriodId.value
      })
      return response.data as EntryGroupComputed
    } catch (err: any) {
      const firstError = err.response?.data?.errors?.[0]
      throw new Error(firstError.message)
    }
  })
</script>

<template>
  <div class="grid grid-cols-12 gap-4">
    <div class="col-span-12">
      <UPageCard>
        <template #title> Projekt und Abrechnungsperiode wählen </template>
        <template #body>
          <USelectMenu
            v-model="selectedClientId"
            size="xl"
            :items="clients"
            value-key="id"
            label-key="name"
            placeholder="Projekt wählen"
            class="min-w-60"
            @change="() => (selectedClientPeriodId = undefined)"
          />

          <USelectMenu
            v-model="selectedClientPeriodId"
            :disabled="!selectedClientId"
            size="xl"
            :items="clientPeriods"
            value-key="id"
            label-key="periodName"
            placeholder="Zeitraum wählen"
            class="min-w-60 ml-4"
          />
        </template>
      </UPageCard>
    </div>

    <UAlert
      v-if="haltsForOtherClients.length"
      color="error"
      variant="soft"
      icon="material-symbols:stop-circle-rounded"
      class="col-span-12"
    >
      <template #title>
        {{ haltsForOtherClients.length }}
        {{
          haltsForOtherClients.length === 1 ? 'Arbeitsstopp' : 'Arbeitsstopps'
        }}
        bei {{ haltedOtherClientCount }}
        {{ haltedOtherClientCount === 1 ? 'anderem' : 'anderen' }} Kunden
      </template>
      <template #description>
        Wechsle oben das Projekt, um die betroffenen Tickets im Arbeitsprotokoll
        zu sehen und den Stopp aufzuheben.
      </template>
    </UAlert>

    <USkeleton v-if="pending" class="h-16 col-span-12" />

    <UAlert
      v-if="error"
      title="Beim Abrufen der Daten ist ein Fehler aufgetreten."
      :description="error.message"
      color="error"
      variant="soft"
      class="col-span-12"
      icon="i-heroicons-exclamation-triangle"
    />

    <!-- budget of client -->
    <div
      class="col-span-12"
      v-if="selectedClientPeriodId && !pending && !error"
    >
      <DashboardFinance
        :client-period-id="selectedClientPeriodId"
        :sums="computedEntryGroups?.sums"
        :period-from="selectedPeriod?.from"
        :period-to="selectedPeriod?.to"
      />
    </div>

    <!-- clockodo insights -->
    <div
      class="col-span-12"
      v-if="selectedClientPeriodId && !pending && !error"
    >
      <WorkLog
        :entry-groups="computedEntryGroups"
        :halted-issue-keys="haltedIssueKeysForSelected"
        :warnings-by-issue-key="warningsByIssueKeyForSelected"
        :client-id="selectedClientId"
        :focus-issue-key="focusIssueKey"
        :pending-action-for="pendingActionFor"
        @dispatch-warning-action="
          (w: JiraWarning, a: WarningAction) => dispatchAction(w, a)
        "
      />
    </div>

    <!-- manual correction entries -->
    <div
      class="col-span-12"
      v-if="selectedClientPeriodId && !pending && !error"
    >
      <ManualWorkEntries
        :client-period-id="selectedClientPeriodId"
        :sums="computedEntryGroups?.sums"
      />
    </div>
  </div>

  <WarningsHaltConfirmDialog
    :warning="haltConfirmWarning"
    @confirm="confirmHalt"
    @cancel="cancelHaltConfirmation"
  />
</template>
