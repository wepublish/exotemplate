<script lang="ts" setup>
  import type { SentryTable } from '~/utils/sentry'

  const props = defineProps<{
    table: SentryTable
  }>()

  const { t, te } = useI18n()
  const { formatNumber } = useFormatters()
  const toast = useToast()

  // i18n copy keyed by table id (sentry.tables.<key>.*); fall back to the raw
  // query so a new backend table still renders.
  function label(field: 'title' | 'subtitle'): string {
    const key = `sentry.tables.${props.table.key}.${field}`
    return te(key) ? t(key) : props.table.query
  }

  // Header for the label (first) column — per-table override
  // (sentry.tables.<key>.labelHeader), else the generic "Query" header.
  const labelHeader = computed<string>(() => {
    const key = `sentry.tables.${props.table.key}.labelHeader`
    return te(key) ? t(key) : t('sentry.table.query')
  })

  const unitLabel = computed<string>(() =>
    props.table.unit === 'millisecond' ? 'ms' : props.table.unit
  )

  // Days in the stats period, to convert a total count into a per-day average.
  // '30d' → 30; falls back to 1 so a malformed period never divides by zero.
  const statsDays = computed<number>(() => {
    const m = props.table.statsPeriod.match(/^(\d+)d$/)
    return m ? Number(m[1]) : 1
  })

  function isCountColumn(name: string): boolean {
    return name.startsWith('count(')
  }

  function isPerDayColumn(name: string): boolean {
    return props.table.perDayAggregates?.includes(name) ?? false
  }

  // 'p90(span.duration)' → 'p90' for a compact column header. The count column
  // header depends on how it reads: a per-day rate ("×/day") or an absolute
  // count ("Count", e.g. queries in one request). A per-table i18n override
  // (sentry.tables.<key>.columns.<col>) wins over the prefix-derived label —
  // used to name the impact column "Impact" instead of "sum".
  function columnLabel(name: string): string {
    const overrideKey = `sentry.tables.${props.table.key}.columns.${name}`
    if (te(overrideKey)) return t(overrideKey)
    if (isCountColumn(name)) {
      return props.table.countPerDay
        ? t('sentry.table.countPerDay')
        : t('sentry.table.count')
    }
    if (name.startsWith('sum(')) return t('sentry.table.total')
    const m = name.match(/^([^(]+)\(/)
    return m ? m[1]! : name
  }

  function ms(v: number | null): string {
    if (v === null) return '–'
    return `${formatNumber(v, { maximumFractionDigits: 0 })} ${unitLabel.value}`
  }

  function formatCell(col: string, v: number | null): string {
    if (v === null) return '–'
    if (isCountColumn(col)) {
      return props.table.countPerDay
        ? formatNumber(v / statsDays.value, { maximumFractionDigits: 1 })
        : formatNumber(v, { maximumFractionDigits: 0 })
    }
    if (isPerDayColumn(col)) {
      return ms(v / statsDays.value)
    }
    return ms(v)
  }

  async function copyQuery(query: string) {
    try {
      await navigator.clipboard.writeText(query)
      toast.add({ color: 'success', title: t('sentry.table.queryCopied') })
    } catch {
      toast.add({ color: 'error', title: t('sentry.table.queryCopyFailed') })
    }
  }
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
          :to="table.sentryUrl"
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
      v-if="table.error"
      color="error"
      variant="soft"
      icon="lucide:triangle-alert"
      :title="t('sentry.loadError')"
    />

    <UAlert
      v-else-if="!table.rows.length"
      color="info"
      variant="soft"
      icon="lucide:info"
      :title="t('sentry.empty')"
    />

    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-default text-muted">
            <th class="text-left font-medium py-2 pe-3">
              {{ labelHeader }}
            </th>
            <th
              v-for="col in table.columns"
              :key="col"
              class="text-right font-medium py-2 ps-3 whitespace-nowrap"
            >
              {{ columnLabel(col) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, i) in table.rows"
            :key="i"
            class="border-b border-default/60 last:border-0"
          >
            <td class="py-2 pe-3 font-mono text-xs">
              <div class="flex items-center gap-1">
                <UButton
                  variant="ghost"
                  color="neutral"
                  size="sm"
                  class="inline-flex items-center gap-1.5 max-w-md lg:max-w-xl text-left"
                  :title="t('sentry.table.queryCopy')"
                  @click="copyQuery(row.label)"
                >
                  <span class="truncate" :title="row.label">
                    {{ row.label }}
                  </span>
                  <UIcon
                    name="lucide:copy"
                    class="text-muted shrink-0 size-3.5 cursor-pointer"
                  />
                </UButton>
                <UButton
                  v-if="row.link"
                  :to="row.link"
                  target="_blank"
                  icon="lucide:external-link"
                  variant="ghost"
                  color="neutral"
                  size="sm"
                  class="shrink-0"
                  :title="t('sentry.table.openTrace')"
                />
              </div>
            </td>
            <td
              v-for="(val, c) in row.values"
              :key="c"
              class="text-right py-2 ps-3 tabular-nums whitespace-nowrap"
            >
              {{ formatCell(table.columns[c], val) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </UPageCard>
</template>
