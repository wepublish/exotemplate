<script lang="ts" setup>
  import type { MediumMonitoring } from '~/utils/monitoring'

  const userStore = useUserStore()
  const { t } = useI18n()
  const { formatDateTime } = useFormatters()

  // Admin-only. Skip the request entirely for non-admins (the backend also
  // 403s) so typing the URL doesn't surface a noisy error.
  const isAdmin = userStore.amIAdministrator()
  const monitoring = isAdmin ? await useMonitoringOverview() : null

  const media = computed<MediumMonitoring[]>(
    () => monitoring?.media.value ?? []
  )
  const pending = computed<boolean>(() => !!monitoring?.pending.value)
  const error = computed<Error | null>(
    () => (monitoring?.error.value as Error | null) ?? null
  )
  const checkedAt = computed<string | null>(
    () => monitoring?.checkedAt.value ?? null
  )

  const search = ref('')
  const filtered = computed<MediumMonitoring[]>(() => {
    const q = search.value.trim().toLowerCase()
    if (!q) return media.value
    return media.value.filter((m) => m.mediumName.toLowerCase().includes(q))
  })

  const refreshing = ref(false)
  async function onRefresh(): Promise<void> {
    if (!monitoring) return
    refreshing.value = true
    try {
      await monitoring.refresh()
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

    <UPageCard v-else>
      <template #header>
        <div class="flex justify-between items-center w-full gap-4">
          <div>
            <div class="font-bold text-xl">
              {{ t('monitoring.overview.title') }}
            </div>
            <div class="text-xs text-muted mt-0.5">
              {{
                t(
                  'monitoring.overview.mediaCount',
                  { count: media.length },
                  media.length
                )
              }}
              <span v-if="checkedAt">
                ·
                {{
                  t('monitoring.card.checkedAt', {
                    time: formatDateTime(checkedAt)
                  })
                }}
              </span>
            </div>
          </div>
          <UButton
            icon="lucide:refresh-cw"
            variant="outline"
            size="sm"
            :loading="refreshing"
            @click="onRefresh"
          >
            {{ t('common.refresh') }}
          </UButton>
        </div>
      </template>

      <div class="mb-4">
        <UInput
          v-model="search"
          :placeholder="t('monitoring.overview.searchPlaceholder')"
          icon="lucide:search"
        />
      </div>

      <USkeleton v-if="pending" class="h-40" />

      <UAlert
        v-else-if="error"
        color="error"
        variant="soft"
        icon="lucide:triangle-alert"
        :title="t('monitoring.card.loadError')"
        :description="error.message"
      />

      <UAlert
        v-else-if="!filtered.length"
        color="info"
        variant="soft"
        icon="lucide:info"
        :title="t('monitoring.overview.empty')"
      />

      <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <MonitoringMediumTile
          v-for="m in filtered"
          :key="m.mediumName"
          :medium="m"
        />
      </div>
    </UPageCard>
  </div>
</template>
