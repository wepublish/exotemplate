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

  // Tick every 30s so "vor X Min." stays accurate without user interaction.
  // Browser-only — avoids SSR memory leaks and hydration mismatch.
  const nowMs = ref(Date.now())
  if (import.meta.client) {
    const timer = setInterval(() => {
      nowMs.value = Date.now()
    }, 30_000)
    onScopeDispose(() => clearInterval(timer))
  }

  function formatDurationDe(ms: number): string {
    const seconds = Math.max(0, Math.round(ms / 1000))
    if (seconds < 60) return `${seconds} Sek.`
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes} Min.`
    const hours = Math.floor(minutes / 60)
    const remMin = minutes % 60
    return remMin ? `${hours} Std. ${remMin} Min.` : `${hours} Std.`
  }

  const cacheAgeText = computed<string | null>(() => {
    if (!props.cacheInfo) return null
    return formatDurationDe(nowMs.value - props.cacheInfo.cachedAt)
  })

  const cacheExpiresInText = computed<string | null>(() => {
    if (!props.cacheInfo) return null
    const remaining = props.cacheInfo.expiresAt - nowMs.value
    if (remaining <= 0) return 'läuft jetzt ab'
    return `läuft in ${formatDurationDe(remaining)} ab`
  })

  const isLive = computed<boolean>(
    () => !!props.cacheInfo && !props.cacheInfo.hit
  )

  const statusLabel = computed<string | null>(() => {
    if (!props.cacheInfo) return null
    if (isLive.value) return 'Live-Daten'
    return `Aus Cache (vor ${cacheAgeText.value})`
  })

  const statusColor = computed<'success' | 'neutral'>(() =>
    isLive.value ? 'success' : 'neutral'
  )

  const statusIcon = computed<string>(() =>
    isLive.value ? 'i-lucide-zap' : 'i-lucide-database'
  )

  const refreshTooltip = computed<string>(() => {
    if (!props.cacheInfo) {
      return 'Daten aus Jira und Clockodo neu laden'
    }
    if (isLive.value) {
      return `Cache leeren und neu laden — die Daten sind bereits live (Cache ${cacheExpiresInText.value}). Nur klicken, wenn sich seitdem etwas in Jira oder Clockodo geändert hat.`
    }
    return `Cache leeren und Daten frisch von Jira & Clockodo holen. (Cache derzeit vor ${cacheAgeText.value} angelegt, ${cacheExpiresInText.value}.)`
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
        title: 'Daten neu geladen',
        description: meta
          ? `Frisch von Jira & Clockodo geholt — Cache ${cacheExpiresInText.value}.`
          : 'Jira- und Clockodo-Daten wurden frisch geladen.'
      })
    } catch (err: any) {
      toast.add({
        color: 'error',
        title: 'Aktualisieren fehlgeschlagen',
        description:
          err?.response?.data?.errors?.[0]?.message ||
          err?.message ||
          'Unbekannter Fehler'
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
        icon="i-lucide-info"
        aria-label="Wie funktioniert der Cache?"
      />
      <template #content>
        <div class="p-3 max-w-sm text-sm space-y-2">
          <p class="font-semibold">Wie funktioniert das Caching?</p>
          <p>
            Jira und Clockodo limitieren Abfragen ("429 Too Many Requests").
            Damit das Dashboard für alle schnell und stabil bleibt, werden die
            zusammengefassten Stunden pro Projekt und Zeitraum auf dem Server
            für eine Stunde zwischengespeichert.
          </p>
          <ul class="list-disc list-inside space-y-1">
            <li>
              <span class="font-medium text-success">Live-Daten</span> — gerade
              direkt von Jira &amp; Clockodo geholt.
            </li>
            <li>
              <span class="font-medium">Aus Cache</span> — gespeicherte Kopie,
              kann bis zu eine Stunde alt sein.
            </li>
          </ul>
          <p>
            Klicke auf das Aktualisieren-Symbol, um den Cache für den aktuell
            gewählten Zeitraum zu leeren und Jira &amp; Clockodo neu abzufragen.
            Andere Projekte oder Zeiträume bleiben unberührt.
          </p>
        </div>
      </template>
    </UPopover>

    <UButton
      v-if="canRefresh"
      size="md"
      color="primary"
      variant="ghost"
      icon="i-lucide-refresh-cw"
      :loading="refreshing"
      :disabled="pending"
      :title="refreshTooltip"
      aria-label="Daten neu laden"
      @click="onRefreshClick"
    >
      Neu laden
    </UButton>
  </div>
</template>
