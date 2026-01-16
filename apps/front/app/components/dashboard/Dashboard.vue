<script lang="ts" setup>
  import type { Client, ClientPeriod, Period } from '~~/types/DirectusTypes'

  const userStore = useUserStore()

  const selectedClientId = ref<string | undefined>(undefined)
  const selectedClientPeriodId = ref<number |undefined>(undefined)
    const selectedClientPeriod = computed<ClientPeriod | undefined>(() => ((selectedClient.value?.periods || []) as ClientPeriod[]).find(period => period.id === selectedClientPeriodId.value))

  const clients = computed<Client[]>(() => userStore.clients)
  const selectedClient = computed<Client | undefined>(() => clients.value?.find(client => client.id === selectedClientId.value))  

  const clientPeriods = computed<{id: number, periodName: string | null}[]>(() => {
    return ((selectedClient.value?.periods || []) as ClientPeriod[]).map(clientPeriod => {
      const period = clientPeriod.Periods_id as Period
      return {
        id: clientPeriod.id,
        periodName: period.name,
      }
    })
  })

  // auto select first client
  watch(
    clients,
    () => {
      if (!selectedClientId.value && clients.value.length) {
        selectedClientId.value = clients.value[0]?.id
      }
    },
    {immediate: true}
  )

</script>

<template>
  <div class="grid grid-cols-12 gap-4">
    <div class="col-span-12">
      <UPageCard>
        <template #header>
          Projekt und Abrechnungsperiode wählen
        </template>
        <template #body>
          <USelectMenu
            v-model="selectedClientId"
            size="xl"
            :items="clients"
            value-key="id"
            label-key="name"
            placeholder="Projekt wählen"
            @change="() => selectedClientPeriodId = undefined"  
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

    <!-- budget of client -->
    <div class="col-span-12">
      <DashboardFinance :client-period-id="selectedClientPeriodId" :worked-hours="25.5" />
    </div>

    <!-- clockodo insights -->
    <div class="col-span-12">
      <DashboardClockodo
        v-if="selectedClientPeriod"
        :clockodo-customer-id="selectedClient?.clockodo_customer_id"
        :from="(selectedClientPeriod?.Periods_id as Period).from"
        :to="(selectedClientPeriod?.Periods_id as Period).to"
      />
    </div>
  </div>
</template>