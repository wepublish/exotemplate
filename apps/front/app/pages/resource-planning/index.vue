<script lang="ts" setup>
  import type { PlanEmployee } from '~/composables/useResourcePlanning'

  const userStore = useUserStore()
  const { t, locale } = useI18n()
  const { formatDate } = useFormatters()

  // Swiss-formatted month tick: show the short month name only when the month
  // changes from the previous week, so the weekly axis stays readable.
  const localeTag = computed(
    () =>
      ({ de: 'de-CH', fr: 'fr-CH', en: 'en-GB' })[locale.value as string] ??
      'de-CH'
  )
  function monthTick(weekIso: string, prevIso: string | undefined): string {
    if (!weekIso) return ''
    if (prevIso && weekIso.slice(0, 7) === prevIso.slice(0, 7)) return ''
    return new Date(`${weekIso}T00:00:00Z`).toLocaleDateString(
      localeTag.value,
      {
        month: 'short'
      }
    )
  }

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
    ? await useResourcePlanning(from, to, 'rp-overview')
    : null

  const overview = computed(() => planning?.overview.value)
  const pending = computed<boolean>(() => !!planning?.pending.value)
  const error = computed<Error | null>(
    () => (planning?.error.value as Error | null) ?? null
  )
  const excludedCount = computed<number>(
    () => planning?.excludedCount.value ?? 0
  )

  // Forward-looking only: the chart starts at the current (Monday-keyed) week
  // and drops everything in the past. Past weeks aren't plannable anymore.
  const currentMonday = (() => {
    const d = new Date()
    const dow = (d.getUTCDay() + 6) % 7
    d.setUTCDate(d.getUTCDate() - dow)
    return d.toISOString().slice(0, 10)
  })()
  const startIdx = computed<number>(() => {
    const all = overview.value?.weeks ?? []
    const i = all.findIndex((w) => w >= currentMonday)
    return i < 0 ? all.length : i
  })

  const weeks = computed<string[]>(() =>
    (overview.value?.weeks ?? []).slice(startIdx.value)
  )
  const team = computed(() =>
    (overview.value?.team ?? []).slice(startIdx.value)
  )
  // Only the employees counted toward the total are listed here; excluded
  // people are managed on the Employees tab, not shown in the overview.
  const employees = computed<PlanEmployee[]>(() =>
    (overview.value?.employees ?? []).filter((e) => !e.excluded)
  )
  // Per-employee weekly series, trimmed to the same future window as the chart.
  const visibleWeekly = (e: PlanEmployee): number[] =>
    e.weekly.slice(startIdx.value)
  const visGross = (e: PlanEmployee): number[] =>
    e.grossWeekly.slice(startIdx.value)
  const visDirect = (e: PlanEmployee): number[] =>
    e.directWeekly.slice(startIdx.value)
  const visGeneral = (e: PlanEmployee): number[] =>
    e.generalWeekly.slice(startIdx.value)
  const visOff = (e: PlanEmployee): boolean[] =>
    e.offWeekly.slice(startIdx.value)
  const visVacation = (e: PlanEmployee): number[] =>
    e.vacationWeekly.slice(startIdx.value)
  const visHolidayHours = (e: PlanEmployee): number[] =>
    e.holidayHoursWeekly.slice(startIdx.value)
  const visHoliday = (e: PlanEmployee): string[][] =>
    e.holidayWeekly.slice(startIdx.value)
  const visClosedCap = (e: PlanEmployee): number[] =>
    e.closedCapacityWeekly.slice(startIdx.value)
  // Scale each employee's mini-chart to their own tallest week (capacity +
  // vacation + holiday stacked, vs the load; and the would-be closed capacity).
  const empMax = (e: PlanEmployee): number =>
    Math.max(
      1,
      ...visGross(e).map((g, i) =>
        Math.max(
          g + (visVacation(e)[i] ?? 0) + (visHolidayHours(e)[i] ?? 0),
          visClosedCap(e)[i] ?? 0,
          (visDirect(e)[i] ?? 0) + (visGeneral(e)[i] ?? 0)
        )
      )
    )
  const barH = (v: number, max: number) => `${Math.min(100, (v / max) * 100)}%`
  // Per-week load (direct + general) and remaining capacity for one employee.
  const empLoad = (e: PlanEmployee, i: number): number =>
    (visDirect(e)[i] ?? 0) + (visGeneral(e)[i] ?? 0)
  const empRemaining = (e: PlanEmployee, i: number): number =>
    (visGross(e)[i] ?? 0) - empLoad(e, i)

  // Bar scale: tallest of (capacity + vacation) / planned across visible weeks.
  const maxValue = computed(() =>
    Math.max(
      1,
      ...team.value.map((w) =>
        Math.max(w.capacity + w.vacation + w.holiday, w.planned)
      )
    )
  )
  // Diagonal-hatch fill for the "vacation" segment/legend — clearly reads as
  // unavailable time, distinct from the solid load colours.
  const vacationSwatch = {
    backgroundImage:
      'repeating-linear-gradient(45deg, rgba(148,163,184,0.55) 0 3px, transparent 3px 7px)'
  }
  // Public-holiday marker colour (violet) — distinct from the load/overload hues.
  const holidayColor = '#8b5cf6'
  const pct = (v: number) => `${Math.min(100, (v / maxValue.value) * 100)}%`
  // Height of a stacked segment as a share of its parent (the planned bar).
  const pctOf = (part: number, whole: number) =>
    `${whole > 0 ? Math.min(100, (part / whole) * 100) : 0}%`
  const round = (v: number) => Math.round(v)

  // Employee drilldown (weekly capacity for the selected person).
  const expanded = ref<number | null>(null)
  function toggle(id: number): void {
    expanded.value = expanded.value === id ? null : id
  }
</script>

<template>
  <div class="p-4 sm:p-6">
    <!-- Access denied for non-admins -->
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
          <p class="text-muted text-sm">{{ t('resourcePlanning.subtitle') }}</p>
          <p v-if="excludedCount" class="text-xs text-muted mt-0.5">
            {{ t('resourcePlanning.excludedNote', { count: excludedCount }) }}
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

      <ResourcePlanningTabs active="overview" />

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
        v-else-if="!weeks.length"
        color="info"
        variant="soft"
        icon="lucide:info"
        :title="t('resourcePlanning.empty')"
      />

      <template v-else>
        <!-- Weekly team utilization chart (capacity vs planned, overload red) -->
        <UPageCard class="mb-4">
          <template #header>
            <div class="flex items-center justify-between w-full gap-4">
              <span class="font-semibold">{{
                t('resourcePlanning.utilization')
              }}</span>
              <div class="flex items-center gap-4 text-xs text-muted">
                <span class="flex items-center gap-1">
                  <span
                    class="inline-block w-3 h-3 rounded-sm bg-elevated border border-default"
                  />
                  {{ t('resourcePlanning.capacity') }}
                </span>
                <span class="flex items-center gap-1">
                  <span class="inline-block w-3 h-3 rounded-sm bg-primary" />
                  {{ t('resourcePlanning.baseLoad') }}
                </span>
                <span class="flex items-center gap-1">
                  <span class="inline-block w-3 h-3 rounded-sm bg-warning" />
                  {{ t('resourcePlanning.intensiveLoad') }}
                </span>
                <span class="flex items-center gap-1">
                  <span class="inline-block w-3 h-3 rounded-sm bg-info" />
                  {{ t('resourcePlanning.directLoad') }}
                </span>
                <span class="flex items-center gap-1">
                  <span
                    class="inline-block w-3 h-3 rounded-sm border border-default"
                    :style="vacationSwatch"
                  />
                  {{ t('resourcePlanning.vacation') }}
                </span>
                <span class="flex items-center gap-1">
                  <span
                    class="inline-block w-3 h-3 rounded-sm border border-default bg-black"
                  />
                  {{ t('resourcePlanning.closures') }}
                </span>
                <span class="flex items-center gap-1">
                  <span
                    class="inline-block w-3 h-3 rounded-sm"
                    :style="{ backgroundColor: holidayColor }"
                  />
                  {{ t('resourcePlanning.holiday') }}
                </span>
                <span class="flex items-center gap-1">
                  <span
                    class="inline-block w-3 h-3 rounded-sm ring-2 ring-error ring-inset"
                  />
                  {{ t('resourcePlanning.overload') }}
                </span>
              </div>
            </div>
          </template>

          <div class="overflow-x-auto overflow-y-hidden">
            <div class="flex items-end gap-px h-56 min-w-[640px] relative">
              <div
                v-for="(w, i) in team"
                :key="w.week"
                class="relative flex flex-col justify-end items-center flex-1 min-w-0 h-full"
              >
                <!-- Vacation marker: how many people are off this week -->
                <span
                  v-if="w.vacationCount"
                  class="absolute top-0 flex items-center gap-0.5 text-[9px] text-muted"
                  :title="t('resourcePlanning.vacation')"
                >
                  <UIcon name="lucide:palmtree" class="shrink-0" />{{
                    w.vacationCount
                  }}
                </span>
                <UPopover
                  mode="hover"
                  :content="{ side: 'bottom', avoidCollisions: false }"
                  class="w-full"
                >
                  <div
                    class="relative w-full h-48 flex items-end cursor-default rounded-sm"
                  >
                    <!-- background: capacity (bottom) + vacation hatch + holiday (top) -->
                    <div
                      class="absolute bottom-0 w-full flex flex-col justify-end rounded-sm overflow-hidden border border-default"
                      :style="{
                        height: pct(w.capacity + w.vacation + w.holiday)
                      }"
                    >
                      <div
                        v-if="w.holiday > 0.5"
                        class="w-full shrink-0"
                        :style="{
                          backgroundColor: holidayColor,
                          height: pctOf(
                            w.holiday,
                            w.capacity + w.vacation + w.holiday
                          )
                        }"
                      />
                      <div
                        v-if="w.vacation > 0.5"
                        class="w-full shrink-0"
                        :style="[
                          vacationSwatch,
                          {
                            height: pctOf(
                              w.vacation,
                              w.capacity + w.vacation + w.holiday
                            )
                          }
                        ]"
                      />
                      <div class="w-full flex-1 bg-elevated" />
                    </div>
                    <!-- planned = base (bottom) + intensive + direct (top) -->
                    <div
                      class="absolute bottom-0 w-full flex flex-col justify-end rounded-sm overflow-hidden"
                      :style="{ height: pct(w.planned) }"
                    >
                      <div
                        class="w-full bg-info shrink-0"
                        :style="{ height: pctOf(w.direct, w.planned) }"
                      />
                      <div
                        class="w-full bg-warning shrink-0"
                        :style="{ height: pctOf(w.intensive, w.planned) }"
                      />
                      <div
                        class="w-full bg-primary shrink-0"
                        :style="{ height: pctOf(w.base, w.planned) }"
                      />
                    </div>
                    <!-- Overload outline: inset ring on a top overlay so it
                         draws over the bars yet stays within the week cell (no
                         overlap into neighbouring weeks). -->
                    <div
                      v-if="w.overloaded && !w.closed"
                      class="absolute inset-0 rounded-sm ring-2 ring-error ring-inset pointer-events-none"
                    />
                    <!-- Betriebsferien: whole week filled black -->
                    <div
                      v-if="w.closed"
                      class="absolute inset-0 rounded-sm border border-default bg-black"
                    />
                  </div>

                  <template #content>
                    <div class="p-3 text-xs w-56 space-y-1.5">
                      <p class="font-semibold text-sm">
                        {{ formatDate(w.week) }}
                        <span
                          v-if="!w.closed && w.ratio != null"
                          :class="w.overloaded ? 'text-error' : 'text-muted'"
                        >
                          · {{ Math.round(w.ratio * 100) }}%
                        </span>
                      </p>
                      <p
                        v-if="w.closed"
                        class="flex items-center gap-1 font-medium"
                      >
                        <span
                          class="inline-block w-2 h-2 rounded-sm border border-default bg-black"
                        />
                        {{ w.closureName || t('resourcePlanning.closures') }}
                      </p>
                      <p class="flex justify-between">
                        <span class="text-muted">{{
                          t('resourcePlanning.capacity')
                        }}</span>
                        <span class="tabular-nums"
                          >{{ round(w.capacity) }}
                          {{ t('resourcePlanning.hours') }}</span
                        >
                      </p>

                      <div>
                        <p class="flex justify-between font-medium">
                          <span class="flex items-center gap-1">
                            <span
                              class="inline-block w-2 h-2 rounded-sm bg-primary"
                            />
                            {{ t('resourcePlanning.baseLoad') }}
                          </span>
                          <span class="tabular-nums"
                            >{{ round(w.base) }}
                            {{ t('resourcePlanning.hours') }}</span
                          >
                        </p>
                        <ul class="ps-3 text-muted">
                          <li
                            v-for="(it, k) in w.breakdown.base"
                            :key="'b' + k"
                            class="flex justify-between gap-2"
                          >
                            <span class="truncate">{{ it.name }}</span>
                            <span class="tabular-nums shrink-0">{{
                              round(it.hours)
                            }}</span>
                          </li>
                        </ul>
                      </div>

                      <div v-if="w.intensive > 0.5">
                        <p class="flex justify-between font-medium">
                          <span class="flex items-center gap-1">
                            <span
                              class="inline-block w-2 h-2 rounded-sm bg-warning"
                            />
                            {{ t('resourcePlanning.intensiveLoad') }}
                          </span>
                          <span class="tabular-nums"
                            >{{ round(w.intensive) }}
                            {{ t('resourcePlanning.hours') }}</span
                          >
                        </p>
                        <ul class="ps-3 text-muted">
                          <li
                            v-for="(it, k) in w.breakdown.intensive"
                            :key="'i' + k"
                            class="flex justify-between gap-2"
                          >
                            <span class="truncate">
                              {{ it.name
                              }}<template v-if="it.phase">
                                · {{ it.phase }}</template
                              >
                            </span>
                            <span class="tabular-nums shrink-0">{{
                              round(it.hours)
                            }}</span>
                          </li>
                        </ul>
                      </div>

                      <div v-if="w.direct > 0.5">
                        <p class="flex justify-between font-medium">
                          <span class="flex items-center gap-1">
                            <span
                              class="inline-block w-2 h-2 rounded-sm bg-info"
                            />
                            {{ t('resourcePlanning.directLoad') }}
                          </span>
                          <span class="tabular-nums"
                            >{{ round(w.direct) }}
                            {{ t('resourcePlanning.hours') }}</span
                          >
                        </p>
                        <ul class="ps-3 text-muted">
                          <li
                            v-for="(it, k) in w.breakdown.direct"
                            :key="'d' + k"
                            class="flex justify-between gap-2"
                          >
                            <span class="truncate">{{ it.name }}</span>
                            <span class="tabular-nums shrink-0">{{
                              round(it.hours)
                            }}</span>
                          </li>
                        </ul>
                      </div>

                      <div
                        v-if="w.vacation > 0.5 || w.breakdown.vacation.length"
                      >
                        <p class="flex justify-between font-medium">
                          <span class="flex items-center gap-1">
                            <UIcon name="lucide:palmtree" class="text-muted" />
                            {{ t('resourcePlanning.vacation') }}
                          </span>
                          <span class="tabular-nums"
                            >{{ round(w.vacation) }}
                            {{ t('resourcePlanning.hours') }}</span
                          >
                        </p>
                        <ul class="ps-3 text-muted">
                          <li
                            v-for="(it, k) in w.breakdown.vacation"
                            :key="'v' + k"
                            class="flex justify-between gap-2"
                          >
                            <span class="truncate">{{ it.name }}</span>
                            <span class="tabular-nums shrink-0">{{
                              round(it.hours)
                            }}</span>
                          </li>
                        </ul>
                      </div>

                      <div v-if="w.holidays.length">
                        <p class="flex justify-between font-medium">
                          <span class="flex items-center gap-1">
                            <span
                              class="inline-block w-2 h-2 rounded-sm"
                              :style="{ backgroundColor: holidayColor }"
                            />
                            {{ t('resourcePlanning.holiday') }}
                          </span>
                          <span v-if="w.holiday > 0.5" class="tabular-nums"
                            >{{ round(w.holiday) }}
                            {{ t('resourcePlanning.hours') }}</span
                          >
                        </p>
                        <ul class="ps-3 text-muted">
                          <li
                            v-for="(h, k) in w.holidays"
                            :key="'h' + k"
                            class="truncate"
                          >
                            {{ h }}
                          </li>
                        </ul>
                      </div>
                    </div>
                  </template>
                </UPopover>
                <!-- Month label strip below the bars (fixed height so all bars
                     stay aligned); only shown at a month boundary. -->
                <div class="h-5 w-full relative shrink-0">
                  <span
                    v-if="monthTick(w.week, team[i - 1]?.week)"
                    class="absolute left-0 top-1 text-[11px] font-semibold text-default whitespace-nowrap"
                  >
                    {{ monthTick(w.week, team[i - 1]?.week) }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </UPageCard>

        <!-- Per-employee capacity + drilldown -->
        <UPageCard>
          <template #header>
            <span class="font-semibold">{{
              t('resourcePlanning.employees')
            }}</span>
          </template>
          <ul class="divide-y">
            <li v-for="e in employees" :key="e.id" class="py-2 first:pt-0">
              <button
                type="button"
                class="w-full flex items-center justify-between gap-3 text-left hover:text-primary"
                @click="toggle(e.id)"
              >
                <span class="font-medium truncate">{{ e.name }}</span>
                <span
                  class="flex items-center gap-3 text-sm text-muted shrink-0"
                >
                  <span class="tabular-nums">
                    {{ round(visGross(e).reduce((a, b) => a + b, 0)) }}
                    {{ t('resourcePlanning.hours') }}
                    ({{ t('resourcePlanning.totalCapacity') }})
                  </span>
                  <UIcon
                    :name="
                      expanded === e.id
                        ? 'lucide:chevron-up'
                        : 'lucide:chevron-down'
                    "
                  />
                </span>
              </button>
              <div v-if="expanded === e.id" class="mt-3">
                <div class="flex items-center gap-4 text-xs text-muted mb-2">
                  <span class="flex items-center gap-1">
                    <span
                      class="inline-block w-3 h-3 rounded-sm bg-elevated border border-default"
                    />
                    {{ t('resourcePlanning.capacity') }}
                  </span>
                  <span class="flex items-center gap-1">
                    <span class="inline-block w-3 h-3 rounded-sm bg-warning" />
                    {{ t('resourcePlanning.directLoad') }}
                  </span>
                  <span class="flex items-center gap-1">
                    <span class="inline-block w-3 h-3 rounded-sm bg-primary" />
                    {{ t('resourcePlanning.generalLoad') }}
                  </span>
                </div>
                <div class="overflow-x-auto overflow-y-hidden">
                  <div
                    class="flex items-end gap-px h-32 min-w-[640px] relative"
                  >
                    <div
                      v-for="(g, i) in visGross(e)"
                      :key="i"
                      class="relative flex flex-col justify-end items-center flex-1 min-w-0 h-full"
                    >
                      <!-- Per-week overload marker: negative free capacity in red -->
                      <span
                        v-if="empRemaining(e, i) < -0.05"
                        class="absolute top-0 text-[9px] font-semibold text-error tabular-nums"
                        :title="t('resourcePlanning.overCapacity')"
                      >
                        {{ round(empRemaining(e, i)) }}
                      </span>
                      <UPopover
                        mode="hover"
                        :content="{ side: 'bottom', avoidCollisions: false }"
                        class="w-full"
                      >
                        <div
                          class="relative w-full h-24 flex items-end cursor-default rounded-sm"
                        >
                          <!-- background: capacity (bottom) + vacation hatch + holiday (top) -->
                          <div
                            class="absolute bottom-0 w-full flex flex-col justify-end rounded-sm overflow-hidden border border-default"
                            :style="{
                              height: barH(
                                g +
                                  (visVacation(e)[i] ?? 0) +
                                  (visHolidayHours(e)[i] ?? 0),
                                empMax(e)
                              )
                            }"
                          >
                            <div
                              v-if="(visHolidayHours(e)[i] ?? 0) > 0.5"
                              class="w-full shrink-0"
                              :style="{
                                backgroundColor: holidayColor,
                                height: barH(
                                  visHolidayHours(e)[i] ?? 0,
                                  g +
                                    (visVacation(e)[i] ?? 0) +
                                    (visHolidayHours(e)[i] ?? 0) || 1
                                )
                              }"
                            />
                            <div
                              v-if="(visVacation(e)[i] ?? 0) > 0.5"
                              class="w-full shrink-0"
                              :style="[
                                vacationSwatch,
                                {
                                  height: barH(
                                    visVacation(e)[i] ?? 0,
                                    g +
                                      (visVacation(e)[i] ?? 0) +
                                      (visHolidayHours(e)[i] ?? 0) || 1
                                  )
                                }
                              ]"
                            />
                            <div class="w-full flex-1 bg-elevated" />
                          </div>
                          <!-- vacation icon marker -->
                          <UIcon
                            v-if="visOff(e)[i]"
                            name="lucide:palmtree"
                            class="absolute inset-x-0 top-0 mx-auto text-muted"
                            :title="t('resourcePlanning.vacation')"
                          />
                          <!-- direct (bottom) + general (stacked on top) -->
                          <div
                            class="absolute bottom-0 w-full flex flex-col justify-end rounded-sm overflow-hidden"
                            :style="{
                              height: barH(
                                (visDirect(e)[i] ?? 0) +
                                  (visGeneral(e)[i] ?? 0),
                                empMax(e)
                              )
                            }"
                          >
                            <div
                              class="w-full bg-primary shrink-0"
                              :style="{
                                height: barH(
                                  visGeneral(e)[i] ?? 0,
                                  (visDirect(e)[i] ?? 0) +
                                    (visGeneral(e)[i] ?? 0) || 1
                                )
                              }"
                            />
                            <div
                              class="w-full bg-warning shrink-0"
                              :style="{
                                height: barH(
                                  visDirect(e)[i] ?? 0,
                                  (visDirect(e)[i] ?? 0) +
                                    (visGeneral(e)[i] ?? 0) || 1
                                )
                              }"
                            />
                          </div>
                          <!-- Overload outline: inset ring overlay (within the cell) -->
                          <div
                            v-if="
                              empRemaining(e, i) < -0.05 && !team[i]?.closed
                            "
                            class="absolute inset-0 rounded-sm ring-2 ring-error ring-inset pointer-events-none"
                          />
                          <!-- Betriebsferien: black block only as tall as the
                               person's would-be capacity that week -->
                          <div
                            v-if="team[i]?.closed"
                            class="absolute bottom-0 w-full rounded-sm border border-default bg-black"
                            :style="{
                              height: barH(visClosedCap(e)[i] ?? 0, empMax(e))
                            }"
                          />
                        </div>
                        <template #content>
                          <div class="p-3 text-xs w-52 space-y-1">
                            <p class="font-semibold text-sm">
                              {{ formatDate(weeks[i]!) }}
                            </p>
                            <p class="flex justify-between">
                              <span class="text-muted">{{
                                t('resourcePlanning.capacity')
                              }}</span>
                              <span class="tabular-nums"
                                >{{ round(g) }}
                                {{ t('resourcePlanning.hours') }}</span
                              >
                            </p>
                            <p class="flex justify-between">
                              <span class="flex items-center gap-1">
                                <span
                                  class="inline-block w-2 h-2 rounded-sm bg-warning"
                                />
                                {{ t('resourcePlanning.directLoad') }}
                              </span>
                              <span class="tabular-nums"
                                >{{ round(visDirect(e)[i] ?? 0) }}
                                {{ t('resourcePlanning.hours') }}</span
                              >
                            </p>
                            <ul
                              v-if="
                                e.defaultLoadItems.length && !team[i]?.closed
                              "
                              class="ps-3 text-muted"
                            >
                              <li
                                v-for="(it, k) in e.defaultLoadItems"
                                :key="'dl' + k"
                                class="flex justify-between gap-2"
                              >
                                <span class="truncate">{{ it.name }}</span>
                                <span class="tabular-nums shrink-0">{{
                                  round(it.hours)
                                }}</span>
                              </li>
                            </ul>
                            <p class="flex justify-between">
                              <span class="flex items-center gap-1">
                                <span
                                  class="inline-block w-2 h-2 rounded-sm bg-primary"
                                />
                                {{ t('resourcePlanning.generalLoad') }}
                              </span>
                              <span class="tabular-nums"
                                >{{ round(visGeneral(e)[i] ?? 0) }}
                                {{ t('resourcePlanning.hours') }}</span
                              >
                            </p>
                            <p
                              class="flex justify-between border-t border-default pt-1 mt-1"
                            >
                              <span class="text-muted">{{
                                t('resourcePlanning.remainingCapacity')
                              }}</span>
                              <span
                                class="tabular-nums"
                                :class="{
                                  'text-error font-medium':
                                    empRemaining(e, i) < -0.05
                                }"
                              >
                                {{ round(empRemaining(e, i)) }}
                                {{ t('resourcePlanning.hours') }}
                              </span>
                            </p>
                            <p
                              v-if="(visVacation(e)[i] ?? 0) > 0.5"
                              class="flex justify-between items-center pt-1"
                            >
                              <span class="flex items-center gap-1 text-muted">
                                <UIcon name="lucide:palmtree" />
                                {{ t('resourcePlanning.vacation') }}
                              </span>
                              <span class="tabular-nums"
                                >{{ round(visVacation(e)[i] ?? 0) }}
                                {{ t('resourcePlanning.hours') }}</span
                              >
                            </p>
                            <template v-if="(visHoliday(e)[i] ?? []).length">
                              <p class="flex justify-between items-center pt-1">
                                <span class="flex items-center gap-1">
                                  <span
                                    class="inline-block w-2 h-2 rounded-sm"
                                    :style="{ backgroundColor: holidayColor }"
                                  />
                                  {{ t('resourcePlanning.holiday') }}
                                </span>
                                <span
                                  v-if="(visHolidayHours(e)[i] ?? 0) > 0.5"
                                  class="tabular-nums"
                                  >{{ round(visHolidayHours(e)[i] ?? 0) }}
                                  {{ t('resourcePlanning.hours') }}</span
                                >
                              </p>
                              <p
                                v-for="(h, k) in visHoliday(e)[i] ?? []"
                                :key="'h' + k"
                                class="ps-3 text-muted truncate"
                              >
                                {{ h }}
                              </p>
                            </template>
                          </div>
                        </template>
                      </UPopover>
                      <div class="h-5 w-full relative shrink-0">
                        <span
                          v-if="monthTick(weeks[i]!, weeks[i - 1])"
                          class="absolute left-0 top-1 text-[11px] font-semibold text-default whitespace-nowrap"
                        >
                          {{ monthTick(weeks[i]!, weeks[i - 1]) }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </UPageCard>
      </template>
    </template>
  </div>
</template>
