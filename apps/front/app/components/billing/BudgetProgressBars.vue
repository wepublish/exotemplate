<script lang="ts" setup>
  import type { Sums } from '~~/types/ClockodoTypes'
  import type { WeeklyReportProgress } from '~/composables/useWeeklyReportProgress'

  /**
   * Budget-vs-time progress bars — "Budget verbraucht" (consumed) and "Zeit
   * vergangen" (time elapsed). Shared by the Verfügbare Arbeitsstunden detail
   * page and the dashboard tile so both render the identical bars and wording.
   *
   * Only meaningful for prepaid billing (monthly clients have no budget to
   * track against), so callers gate it with `v-if="!isMonthlyBilling"`.
   */
  withDefaults(
    defineProps<{
      sums: Sums
      progress: WeeklyReportProgress | null
      budgetColor: 'primary' | 'success' | 'warning' | 'error' | 'info'
      size?: 'sm' | 'md' | 'lg'
    }>(),
    { size: 'lg' }
  )

  const { t } = useI18n()
  const { formatHours, formatPercent, formatNumber } = useFormatters()
</script>

<template>
  <div class="space-y-3">
    <div v-if="progress?.status !== 'no_budget'">
      <div class="flex justify-between text-xs mb-1">
        <span class="font-medium">
          {{ t('billing.availableHours.budgetUsed') }}
        </span>
        <span :class="`text-${budgetColor} font-medium`">
          {{ formatPercent(sums.totalUsedPercentage) }}
          <span class="text-muted font-normal">
            {{
              t('billing.availableHours.budgetUsedDetail', {
                used: formatNumber(sums.totalUsedHours),
                total: formatNumber(sums.totalTopUps)
              })
            }}
          </span>
        </span>
      </div>
      <UProgress
        :model-value="Math.min(100, sums.totalUsedPercentage)"
        :size="size"
        :color="budgetColor"
      />
    </div>

    <div v-else>
      <div class="flex justify-between text-xs mb-1">
        <span class="font-medium">
          {{ t('billing.availableHours.consumedHours') }}
        </span>
        <span class="text-warning font-medium">
          {{ formatHours(sums.totalUsedHours) }}
          <span class="text-muted font-normal">
            {{ t('billing.availableHours.billedSeparately') }}
          </span>
        </span>
      </div>
    </div>

    <div v-if="progress">
      <div class="flex justify-between text-xs mb-1">
        <span class="font-medium">
          {{ t('billing.availableHours.timeElapsed') }}
        </span>
        <span class="font-medium text-muted">
          {{ formatPercent(Math.round(progress.timeElapsedPercent)) }}
          <span class="ml-1">
            {{
              t('billing.availableHours.timeElapsedDetail', {
                elapsed: formatNumber(progress.daysElapsed),
                total: formatNumber(progress.periodDurationDays)
              })
            }}
          </span>
        </span>
      </div>
      <UProgress
        :model-value="Math.round(progress.timeElapsedPercent)"
        :size="size"
        color="neutral"
      />
    </div>
  </div>
</template>
