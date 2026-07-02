<script lang="ts" setup>
  /**
   * Surfaces the aggregatedHours cache state and lets users force a refresh.
   *
   * The aggregatedHours endpoint caches its result per (clientId, periodId) for
   * an hour to avoid Jira/Clockodo 429s. This component shows whether the data
   * the user is currently looking at came straight from those APIs ("Live") or
   * from the in-memory cache, how old the cached copy is, and when the cache
   * will refresh on its own. The refresh button invalidates only this period's
   * entry on the server and re-fetches.
   */

  export interface CacheMeta {
    hit: boolean
    cachedAt: number
    expiresAt: number
    ttlMs: number
  }

  const props = defineProps<{
    cacheInfo: CacheMeta | null
    clientPeriodId: number | undefined
    pending: boolean
    refresh: () => Promise<void>
  }>()

  const { deleteCustomEndpoint } = useDirectus()
  const userStore = useUserStore()
  const toast = useToast()
  const { t } = useI18n()

  // Tick every 30s so "vor X Min." stays accurate without user interaction.
  // Browser-only — avoids SSR memory leaks and hydration mismatch.
  const nowMs = ref(Date.now())
  if (import.meta.client) {
    const timer = setInterval(() => {
      nowMs.value = Date.now()
    }, 30_000)
    onScopeDispose(() => clearInterval(timer))
  }

  function formatDuration(ms: number): string {
    const seconds = Math.max(0, Math.round(ms / 1000))
    if (seconds < 60) return t('dashboard.cache.unit.seconds', { n: seconds })
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return t('dashboard.cache.unit.minutes', { n: minutes })
    const hours = Math.floor(minutes / 60)
    const remMin = minutes % 60
    return remMin
      ? t('dashboard.cache.unit.hoursMinutes', { h: hours, m: remMin })
      : t('dashboard.cache.unit.hours', { n: hours })
  }

  const cacheAgeText = computed<string | null>(() => {
    if (!props.cacheInfo) return null
    return formatDuration(nowMs.value - props.cacheInfo.cachedAt)
  })

  const cacheExpiresInText = computed<string | null>(() => {
    if (!props.cacheInfo) return null
    const remaining = props.cacheInfo.expiresAt - nowMs.value
    if (remaining <= 0) return t('dashboard.cache.expiresNow')
    return t('dashboard.cache.expiresIn', {
      duration: formatDuration(remaining)
    })
  })

  const isLive = computed<boolean>(
    () => !!props.cacheInfo && !props.cacheInfo.hit
  )

  const statusLabel = computed<string | null>(() => {
    if (!props.cacheInfo) return null
    if (isLive.value) return t('dashboard.cache.live')
    return t('dashboard.cache.fromCache', { age: cacheAgeText.value })
  })

  const statusColor = computed<'success' | 'neutral'>(() =>
    isLive.value ? 'success' : 'neutral'
  )

  const statusIcon = computed<string>(() =>
    isLive.value ? 'lucide:zap' : 'lucide:database'
  )

  const refreshTooltip = computed<string>(() => {
    if (!props.cacheInfo) {
      return t('dashboard.cache.refreshTooltip.noCache')
    }
    if (isLive.value) {
      return t('dashboard.cache.refreshTooltip.live', {
        expires: cacheExpiresInText.value
      })
    }
    return t('dashboard.cache.refreshTooltip.cached', {
      age: cacheAgeText.value,
      expires: cacheExpiresInText.value
    })
  })

  const refreshing = ref(false)
  const canRefresh = computed<boolean>(
    () => userStore.loggedIn && !!props.clientPeriodId
  )

  async function onRefreshClick() {
    if (!props.clientPeriodId || refreshing.value) return
    refreshing.value = true
    try {
      await deleteCustomEndpoint(
        `aggregatedHours/cache?clientPeriodId=${props.clientPeriodId}`
      )
      await props.refresh()
      const meta = props.cacheInfo
      toast.add({
        color: 'success',
        title: t('dashboard.cache.refreshSuccessTitle'),
        description: meta
          ? t('dashboard.cache.refreshSuccessWithMeta', {
              expires: cacheExpiresInText.value
            })
          : t('dashboard.cache.refreshSuccessWithoutMeta')
      })
    } catch (err: any) {
      toast.add({
        color: 'error',
        title: t('dashboard.cache.refreshErrorTitle'),
        description:
          err?.response?.data?.errors?.[0]?.message ||
          err?.message ||
          t('dashboard.cache.unknownError')
      })
    } finally {
      refreshing.value = false
    }
  }
</script>

<template>
  <div v-if="cacheInfo" class="flex items-center gap-2">
    <UBadge :color="statusColor" variant="subtle" size="lg" :icon="statusIcon">
      {{ statusLabel }}
    </UBadge>

    <UPopover mode="hover" :open-delay="200">
      <UButton
        size="sm"
        color="neutral"
        variant="link"
        icon="lucide:info"
        :aria-label="t('dashboard.cache.infoAria')"
      />
      <template #content>
        <div class="p-3 max-w-sm text-sm space-y-2">
          <p class="font-semibold">{{ t('dashboard.cache.infoTitle') }}</p>
          <p>{{ t('dashboard.cache.infoIntro') }}</p>
          <ul class="list-disc list-inside space-y-1">
            <li>
              <span class="font-medium text-success">{{
                t('dashboard.cache.infoLiveLabel')
              }}</span>
              — {{ t('dashboard.cache.infoLiveText') }}
            </li>
            <li>
              <span class="font-medium">{{
                t('dashboard.cache.infoCacheLabel')
              }}</span>
              — {{ t('dashboard.cache.infoCacheText') }}
            </li>
          </ul>
          <p>{{ t('dashboard.cache.infoOutro') }}</p>
        </div>
      </template>
    </UPopover>

    <UButton
      v-if="canRefresh"
      size="md"
      color="primary"
      variant="ghost"
      icon="lucide:refresh-cw"
      :loading="refreshing"
      :disabled="pending"
      :title="refreshTooltip"
      :aria-label="t('dashboard.cache.reloadAria')"
      @click="onRefreshClick"
    >
      {{ t('dashboard.cache.reload') }}
    </UButton>
  </div>
</template>
