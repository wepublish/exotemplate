<script lang="ts" setup>
  import type { OverviewEntry } from '~/composables/useClientsOverview'

  const props = defineProps<{
    entry: OverviewEntry
  }>()

  const emit = defineEmits<{
    (event: 'refresh', clientPeriodId: number): void
  }>()

  const { t } = useI18n()
  const { formatHours, formatPercent, formatNumber, formatDate } =
    useFormatters()
  const { compute, statusColor, statusHeadline } = useWeeklyReportProgress()

  const progress = computed(() =>
    compute({
      totalUsedHours: props.entry.sums?.totalUsedHours,
      totalTopUps: props.entry.sums?.totalTopUps,
      periodFrom: props.entry.period.from,
      periodTo: props.entry.period.to
    })
  )

  const isMonthly = computed(
    () => props.entry.client.billing_mode === 'monthly'
  )

  const budgetColor = computed<
    'primary' | 'success' | 'warning' | 'error' | 'info'
  >(() => {
    const used = props.entry.sums?.totalUsedPercentage ?? 0
    if (used >= 100) return 'error'
    if (used >= 90) return 'error'
    if (used >= 75) return 'warning'
    return 'primary'
  })

  const badgeColor = computed(() =>
    progress.value ? statusColor(progress.value.status) : 'neutral'
  )

  const badgeText = computed(() =>
    progress.value ? statusHeadline(progress.value.status) : ''
  )

  const periodLabel = computed(() => {
    const fmt = (iso: string) =>
      formatDate(iso, {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit'
      })
    return `${fmt(props.entry.period.from)} – ${fmt(props.entry.period.to)}`
  })

  const dashboardLink = computed(
    () => `/${props.entry.clientPeriodId}/dashboard`
  )

  const relativeComputedAt = computed<string | null>(() => {
    if (!props.entry.computedAt) return null
    const then = new Date(props.entry.computedAt).getTime()
    const now = Date.now()
    const minutes = Math.round((now - then) / 60000)
    if (minutes < 1) return t('overview.tile.justUpdated')
    if (minutes < 60) return t('overview.tile.minutesAgo', { n: minutes })
    const hours = Math.round(minutes / 60)
    if (hours < 24) return t('overview.tile.hoursAgo', { n: hours })
    const days = Math.round(hours / 24)
    return t('overview.tile.daysAgo', { n: days }, days)
  })

  function onRefreshClick(e: Event) {
    e.preventDefault()
    e.stopPropagation()
    emit('refresh', props.entry.clientPeriodId)
  }
</script>

<template>
  <NuxtLink
    :to="dashboardLink"
    class="block group focus:outline-none"
    :aria-label="t('overview.tile.detailsAria', { name: entry.client.name })"
  >
    <UPageCard
      class="h-full transition-shadow group-hover:shadow-lg group-focus-visible:ring-2 group-focus-visible:ring-primary cursor-pointer"
    >
      <div class="flex flex-col gap-3">
        <!-- Header: name + period (left, gets the room) + refresh (right) -->
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="font-bold truncate" :title="entry.client.name">
              {{ entry.client.name }}
            </div>
            <div class="text-xs text-muted whitespace-nowrap">
              {{ periodLabel }}
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <UTooltip
              v-if="entry.contractWarning"
              :text="t('overview.tile.noSignedContract')"
            >
              <UIcon name="lucide:clipboard-x" class="text-warning text-lg" />
            </UTooltip>
            <UTooltip v-if="entry.lastError" :text="entry.lastError">
              <UIcon name="lucide:circle-alert" class="text-warning text-lg" />
            </UTooltip>
            <UButton
              icon="lucide:refresh-cw"
              variant="ghost"
              color="neutral"
              size="xs"
              :aria-label="t('overview.tile.refreshAria')"
              @click="onRefreshClick"
            />
          </div>
        </div>

        <!-- Status badge on its own row so it never crowds the client name. -->
        <div v-if="badgeText && entry.sums">
          <UBadge :color="badgeColor" variant="subtle" size="sm">
            {{ badgeText }}
          </UBadge>
        </div>

        <!-- Pending state: nothing computed yet -->
        <div v-if="entry.pending" class="space-y-3">
          <USkeleton class="h-3 w-full" />
          <USkeleton class="h-3 w-full" />
          <p class="text-xs text-muted text-center">
            {{ t('overview.tile.computing') }}
          </p>
        </div>

        <!-- Monthly mode: only the time-elapsed bar; the budget concept doesn't
             apply the same way (the dashboard's "Aktuell zu verrechnen" view
             carries the relevant detail). -->
        <template v-else-if="isMonthly && entry.sums">
          <div>
            <div class="flex justify-between text-xs mb-1">
              <span class="font-medium">{{ t('overview.tile.toBill') }}</span>
              <span class="font-medium text-primary">
                {{ formatHours(Math.max(0, -entry.sums.totalAvailableHours)) }}
              </span>
            </div>
          </div>

          <div v-if="progress">
            <div class="flex justify-between text-xs mb-1">
              <span class="font-medium">
                {{ t('overview.tile.timeElapsed') }}
              </span>
              <span class="font-medium text-muted">
                {{ formatPercent(Math.round(progress.timeElapsedPercent)) }}
              </span>
            </div>
            <UProgress
              :model-value="Math.round(progress.timeElapsedPercent)"
              size="md"
              color="neutral"
            />
          </div>
        </template>

        <!-- Prepaid mode (default): both progress bars, same wording as
             /[clientPeriodId]/available-hours -->
        <template v-else-if="entry.sums">
          <div>
            <div class="flex justify-between text-xs mb-1">
              <span class="font-medium">{{
                t('overview.tile.budgetUsed')
              }}</span>
              <span :class="`text-${budgetColor} font-medium`">
                {{ formatPercent(entry.sums.totalUsedPercentage) }}
              </span>
            </div>
            <UProgress
              :model-value="Math.min(100, entry.sums.totalUsedPercentage)"
              size="md"
              :color="budgetColor"
            />
            <div class="text-xs text-muted mt-1">
              {{
                t('overview.tile.hoursOfTopUps', {
                  used: formatNumber(entry.sums.totalUsedHours),
                  total: formatNumber(entry.sums.totalTopUps)
                })
              }}
            </div>
          </div>

          <div v-if="progress">
            <div class="flex justify-between text-xs mb-1">
              <span class="font-medium">
                {{ t('overview.tile.timeElapsed') }}
              </span>
              <span class="font-medium text-muted">
                {{ formatPercent(Math.round(progress.timeElapsedPercent)) }}
              </span>
            </div>
            <UProgress
              :model-value="Math.round(progress.timeElapsedPercent)"
              size="md"
              color="neutral"
            />
            <div class="text-xs text-muted mt-1">
              {{
                t('overview.tile.daysOfTotal', {
                  elapsed: formatNumber(progress.daysElapsed),
                  total: formatNumber(progress.periodDurationDays)
                })
              }}
            </div>
          </div>
        </template>

        <!-- No sums + error: explicit error state. -->
        <div v-else-if="entry.lastError" class="text-xs text-error">
          {{ t('overview.tile.updateFailed') }}
        </div>

        <!-- Footer: freshness + arrow -->
        <div class="flex justify-between items-center text-xs text-muted pt-1">
          <span v-if="relativeComputedAt">
            {{
              t('overview.tile.updatedRelative', {
                relative: relativeComputedAt
              })
            }}
          </span>
          <span v-else />
          <span
            class="flex items-center group-hover:text-primary transition-colors"
          >
            {{ t('overview.tile.open') }}
            <UIcon name="lucide:arrow-right" class="ml-1" />
          </span>
        </div>
      </div>
    </UPageCard>
  </NuxtLink>
</template>
