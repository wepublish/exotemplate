<script lang="ts" setup>
  import type { Sums } from '~~/types/ClockodoTypes'

  const topUpsComp = useTopUps()
  const userStore = useUserStore()

  const props = defineProps<{
    clientPeriodId: number | undefined
    sums: Sums | undefined
  }>()

  const topUpsForTable = computed(() =>
    props.sums?.computedTopUps.map((topUp) => {
      return {
        Datum: new Date(topUp.date_created as string).toLocaleDateString('de', {
          dateStyle: 'medium'
        }),
        Notiz: topUp.note || ' - ',
        Betrag: `CHF ${topUp.amount}`,
        Satz: `${topUp.hourlyRate} chf / h`,
        Total: `${topUp.paidHours} h`,
        WePublish: `${topUp.wepHours} h`,
        Medium: `${topUp.clientHours} h`,
        Bexio: topUp.bexioInvoiceId
      }
    })
  )
</script>

<template>
  <div class="grid grid-cols-12 gap-4">
    <!-- progress -->
    <UPageCard class="col-span-12">
      <template #default v-if="sums">
        <div class="flex justify-between w-full">
          <div class="font-bold">Verfügbare Arbeitsstunden</div>
          <div
            class="font-bold text-4xl"
            :class="
              sums.totalAvailableHours <= 0 ? 'text-error' : 'text-primary'
            "
          >
            {{ sums.totalAvailableHours }} h
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
              <p>{{ sums.totalTopUps }} h</p>
              <p>- {{ sums.billableHours }} h</p>
              <p class="border-b">- {{ sums.totalManualWorkHours }} h</p>
              <p class="font-bold pt-1">{{ sums.totalAvailableHours }} h</p>
            </div>
          </div>
          <UProgress
            :model-value="sums.totalUsedPercentage"
            status
            size="2xl"
            class="col-span-6"
            :color="sums.totalUsedPercentage >= 100 ? 'error' : 'primary'"
          >
            <template #status>
              {{ sums.totalUsedHours }} / {{ sums.totalTopUps }} h
            </template>
          </UProgress>

          <!-- create bexio invoice -->
          <div v-if="userStore.amIAdministrator()" class="col-span-12 text-end">
            <UButton
              :to="`/${clientPeriodId}/create-bexio-invoice?amount=${sums.totalAvailableHours * -1}`"
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
          <div v-if="sums" class="font-bold text-4xl text-primary">
            {{ sums.totalTopUps }} h
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
