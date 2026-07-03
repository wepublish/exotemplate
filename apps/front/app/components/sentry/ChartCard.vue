<script lang="ts" setup>
  import type { ChartBand, SentryChart } from '~/utils/sentry'

  const props = defineProps<{
    chart: SentryChart
  }>()

  // Per-chart health thresholds, keyed by chart id: green = healthy, amber =
  // elevated, red = bad. Light fills so the data lines stay readable on top.
  const CHART_BANDS: Record<string, ChartBand[]> = {
    'db-duration': [
      { from: 0, to: 100, color: 'fill-green-500/10' },
      { from: 100, to: 300, color: 'fill-amber-500/10' },
      { from: 300, to: null, color: 'fill-red-500/10' }
    ],
    'slow-http': [
      { from: 0, to: 200, color: 'fill-green-500/10' },
      { from: 200, to: 600, color: 'fill-amber-500/10' },
      { from: 600, to: null, color: 'fill-red-500/10' }
    ],
    'pgpool-queue': [
      { from: 0, to: 10, color: 'fill-green-500/10' },
      { from: 10, to: 30, color: 'fill-amber-500/10' },
      { from: 30, to: null, color: 'fill-red-500/10' }
    ],
    'article-list': [
      { from: 0, to: 80, color: 'fill-green-500/10' },
      { from: 80, to: 200, color: 'fill-amber-500/10' },
      { from: 200, to: null, color: 'fill-red-500/10' }
    ]
  }

  const bands = computed<ChartBand[]>(() => CHART_BANDS[props.chart.key] ?? [])

  const { t, te } = useI18n()

  // i18n copy is keyed by chart id (sentry.charts.<key>.*); fall back to the
  // raw query if a chart has no catalog entry yet, so a new backend chart still
  // renders rather than showing a missing-key string.
  function label(field: 'title' | 'subtitle' | 'chartTitle'): string {
    const key = `sentry.charts.${props.chart.key}.${field}`
    return te(key) ? t(key) : props.chart.query
  }

  const unitLabel = computed<string>(() =>
    props.chart.unit === 'millisecond' ? 'ms' : props.chart.unit
  )

  // Whether the chart has any plottable data — drives the empty-state alert.
  const hasData = computed<boolean>(() =>
    props.chart.series.some((s) =>
      s.points.some(
        (p) => typeof p.value === 'number' && Number.isFinite(p.value)
      )
    )
  )
</script>

<template>
  <UPageCard>
    <template #header>
      <div class="flex justify-between items-start w-full gap-4">
        <div>
          <div class="font-bold text-lg">{{ label('title') }}</div>
          <div class="text-xs text-muted mt-0.5">{{ label('subtitle') }}</div>
        </div>
        <UButton
          :to="chart.sentryUrl"
          target="_blank"
          icon="lucide:external-link"
          variant="ghost"
          size="sm"
          color="neutral"
          class="shrink-0"
        >
          {{ t('sentry.openInSentry') }}
        </UButton>
      </div>
    </template>

    <UAlert
      v-if="chart.error"
      color="error"
      variant="soft"
      icon="lucide:triangle-alert"
      :title="t('sentry.loadError')"
    />

    <UAlert
      v-else-if="!hasData"
      color="info"
      variant="soft"
      icon="lucide:info"
      :title="t('sentry.empty')"
    />

    <div v-else class="space-y-6">
      <!-- Chart -->
      <div>
        <div class="text-sm font-medium mb-2">{{ label('chartTitle') }}</div>
        <SentryDurationChart
          :series="chart.series"
          :unit-label="unitLabel"
          :bands="bands"
        />
      </div>
    </div>
  </UPageCard>
</template>
