<script lang="ts" setup>
  import type { OverviewEntry } from '~/composables/useClientsOverview'

  const userStore = useUserStore()
  const toast = useToast()
  const { t } = useI18n()

  type SortKey =
    | 'budget_desc'
    | 'budget_asc'
    | 'client_name'
    | 'days_remaining_asc'
    | 'period_from_desc'

  const sortOptions = computed<{ value: SortKey; label: string }[]>(() => [
    { value: 'budget_desc', label: t('overview.sort.budgetDesc') },
    { value: 'budget_asc', label: t('overview.sort.budgetAsc') },
    { value: 'client_name', label: t('overview.sort.clientName') },
    {
      value: 'days_remaining_asc',
      label: t('overview.sort.daysRemainingAsc')
    },
    { value: 'period_from_desc', label: t('overview.sort.periodFromDesc') }
  ])

  const sortKey = ref<SortKey>('budget_desc')
  const search = ref<string>('')

  // Only admins get to call the endpoint. We still rely on the backend's
  // 403 gate, but skipping the request avoids a noisy error for non-admin
  // users who land here by typing the URL.
  const overview = userStore.amIAdministrator()
    ? await useClientsOverview()
    : null

  const entries = computed<OverviewEntry[]>(() => overview?.entries.value ?? [])
  const pending = computed<boolean>(() => !!overview?.pending.value)
  const error = computed<Error | null>(
    () => (overview?.error.value as Error | null) ?? null
  )
  const schemaMissing = computed<boolean>(() => !!overview?.schemaMissing.value)

  function pct(entry: OverviewEntry): number {
    return entry.sums?.totalUsedPercentage ?? 0
  }

  function daysRemaining(entry: OverviewEntry): number {
    const to = new Date(entry.period.to).getTime()
    return Math.max(0, Math.round((to - Date.now()) / (1000 * 60 * 60 * 24)))
  }

  // Over-budget tiles (>=100%) always sort above under-budget ones regardless
  // of the secondary sort — the page must never bury a red tile by accident
  // when the user changes the sort dropdown.
  function compareEntries(
    a: OverviewEntry,
    b: OverviewEntry,
    key: SortKey
  ): number {
    const aOver = pct(a) >= 100
    const bOver = pct(b) >= 100
    if (aOver !== bOver) return aOver ? -1 : 1
    if (aOver && bOver && pct(a) !== pct(b)) return pct(b) - pct(a)

    switch (key) {
      case 'budget_desc':
        return pct(b) - pct(a)
      case 'budget_asc':
        return pct(a) - pct(b)
      case 'client_name':
        return a.client.name.localeCompare(b.client.name, 'de-CH')
      case 'days_remaining_asc':
        return daysRemaining(a) - daysRemaining(b)
      case 'period_from_desc':
        return b.period.from.localeCompare(a.period.from)
      default:
        return 0
    }
  }

  const filtered = computed<OverviewEntry[]>(() => {
    const needle = search.value.trim().toLocaleLowerCase('de-CH')
    if (!needle) return entries.value
    return entries.value.filter((entry) => {
      const haystack = [
        entry.client.name,
        entry.period.name ?? '',
        entry.period.from,
        entry.period.to
      ]
        .join(' ')
        .toLocaleLowerCase('de-CH')
      return haystack.includes(needle)
    })
  })

  const sorted = computed<OverviewEntry[]>(() => {
    const list = [...filtered.value]
    return list.sort((a, b) => compareEntries(a, b, sortKey.value))
  })

  const overdueCount = computed<number>(
    () => entries.value.filter((e) => pct(e) >= 100).length
  )

  const freshestRelative = computed<string | null>(() => {
    let newest: number | null = null
    for (const e of entries.value) {
      if (!e.computedAt) continue
      const t = new Date(e.computedAt).getTime()
      if (newest === null || t > newest) newest = t
    }
    if (newest === null) return null
    const minutes = Math.round((Date.now() - newest) / 60000)
    if (minutes < 1) return t('overview.tile.justUpdated')
    if (minutes < 60) return t('overview.tile.minutesAgo', { n: minutes })
    const hours = Math.round(minutes / 60)
    if (hours < 24) return t('overview.tile.hoursAgo', { n: hours })
    const days = Math.round(hours / 24)
    return t('overview.tile.daysAgo', { n: days }, days)
  })

  async function onTileRefresh(clientPeriodId: number): Promise<void> {
    if (!overview) return
    try {
      await overview.refreshOne(clientPeriodId)
      toast.add({ color: 'success', title: t('overview.refreshSuccess') })
    } catch (err) {
      toast.add({
        color: 'error',
        title: t('overview.refreshError'),
        description: err instanceof Error ? err.message : String(err)
      })
    }
  }

  async function onRefreshAll(): Promise<void> {
    if (!overview) return
    await overview.refresh()
  }
</script>

<template>
  <!-- Access denied for non-admins -->
  <div v-if="!userStore.amIAdministrator()" class="flex justify-center pt-16">
    <UPageCard class="max-w-md w-full">
      <template #header>
        <div class="flex items-center gap-3">
          <UIcon name="lucide:lock" class="text-3xl text-error" />
          <div>
            <p class="font-bold text-lg">
              {{ t('common.accessDenied.title') }}
            </p>
          </div>
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

  <div v-else>
    <UPageCard>
      <template #header>
        <div class="flex justify-between items-center w-full gap-4">
          <div>
            <div class="font-bold text-xl">{{ t('overview.title') }}</div>
            <div class="text-xs text-muted mt-0.5">
              {{
                t(
                  'overview.projectCount',
                  { count: entries.length },
                  entries.length
                )
              }}
              <span v-if="overdueCount > 0">
                ·
                <span class="text-error font-medium">
                  {{
                    t(
                      'overview.overdueCount',
                      { count: overdueCount },
                      overdueCount
                    )
                  }}
                </span>
              </span>
              <span v-if="freshestRelative">
                ·
                {{ t('overview.lastUpdated', { relative: freshestRelative }) }}
              </span>
            </div>
          </div>
          <UButton
            icon="lucide:refresh-cw"
            variant="outline"
            size="sm"
            :loading="pending"
            @click="onRefreshAll"
          >
            {{ t('common.refresh') }}
          </UButton>
        </div>
      </template>

      <!-- Toolbar -->
      <div class="flex flex-col sm:flex-row gap-3 mb-4">
        <UInput
          v-model="search"
          :placeholder="t('overview.searchPlaceholder')"
          icon="lucide:search"
          class="flex-1"
        />
        <USelect
          v-model="sortKey"
          :items="sortOptions"
          value-key="value"
          class="sm:w-72"
        />
      </div>

      <!-- Schema-missing warning -->
      <UAlert
        v-if="schemaMissing"
        class="mb-4"
        color="warning"
        variant="soft"
        icon="lucide:triangle-alert"
        :title="t('overview.schemaMissing.title')"
        :description="t('overview.schemaMissing.description')"
      />

      <!-- Loading -->
      <div
        v-if="pending && !entries.length"
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <USkeleton v-for="i in 6" :key="i" class="h-48" />
      </div>

      <!-- Error -->
      <UAlert
        v-else-if="error"
        color="error"
        variant="soft"
        icon="lucide:triangle-alert"
        :title="t('overview.loadError')"
        :description="error.message"
      />

      <!-- Empty -->
      <UAlert
        v-else-if="!sorted.length"
        color="neutral"
        variant="soft"
        icon="lucide:info"
        :title="t('overview.empty.title')"
        :description="t('overview.empty.description')"
      />

      <!-- Tile grid -->
      <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <OverviewClientTile
          v-for="entry in sorted"
          :key="entry.clientPeriodId"
          :entry="entry"
          @refresh="onTileRefresh"
        />
      </div>
    </UPageCard>
  </div>
</template>
