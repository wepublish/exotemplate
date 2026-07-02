<script lang="ts" setup>
  import type { PlanProject } from '~/composables/useResourcePlanning'

  const userStore = useUserStore()
  const { t } = useI18n()

  const isAdmin = userStore.amIAdministrator()

  const currentYear = new Date().getUTCFullYear()
  const year = ref<number>(currentYear)
  const from = computed(() => `${year.value}-01-01`)
  const to = computed(() => `${year.value}-12-31`)
  const yearOptions = computed(() =>
    [currentYear - 1, currentYear, currentYear + 1].map((v) => ({
      value: v,
      label: String(v)
    }))
  )

  const planning = isAdmin
    ? await useResourcePlanning(from, to, 'rp-balance')
    : null
  const pending = computed<boolean>(() => !!planning?.pending.value)
  const error = computed<Error | null>(
    () => (planning?.error.value as Error | null) ?? null
  )

  // Forward-looking window: the current (Monday-keyed) week onward, matching
  // the overview chart. All figures here are "rest of the year".
  const currentMonday = (() => {
    const d = new Date()
    const dow = (d.getUTCDay() + 6) % 7
    d.setUTCDate(d.getUTCDate() - dow)
    return d.toISOString().slice(0, 10)
  })()
  const allWeeks = computed<string[]>(
    () => planning?.overview.value?.weeks ?? []
  )
  const startIdx = computed<number>(() => {
    const i = allWeeks.value.findIndex((w) => w >= currentMonday)
    return i < 0 ? allWeeks.value.length : i
  })
  const weeksAhead = computed<number>(
    () => allWeeks.value.length - startIdx.value
  )

  interface Row {
    name: string
    derived: boolean
    basePerWeek: number
    intensiveTotal: number
    plannedTotal: number
    available: number | null
    saldo: number | null
  }

  const rows = computed<Row[]>(() => {
    const projects = (planning?.overview.value?.projects ?? []) as PlanProject[]
    const s = startIdx.value
    const wa = weeksAhead.value || 1
    const list = projects.map((p): Row => {
      const baseTotal = p.baseWeekly.slice(s).reduce((a, b) => a + b, 0)
      // Intensive = general phases + person-assigned (direct) phase hours — both
      // are intensive-phase work consuming the budget.
      const intensiveTotal =
        p.intensiveWeekly.slice(s).reduce((a, b) => a + b, 0) +
        (p.directWeekly ?? []).slice(s).reduce((a, b) => a + b, 0)
      const plannedTotal = baseTotal + intensiveTotal
      const saldo =
        p.availableHours != null ? p.availableHours - plannedTotal : null
      return {
        name: p.clientName,
        derived: p.derived,
        basePerWeek: baseTotal / wa,
        intensiveTotal,
        plannedTotal,
        available: p.availableHours,
        saldo
      }
    })
    // Highest saldo (surplus) first, biggest deficit at the bottom; unknown
    // saldo (no billing period) last.
    return list.sort((a, b) => {
      if (a.saldo == null && b.saldo == null)
        return a.name.localeCompare(b.name)
      if (a.saldo == null) return 1
      if (b.saldo == null) return -1
      return b.saldo - a.saldo
    })
  })

  const fmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString('de-CH')
</script>

<template>
  <div class="p-4 sm:p-6">
    <div v-if="!isAdmin" class="flex justify-center pt-16">
      <UPageCard class="max-w-md w-full">
        <template #header>
          <div class="flex items-center gap-3">
            <UIcon name="lucide:lock" class="text-3xl text-error" />
            <p class="font-bold text-lg">
              {{ t('common.accessDenied.title') }}
            </p>
          </div>
        </template>
        <UAlert
          color="error"
          variant="soft"
          icon="lucide:user-x"
          :title="t('common.accessDenied.title')"
          :description="t('common.accessDenied.body')"
        />
      </UPageCard>
    </div>

    <template v-else>
      <div class="flex flex-wrap items-end justify-between gap-4 mb-4">
        <div>
          <h1 class="text-2xl font-bold">{{ t('resourcePlanning.title') }}</h1>
          <p class="text-muted text-sm">
            {{ t('resourcePlanning.balanceIntro') }}
          </p>
        </div>
        <USelect
          v-model="year"
          :items="yearOptions"
          value-key="value"
          label-key="label"
          class="w-32"
        />
      </div>

      <ResourcePlanningTabs active="balance" />

      <USkeleton v-if="pending" class="h-72" />

      <UAlert
        v-else-if="error"
        color="error"
        variant="soft"
        icon="lucide:triangle-alert"
        :title="t('resourcePlanning.loadError')"
        :description="error.message"
      />

      <UAlert
        v-else-if="!rows.length"
        color="info"
        variant="soft"
        icon="lucide:info"
        :title="t('resourcePlanning.empty')"
      />

      <UPageCard v-else>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-muted border-b border-default">
                <th class="py-2 pe-3 font-medium">
                  {{ t('resourcePlanning.project') }}
                </th>
                <th class="py-2 px-3 font-medium text-right">
                  {{ t('resourcePlanning.basePerWeek') }}
                </th>
                <th class="py-2 px-3 font-medium text-right">
                  {{ t('resourcePlanning.intensiveTotal') }}
                </th>
                <th class="py-2 px-3 font-medium text-right">
                  {{ t('resourcePlanning.plannedTotal') }}
                </th>
                <th class="py-2 px-3 font-medium text-right">
                  {{ t('resourcePlanning.remaining') }}
                </th>
                <th class="py-2 ps-3 font-medium text-right">
                  {{ t('resourcePlanning.yearEndSaldo') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in rows"
                :key="r.name"
                class="border-b border-default/60 last:border-0"
              >
                <td class="py-2 pe-3">
                  <span class="font-medium">{{ r.name }}</span>
                  <UBadge
                    v-if="r.derived"
                    color="neutral"
                    variant="soft"
                    size="xs"
                    class="ms-2"
                  >
                    {{ t('resourcePlanning.derived') }}
                  </UBadge>
                </td>
                <td class="py-2 px-3 text-right tabular-nums">
                  {{ fmt(r.basePerWeek) }}
                </td>
                <td class="py-2 px-3 text-right tabular-nums">
                  <span
                    :class="
                      r.intensiveTotal > 0.05 ? 'text-warning' : 'text-muted'
                    "
                  >
                    {{ fmt(r.intensiveTotal) }}
                  </span>
                </td>
                <td class="py-2 px-3 text-right tabular-nums">
                  {{ fmt(r.plannedTotal) }}
                </td>
                <td class="py-2 px-3 text-right tabular-nums">
                  {{ r.available != null ? fmt(r.available) : '—' }}
                </td>
                <td class="py-2 ps-3 text-right tabular-nums font-medium">
                  <span
                    v-if="r.saldo != null"
                    :class="
                      r.saldo < -0.05
                        ? 'text-error'
                        : r.saldo > 0.05
                          ? 'text-success'
                          : ''
                    "
                  >
                    {{ r.saldo > 0.05 ? '+' : '' }}{{ fmt(r.saldo) }}
                  </span>
                  <span v-else class="text-muted">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-xs text-muted mt-3">
          {{ t('resourcePlanning.saldoHint', { weeks: weeksAhead }) }}
        </p>
      </UPageCard>
    </template>
  </div>
</template>
