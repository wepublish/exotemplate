<script lang="ts" setup>
  import type { Sums } from '~~/types/ClockodoTypes'

  const topUpsComp = useTopUps()
  const userStore = useUserStore()
  const { compute, statusColor, statusHeadline, statusBody, statusIcon } =
    useWeeklyReportProgress()

  const props = defineProps<{
    clientPeriodId: number | undefined
    sums: Sums | undefined
    periodFrom: string | undefined
    periodTo: string | undefined
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

  const progress = computed(() =>
    compute({
      totalUsedHours: props.sums?.totalUsedHours,
      totalTopUps: props.sums?.totalTopUps,
      periodFrom: props.periodFrom,
      periodTo: props.periodTo
    })
  )

  const budgetColor = computed<
    'primary' | 'success' | 'warning' | 'error' | 'info'
  >(() => {
    const sums = props.sums?.totalUsedPercentage || 0
    if (sums >= 100) return 'error'
    if (sums >= 90) return 'error'
    if (sums >= 75) return 'warning'
    return 'primary'
  })

  const summaryColor = computed(() =>
    progress.value ? statusColor(progress.value.status) : budgetColor.value
  )

  const summaryIcon = computed(() =>
    progress.value
      ? statusIcon(progress.value.status)
      : 'material-symbols:trending-flat-rounded'
  )

  const summaryHeadline = computed(() =>
    progress.value ? statusHeadline(progress.value.status) : ''
  )

  const summaryBody = computed(() =>
    progress.value ? statusBody(progress.value) : ''
  )

  const formattedPeriod = computed(() => {
    if (!props.periodFrom || !props.periodTo) return ''
    const fmt = (iso: string) =>
      new Date(iso).toLocaleDateString('de-CH', { dateStyle: 'medium' })
    return `${fmt(props.periodFrom)} – ${fmt(props.periodTo)}`
  })
</script>

<template>
  <div class="grid grid-cols-12 gap-4">
    <UPageCard class="col-span-12 md:col-span-4">
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

    <UPageCard class="col-span-12 md:col-span-8">
      <template #default v-if="sums">
        <div class="flex justify-between w-full">
          <div>
            <div class="font-bold">Verfügbare Arbeitsstunden</div>
            <div v-if="formattedPeriod" class="text-xs text-muted mt-0.5">
              {{ formattedPeriod }}
            </div>
          </div>
          <div class="font-bold text-4xl" :class="`text-${budgetColor}`">
            {{ sums.totalAvailableHours }} h | {{ progress?.daysRemaining }} d
          </div>
        </div>

        <!-- Status callout: combines budget vs time wording -->
        <UAlert
          v-if="progress"
          class="mt-4"
          :color="summaryColor"
          variant="soft"
          :icon="summaryIcon"
          :title="summaryHeadline"
          :description="summaryBody"
        />

        <!-- Budget vs. time visual comparison -->
        <div class="mt-4 space-y-3">
          <div>
            <div class="flex justify-between text-xs mb-1">
              <span class="font-medium">Budget verbraucht</span>
              <span :class="`text-${budgetColor} font-medium`">
                {{ sums.totalUsedPercentage }} %
                <span class="text-muted font-normal">
                  ({{ sums.totalUsedHours }} h / {{ sums.totalTopUps }} h)
                </span>
              </span>
            </div>
            <UProgress
              :model-value="Math.min(100, sums.totalUsedPercentage)"
              size="lg"
              :color="budgetColor"
            />
          </div>

          <div v-if="progress">
            <div class="flex justify-between text-xs mb-1">
              <span class="font-medium">Zeit vergangen</span>
              <span class="font-medium text-muted">
                {{ Math.round(progress.timeElapsedPercent) }} % (<span
                  v-if="progress"
                  class="ml-1"
                >
                  {{ progress.daysElapsed }} /
                  {{ progress.periodDurationDays }} Tagen</span
                >)
              </span>
            </div>
            <UProgress
              :model-value="Math.round(progress.timeElapsedPercent)"
              size="lg"
              color="neutral"
            />
          </div>
        </div>

        <div class="flex justify-end w-full pt-4">
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

        <div v-if="progress" class="pt-6">
          <p class="font-bold pb-2">Budget vs. Zeit</p>
          <div class="flex text-sm">
            <div class="flex-1">
              <p>Budget verbraucht</p>
              <p>Zeit vergangen</p>
              <p class="border-b">Differenz</p>
              <p>Verbleibende Tage</p>
            </div>
            <div class="text-right">
              <p>{{ Math.round(progress.budgetUsedPercent) }} %</p>
              <p>{{ Math.round(progress.timeElapsedPercent) }} %</p>
              <p class="border-b">
                {{ progress.deltaPercent > 0 ? '+' : ''
                }}{{ Math.round(progress.deltaPercent) }} %
              </p>
              <p>
                {{ progress.daysRemaining }} /
                {{ progress.periodDurationDays }}
              </p>
            </div>
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
