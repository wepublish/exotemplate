<script lang="ts" setup>
  import type { ClientPeriod, TopUp } from '~~/types/DirectusTypes'

  interface HoursCalculated {
    totalHours: number,
    hoursClient: number,
    hoursWep: number
  }

  type TopUpsCalculated = TopUp & HoursCalculated

  const userStore = useUserStore()

  const props = defineProps<{
    clientPeriodId: number | undefined
    workedHours: number | undefined
  }>()

  const selectedClientPeriod = computed<ClientPeriod | undefined>(() => {
    if (!props.clientPeriodId) return undefined

    for (const client of userStore.clients) {
      const foundPeriod = client.periods.find(p => (p as ClientPeriod).id === props.clientPeriodId)
      if (foundPeriod) return foundPeriod as ClientPeriod
    }
    return undefined
  })

  const topUps = computed<TopUp[]>(() => (selectedClientPeriod.value?.topUps || []) as TopUp[])

  const topUpsCalculated = computed<TopUpsCalculated[]>(() => topUps.value.map(topUp => {
    const totalHours = Math.round((topUp.amount / topUp.hourlyRate) * 2) / 2
    const hoursClient = Math.round((totalHours * ((100 - (topUp.wepPercentage || 0)) / 100))* 2) / 2
    const hoursWep = totalHours - hoursClient
    return {
      ...topUp,
      totalHours,
      hoursClient,
      hoursWep
    }
  }))

  const topUpsForTable = computed(() => topUpsCalculated.value.map(topUp => {
    return {
      Datum: new Date(topUp.date_created as string).toLocaleDateString('de', {dateStyle: 'medium'}),
      Notiz: topUp.note || ' - ',
      Betrag: `CHF ${topUp.amount}`,
      Satz: `${topUp.hourlyRate} chf / h`,
      'Total': `${topUp.totalHours} h`,
      'WePublish': `${topUp.hoursWep} h`,
      'Medium': `${topUp.hoursClient} h`
    }
  }))

  const totalHours = computed<HoursCalculated>(() => {
    return topUpsCalculated.value.reduce((acc, curr) => {
      return {
        totalHours: acc.totalHours + curr.totalHours,
        hoursClient: acc.hoursClient + curr.hoursClient,
        hoursWep: acc.hoursWep + curr.hoursWep
      }
        }, { totalHours: 0, hoursClient: 0, hoursWep: 0 })
  })

  const hoursUsedPercentage = computed<number>(() => Math.round((props.workedHours || 0) * 100 / totalHours.value.hoursClient))

</script>

<template>
  <div class="flex gap-4">
    <!-- top ups -->
    <UPageCard>
      <template #body>
        <div class="flex justify-between w-full px-4">
          <div>Top-Ups</div>
          <div v-if="selectedClientPeriod" class="font-bold text-4xl text-primary">{{ (totalHours.hoursClient) }} h</div>
        </div>
        <UTable :data="topUpsForTable" />
      </template>
    </UPageCard>

    <!-- progress -->
     <UPageCard class="flex-1">
      <template #header>
        Arbeitsfortschritt
      </template>
      <template #body v-if="selectedClientPeriod">
        <UBanner v-if="hoursUsedPercentage >= 100" color="error" icon="i-material-symbols:exclamation" title="Stunden überzogen" />
        <UProgress :model-value="hoursUsedPercentage" status size="2xl" class="w-100 mt-4" :color="hoursUsedPercentage >= 100 ? 'error' : 'primary'">
          <template #status>
            {{ props.workedHours }} / {{ totalHours.hoursClient }} Stunden
          </template>
        </UProgress>
      </template>
     </UPageCard>
  </div>
</template>