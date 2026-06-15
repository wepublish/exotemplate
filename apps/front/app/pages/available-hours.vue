<script lang="ts" setup>
  import type { Client, ClientPeriod, Period } from '~~/types/DirectusTypes'

  const route = useRoute()
  const userStore = useUserStore()
  const { t } = useI18n()
  const { formatHours, formatPercent, formatNumber, formatDate } =
    useFormatters()
  const { compute, statusColor, statusHeadline, statusBody, statusIcon } =
    useWeeklyReportProgress()

  const clientPeriodId = computed<number | undefined>(() => {
    const raw = route.params?.clientPeriodId
    if (!raw) return
    return Number(raw)
  })

  const {
    data: entryGroups,
    pending,
    error
  } = await useAggregatedHours(clientPeriodId)

  const sums = computed(() => entryGroups.value?.sums)

  const resolved = computed<{ client: Client; period: Period } | undefined>(
    () => {
      const id = clientPeriodId.value
      if (!id) return undefined
      for (const client of userStore.clients) {
        const periods = (client.periods || []) as ClientPeriod[]
        const match = periods.find((cp) => cp.id === id)
        if (match) return { client, period: match.Periods_id as Period }
      }
      return undefined
    }
  )

  const dashboardLink = computed(() =>
    clientPeriodId.value ? `/${clientPeriodId.value}/dashboard` : '/'
  )

  const formattedPeriod = computed(() => {
    const p = resolved.value?.period
    if (!p?.from || !p?.to) return ''
    return `${formatDate(p.from)} – ${formatDate(p.to)}`
  })

  const progress = computed(() =>
    compute({
      totalUsedHours: sums.value?.totalUsedHours,
      totalTopUps: sums.value?.totalTopUps,
      periodFrom: resolved.value?.period?.from,
      periodTo: resolved.value?.period?.to
    })
  )

  const isMonthlyBilling = computed(
    () => (resolved.value?.client?.billing_mode ?? 'prepaid') === 'monthly'
  )

  const pageTitleSuffix = computed(() =>
    isMonthlyBilling.value
      ? t('billing.availableHours.toBillTitleSuffix')
      : t('billing.availableHours.titleSuffix')
  )

  // For monthly clients the "Aktuell zu verrechnen" headline carries the
  // positive amount that still needs to land on the next invoice. Mirrors
  // the dashboard tile + the weekly Slack report's `remainingToBillHours`.
  const headlineValue = computed<number>(() => {
    const available = sums.value?.totalAvailableHours ?? 0
    return isMonthlyBilling.value ? Math.max(0, -available) : available
  })

  const budgetColor = computed<
    'primary' | 'success' | 'warning' | 'error' | 'info'
  >(() => {
    const used = sums.value?.totalUsedPercentage || 0
    if (used >= 90) return 'error'
    if (used >= 75) return 'warning'
    return 'primary'
  })

  const summaryColor = computed(() =>
    progress.value ? statusColor(progress.value.status) : budgetColor.value
  )

  const summaryIcon = computed(() =>
    progress.value ? statusIcon(progress.value.status) : 'lucide:move-right'
  )

  const summaryHeadline = computed(() =>
    progress.value ? statusHeadline(progress.value.status) : ''
  )

  const summaryBody = computed(() =>
    progress.value ? statusBody(progress.value) : ''
  )
</script>

<template>
  <div>
    <UButton
      :to="dashboardLink"
      icon="lucide:chevron-left"
      variant="ghost"
      size="sm"
      class="mb-4"
    >
      {{ t('billing.backToDashboard') }}
    </UButton>

    <UPageCard>
      <template #default>
        <div class="flex justify-between items-start w-full">
          <div>
            <div class="font-bold text-xl">
              {{ resolved?.client?.name || t('billing.fallbackProjectName') }} ·
              {{ pageTitleSuffix }}
            </div>
            <div v-if="formattedPeriod" class="text-xs text-muted mt-0.5">
              {{ formattedPeriod }}
            </div>
          </div>
          <div
            class="font-bold text-4xl whitespace-nowrap"
            :class="isMonthlyBilling ? 'text-primary' : `text-${budgetColor}`"
          >
            {{ formatHours(headlineValue) }}
          </div>
        </div>

        <USkeleton v-if="pending" class="h-32 mt-6" />

        <UAlert
          v-else-if="error"
          class="mt-6"
          color="error"
          variant="soft"
          icon="i-heroicons-exclamation-triangle"
          :title="t('billing.loadError')"
          :description="error.message"
        />

        <template v-else-if="sums">
          <UAlert
            v-if="progress && !isMonthlyBilling"
            class="mt-6"
            :color="summaryColor"
            variant="soft"
            :icon="summaryIcon"
            :title="summaryHeadline"
            :description="summaryBody"
          />

          <BillingBudgetProgressBars
            v-if="!isMonthlyBilling"
            class="mt-6"
            :sums="sums"
            :progress="progress"
            :budget-color="budgetColor"
          />

          <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
            <div>
              <div class="font-bold pb-2">
                {{
                  isMonthlyBilling
                    ? t('billing.availableHours.calculationToBill')
                    : t('billing.availableHours.calculationAvailableBudget')
                }}
              </div>
              <div class="flex text-sm">
                <div class="flex-1">
                  <p>{{ t('billing.availableHours.rowTopUps') }}</p>
                  <p>{{ t('billing.availableHours.rowWorkLog') }}</p>
                  <p class="border-b">
                    {{ t('billing.availableHours.rowManualCorrections') }}
                  </p>
                  <p class="font-bold pt-1">
                    {{
                      isMonthlyBilling
                        ? t('billing.availableHours.rowBalance')
                        : t('billing.availableHours.rowAvailable')
                    }}
                  </p>
                </div>
                <div class="text-right">
                  <p>{{ formatHours(sums.totalTopUps) }}</p>
                  <p>- {{ formatHours(sums.billableHours) }}</p>
                  <p class="border-b">
                    {{
                      sums.totalManualWorkHours < 0
                        ? `+ ${formatHours(sums.totalManualWorkHours * -1)}`
                        : `- ${formatHours(sums.totalManualWorkHours)}`
                    }}
                  </p>
                  <p class="font-bold pt-1">
                    {{ formatHours(sums.totalAvailableHours) }}
                  </p>
                </div>
              </div>
            </div>

            <div v-if="progress && !isMonthlyBilling">
              <div class="font-bold pb-2">
                {{ t('billing.availableHours.budgetVsTime') }}
              </div>
              <div class="flex text-sm">
                <div class="flex-1">
                  <p>{{ t('billing.availableHours.budgetUsed') }}</p>
                  <p>{{ t('billing.availableHours.timeElapsed') }}</p>
                  <p class="border-b">
                    {{ t('billing.availableHours.difference') }}
                  </p>
                  <p>{{ t('billing.availableHours.remainingDays') }}</p>
                </div>
                <div class="text-right">
                  <p>
                    {{ formatPercent(Math.round(progress.budgetUsedPercent)) }}
                  </p>
                  <p>
                    {{ formatPercent(Math.round(progress.timeElapsedPercent)) }}
                  </p>
                  <p class="border-b">
                    {{ progress.deltaPercent > 0 ? '+' : ''
                    }}{{ formatPercent(Math.round(progress.deltaPercent)) }}
                  </p>
                  <p>
                    {{ formatNumber(progress.daysRemaining) }} /
                    {{ formatNumber(progress.periodDurationDays) }}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="userStore.amIAdministrator() && clientPeriodId"
            class="flex justify-center w-full pt-8"
          >
            <UButton
              :to="`/${clientPeriodId}/create-bexio-invoice?hours=${(sums.totalAvailableHours || 0) * -1}`"
              variant="outline"
              icon="lucide:file-plus"
            >
              {{ t('billing.generateBexioInvoice') }}
            </UButton>
          </div>
        </template>
      </template>
    </UPageCard>
  </div>
</template>
