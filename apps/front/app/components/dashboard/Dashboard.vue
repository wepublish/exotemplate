<script lang="ts" setup>
  import type { EntryGroupsWithSums } from '~~/types/ClockodoTypes'
  import WorkLog from './WorkLog.vue'
  import type { Client, ClientPeriod, Period } from '~~/types/DirectusTypes'
  import ManualWorkEntries from './ManualWorkEntries.vue'

  const userStore = useUserStore()
  const { getCustomEndpoint } = useDirectus()

  const selectedClientId = ref<string | undefined>(undefined)
  const selectedClientPeriodId = ref<number | undefined>(undefined)

  const clients = computed<Client[]>(() => userStore.clients)
  const selectedClient = computed<Client | undefined>(() =>
    clients.value?.find((client) => client.id === selectedClientId.value)
  )

  const clientPeriods = computed<{ id: number; periodName: string | null }[]>(
    () => {
      return ((selectedClient.value?.periods || []) as ClientPeriod[]).map(
        (clientPeriod) => {
          const period = clientPeriod.Periods_id as Period
          return {
            id: clientPeriod.id,
            periodName: period.name
          }
        }
      )
    }
  )

  // auto select first client
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
  const { data: entryGroups, pending } = await useAsyncData(
    dataLoaderKey,
    async () => {
      if (!selectedClientPeriodId.value) {
        return
      }
      return (
        await getCustomEndpoint('aggregatedHours', {
          clientPeriodId: selectedClientPeriodId.value
        })
      ).data as Promise<EntryGroupsWithSums>
    }
  )
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
            class="ml-4"
          />
        </template>
      </UPageCard>
    </div>

    <USkeleton v-if="pending" class="h-16 col-span-12" />

    <!-- budget of client -->
    <div class="col-span-12" v-if="selectedClientPeriodId && !pending">
      <DashboardFinance
        :client-period-id="selectedClientPeriodId"
        :working-sums="entryGroups?.sums"
      />
    </div>

    <!-- clockodo insights -->
    <div class="col-span-12" v-if="selectedClientPeriodId && !pending">
      <WorkLog :entry-groups="entryGroups" />
    </div>

    <!-- manual correction entries -->
    <div class="col-span-12" v-if="selectedClientPeriodId && !pending">
      <ManualWorkEntries :client-period-id="selectedClientPeriodId" />
    </div>
  </div>
</template>
