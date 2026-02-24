<script lang="ts" setup>
  import type { Sums } from '~~/types/ClockodoTypes'

  const topUpsComp = useTopUps()
  const userStore = useUserStore()

  const props = defineProps<{
    clientPeriodId: number | undefined
    sums: Sums | undefined
  }>()

  const showTopUpsModal = ref(false)
  const showTopUpsTableSlideover = ref(false)

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

  const progressColor = computed<string>(() => {
    const sums = props.sums?.totalUsedPercentage || 0
    if (sums >= 90) {
      return 'error'
    }
    if (sums >= 75) {
      return 'warning'
    }
    return 'primary'
  })
</script>

<template>
  <div class="grid grid-cols-12 gap-4">
    <UPageCard class="col-span-6">
      <template #default v-if="sums">
        <div class="flex flex-col justify-between h-full w-full">
          <div class="flex justify-between w-full">
            <div class="font-bold">Zahlungen / Top-Ups</div>
            <div class="font-bold text-4xl text-primary">
              {{ sums.totalTopUps }} h
            </div>
          </div>
          <div class="flex justify-end w-full">
            <UButton
              variant="subtle"
              icon="ic:twotone-search"
              @click="showTopUpsTableSlideover = true"
              >Details anzeigen</UButton
            >
          </div>
        </div>
      </template>
    </UPageCard>

    <UPageCard class="col-span-6">
      <template #default v-if="sums">
        <div class="flex justify-between w-full">
          <div class="font-bold">Verfügbare Arbeitsstunden</div>
          <div class="font-bold text-4xl" :class="`text-${progressColor}`">
            {{ sums.totalAvailableHours }} h
          </div>
        </div>

        <div>
          <UProgress
            :model-value="sums.totalUsedPercentage"
            status
            size="2xl"
            class="col-span-6"
            :color="progressColor"
          >
            <template #status>
              <p :class="`text-${progressColor}`">
                {{ sums.totalUsedPercentage }} %
              </p>
            </template>
          </UProgress>
        </div>

        <div class="flex justify-end w-full pt-6">
          <UButton
            variant="subtle"
            icon="ic:twotone-search"
            @click="showTopUpsModal = true"
            >Details anzeigen</UButton
          >
        </div>
      </template>
    </UPageCard>

    <!-- top-ups table slideover -->
    <USlideover
      v-model:open="showTopUpsTableSlideover"
      side="right"
      title="Zahlungen / Top-Ups"
      :ui="{ content: 'max-w-2/3' }"
    >
      <template #body>
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

        <div
          v-if="userStore.amIAdministrator()"
          class="flex justify-center w-full pt-6"
        >
          <UButton
            :to="`/${clientPeriodId}/create-bexio-invoice?amount=0`"
            variant="outline"
            icon="material-symbols:add-notes"
          >
            Bexio-Rechnung generieren
          </UButton>
        </div>
      </template>
    </USlideover>

    <!-- available hours details slideover -->
    <USlideover
      v-model:open="showTopUpsModal"
      side="right"
      title="Details: Verfügbare Arbeitsstunden"
      :ui="{ content: 'max-w-md' }"
    >
      <template #body>
        <div v-if="sums" class="flex text-sm">
          <div class="flex-1">
            <p>Zahlungen / Top-Ups</p>
            <p>Arbeitsprotokoll</p>
            <p class="border-b">Manuelle Korrekturen</p>
            <p class="font-bold pt-1">Verfügbar</p>
          </div>
          <div class="text-right">
            <p>{{ sums.totalTopUps }} h</p>
            <p>- {{ sums.billableHours }} h</p>
            <p class="border-b">
              {{
                sums.totalManualWorkHours < 0
                  ? `+ ${sums.totalManualWorkHours * -1}`
                  : `- ${sums.totalManualWorkHours}`
              }}
              h
            </p>
            <p class="font-bold pt-1">{{ sums.totalAvailableHours }} h</p>
          </div>
        </div>
        <div
          v-if="userStore.amIAdministrator()"
          class="flex justify-center w-full pt-6"
        >
          <UButton
            :to="`/${clientPeriodId}/create-bexio-invoice?hours=${(sums?.totalAvailableHours || 0) * -1}`"
            variant="outline"
            icon="material-symbols:add-notes"
          >
            Bexio-Rechnung generieren
          </UButton>
        </div>
      </template>
    </USlideover>
  </div>
</template>
