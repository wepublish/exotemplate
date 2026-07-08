<script lang="ts" setup>
  import type { SentryChart, SentryTable } from '~/utils/sentry'

  const userStore = useUserStore()
  const { t } = useI18n()
  const { selectedClient, selectedClientId } = storeToRefs(useClientSelection())

  // Admin-only. Skip the request entirely for non-admins (the backend also
  // 403s) so typing the URL doesn't surface a noisy error.
  const isAdmin = userStore.amIAdministrator()

  // Sentry queries are scoped to the selected client's medium_name. Pass null
  // (⇒ no request) when it's missing so we show a hint instead of a raw error.
  const hasMedium = computed(() => !!selectedClient.value?.medium_name)
  const sentryClientId = computed<string | null>(() =>
    hasMedium.value ? (selectedClientId.value ?? null) : null
  )
  const sentry = isAdmin ? await useSentryData(sentryClientId) : null

  const charts = computed<SentryChart[]>(() => sentry?.data.value?.charts ?? [])
  const tables = computed<SentryTable[]>(() => sentry?.data.value?.tables ?? [])
  const pending = computed<boolean>(() => !!sentry?.pending.value)
  const error = computed<Error | null>(
    () => (sentry?.error.value as Error | null) ?? null
  )

  const refreshing = ref(false)
  async function onRefresh(): Promise<void> {
    if (!sentry) return
    refreshing.value = true
    try {
      await sentry.refresh()
    } finally {
      refreshing.value = false
    }
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

    <div v-else class="space-y-4">
      <!-- Page header -->
      <div class="flex justify-between items-start gap-4">
        <div class="font-bold text-xl">{{ t('sentry.title') }}</div>
        <UButton
          icon="lucide:refresh-cw"
          variant="outline"
          size="sm"
          class="shrink-0 cursor-pointer"
          :loading="refreshing"
          @click="onRefresh"
        >
          {{ t('common.refresh') }}
        </UButton>
      </div>

      <UAlert
        v-if="!hasMedium"
        color="info"
        variant="soft"
        icon="lucide:info"
        :title="t('sentry.noMedium')"
      />

      <template v-else-if="pending">
        <USkeleton class="h-80" />
        <USkeleton class="h-80" />
      </template>

      <UAlert
        v-else-if="error"
        color="error"
        variant="soft"
        icon="lucide:triangle-alert"
        :title="t('sentry.loadError')"
        :description="error.message"
      />

      <template v-else>
        <SentryChartCard
          v-for="chart in charts"
          :key="chart.key"
          :chart="chart"
        />
        <SentryTableCard
          v-for="table in tables"
          :key="table.key"
          :table="table"
        />
      </template>
    </div>
  </div>
</template>
