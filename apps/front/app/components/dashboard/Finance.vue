<script lang="ts" setup>
  import type { Sums } from '~~/types/ClockodoTypes'
  import type {
    ClientPeriod,
    ManualWorkEntry,
    TopUp
  } from '~~/types/DirectusTypes'

  interface HoursCalculated {
    totalHours: number
    hoursClient: number
    hoursWep: number
  }

  type TopUpsCalculated = TopUp & HoursCalculated

  const clientPeriodComp = useUseClientPeriods()
  const manualWorkComp = useManualWorkEntries()
  const topUpsComp = useTopUps()
  const userStore = useUserStore()

  const props = defineProps<{
    clientPeriodId: number | undefined
    workingSums: Sums | undefined
  }>()

  const selectedClientPeriod = computed<ClientPeriod | undefined>(() =>
    clientPeriodComp.getClientPeriodById(props.clientPeriodId)
  )

  const topUps = computed<TopUp[]>(
    () => (selectedClientPeriod.value?.topUps || []) as TopUp[]
  )

  const topUpsCalculated = computed<TopUpsCalculated[]>(() =>
    topUps.value.map((topUp) => {
      const totalHours =
        Math.round(((topUp.amount || 0) / topUp.hourlyRate) * 2) / 2

      const hoursClient =
        Math.round(
          (totalHours * (100 - (topUp.wepPercentage || 0))) / 100 / 0.25
        ) * 0.25
      const hoursWep = totalHours - hoursClient
      return {
        ...topUp,
        totalHours,
        hoursClient,
        hoursWep
      }
    })
  )

  const topUpsForTable = computed(() =>
    topUpsCalculated.value.map((topUp) => {
      return {
        Datum: new Date(topUp.date_created as string).toLocaleDateString('de', {
          dateStyle: 'medium'
        }),
        Notiz: topUp.note || ' - ',
        Betrag: `CHF ${topUp.amount}`,
        Satz: `${topUp.hourlyRate} chf / h`,
        Total: `${topUp.totalHours} h`,
        WePublish: `${topUp.hoursWep} h`,
        Medium: `${topUp.hoursClient} h`,
        Bexio: topUp.bexioInvoiceId
      }
    })
  )

  const totalTopUpHours = computed<HoursCalculated>(() => {
    return topUpsCalculated.value.reduce(
      (acc, curr) => {
        return {
          totalHours: acc.totalHours + curr.totalHours,
          hoursClient: acc.hoursClient + curr.hoursClient,
          hoursWep: acc.hoursWep + curr.hoursWep
        }
      },
      { totalHours: 0, hoursClient: 0, hoursWep: 0 }
    )
  })

  const totalManualWorkHours = computed<number>(() =>
    manualWorkComp.getSumByClientPeriod(
      (selectedClientPeriod.value?.manualWorkEntries || []) as ManualWorkEntry[]
    )
  )
  const totalUsedHours = computed<number>(
    () => (props.workingSums?.billableHours || 0) + totalManualWorkHours.value
  )
  const availableHours = computed<number>(
    () => totalTopUpHours.value.hoursClient - totalUsedHours.value
  )
  const hoursUsedPercentage = computed<number>(
    () => (totalUsedHours.value * 100) / totalTopUpHours.value.hoursClient
  )
</script>

<template>
  <div class="grid grid-cols-12 gap-4">
    <!-- progress -->
    <UPageCard class="col-span-12">
      <template #default v-if="selectedClientPeriod">
        <div class="flex justify-between w-full">
          <div class="font-bold">Verfügbare Arbeitsstunden</div>
          <div
            class="font-bold text-4xl"
            :class="availableHours <= 0 ? 'text-error' : 'text-primary'"
          >
            {{ availableHours }} h
          </div>
        </div>

        <div class="grid grid-cols-12 gap-16">
          <div class="col-span-6 flex text-sm mt-4">
            <div class="flex-1">
              <p>Zahlungen / Top-Ups</p>
              <p>Arbeitsprotokoll</p>
              <p class="border-b">Manuelle Korrekturen</p>
              <p class="font-bold pt-1">Verfügbar</p>
            </div>
            <div class="text-right">
              <p>{{ totalTopUpHours.hoursClient }} h</p>
              <p>- {{ props.workingSums?.billableHours || 0 }} h</p>
              <p class="border-b">- {{ totalManualWorkHours }} h</p>
              <p class="font-bold pt-1">{{ availableHours }} h</p>
            </div>
          </div>
          <UProgress
            :model-value="hoursUsedPercentage"
            status
            size="2xl"
            class="col-span-6"
            :color="hoursUsedPercentage >= 100 ? 'error' : 'primary'"
          >
            <template #status>
              {{ totalUsedHours }} / {{ totalTopUpHours.hoursClient }} h
            </template>
          </UProgress>

          <!-- create bexio invoice -->
          <div v-if="userStore.amIAdministrator()" class="col-span-12 text-end">
            <UButton
              :to="`/${clientPeriodId}/create-bexio-invoice?amount=${availableHours * -1}`"
              variant="subtle"
            >
              Bexio-Rechnung generieren
            </UButton>
          </div>
        </div>
      </template>
    </UPageCard>

    <!-- top ups -->
    <UPageCard class="col-span-12">
      <template #default>
        <div class="flex justify-between w-full">
          <div class="font-bold">Zahlungen / Top-Ups</div>
          <div
            v-if="selectedClientPeriod"
            class="font-bold text-4xl text-primary"
          >
            {{ totalTopUpHours.hoursClient }} h
          </div>
        </div>
        <UTable :data="topUpsForTable">
          <template #Bexio-cell="{ row }">
            <UButton
              v-if="row.original.Bexio"
              :href="topUpsComp.getBexioInvoiceUrl(row.original.Bexio)"
              target="_blank"
              trailing-icon="material-symbols:open-in-new-rounded"
              variant="link"
            >
              Nr. {{ row.original.Bexio }}
            </UButton>
          </template>
        </UTable>
      </template>
    </UPageCard>
  </div>
</template>
