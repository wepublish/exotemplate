<script lang="ts" setup>
  import type { EntryGroupComputed } from '~~/types/ClockodoTypes'
  import WorkLog from './WorkLog.vue'
  import type { Client, ClientPeriod, Period } from '~~/types/DirectusTypes'
  import ManualWorkEntries from './ManualWorkEntries.vue'

  const userStore = useUserStore()
  const { getCustomEndpoint } = useDirectus()
  const route = useRoute()
  const router = useRouter()

  const selectedClientId = ref<string | undefined>(
    (route.query.clientId as string) || undefined
  )
  const selectedClientPeriodId = ref<number | undefined>(
    route.query.clientPeriodId ? Number(route.query.clientPeriodId) : undefined
  )

  // sync selections to URL query params
  watch(
    [selectedClientId, selectedClientPeriodId],
    ([clientId, clientPeriodId]) => {
      router.replace({
        query: {
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
    { id: number; periodName: string | null; from: string }[]
  >(() => {
    return ((selectedClient.value?.periods || []) as ClientPeriod[]).map(
      (clientPeriod) => {
        const period = clientPeriod.Periods_id as Period
        return {
          id: clientPeriod.id,
          periodName: period.name,
          from: period.from
        }
      }
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
      />
    </div>

    <!-- clockodo insights -->
    <div
      class="col-span-12"
      v-if="selectedClientPeriodId && !pending && !error"
    >
      <WorkLog :entry-groups="computedEntryGroups" />
    </div>

    <!-- manual correction entries -->
    <div
      class="col-span-12"
      v-if="selectedClientPeriodId && !pending && !error"
    >
      <ManualWorkEntries :client-period-id="selectedClientPeriodId" />
    </div>
  </div>
</template>
