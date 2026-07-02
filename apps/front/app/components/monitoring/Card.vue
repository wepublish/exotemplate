<script lang="ts" setup>
  import type { ClientMonitoring } from '~/utils/monitoring'

  const props = defineProps<{
    monitoring: ClientMonitoring | undefined
    pending: boolean
    error: Error | null
  }>()

  const { t } = useI18n()
  const { formatDateTime } = useFormatters()

  const env = computed(() => props.monitoring?.environments ?? null)
  const hasStaging = computed(() => !!env.value?.staging)
</script>

<template>
  <UPageCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="lucide:activity" class="text-primary text-xl" />
        <div class="font-bold">{{ t('monitoring.card.title') }}</div>
      </div>
    </template>

    <USkeleton v-if="pending" class="h-14" />

    <UAlert
      v-else-if="error"
      color="error"
      variant="soft"
      icon="lucide:triangle-alert"
      :title="t('monitoring.card.loadError')"
      :description="error.message"
    />

    <!-- No Medium-Name set on the client → we can't map it to a monitor. -->
    <UAlert
      v-else-if="monitoring?.state === 'notConfigured'"
      color="info"
      variant="soft"
      icon="lucide:info"
      :title="t('monitoring.card.notConfigured.title')"
      :description="t('monitoring.card.notConfigured.description')"
    />

    <!-- Medium-Name set but the configurator has no monitor for it. -->
    <UAlert
      v-else-if="monitoring?.state === 'notMonitored'"
      color="neutral"
      variant="soft"
      icon="lucide:circle-help"
      :title="t('monitoring.card.notMonitored.title')"
      :description="
        t('monitoring.card.notMonitored.description', {
          mediumName: monitoring?.mediumName ?? ''
        })
      "
    />

    <div v-else-if="monitoring?.state === 'ok'" class="flex flex-col gap-3">
      <!-- Production (primary signal for the client). -->
      <div class="flex items-center justify-between gap-3">
        <span class="text-sm font-medium">
          {{ t('monitoring.environment.production') }}
        </span>
        <MonitoringStatusBadge :env="env?.production ?? null" show-latency />
      </div>
      <p
        v-if="env?.production?.message"
        class="text-xs text-error -mt-2 break-words"
      >
        {{ env.production.message }}
      </p>

      <template v-if="hasStaging">
        <USeparator />
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm font-medium text-muted">
            {{ t('monitoring.environment.staging') }}
          </span>
          <MonitoringStatusBadge :env="env?.staging ?? null" show-latency />
        </div>
        <p
          v-if="env?.staging?.message"
          class="text-xs text-error -mt-2 break-words"
        >
          {{ env.staging.message }}
        </p>
      </template>

      <div class="flex justify-end text-xs text-muted pt-1">
        <span v-if="monitoring?.checkedAt">
          {{
            t('monitoring.card.checkedAt', {
              time: formatDateTime(monitoring.checkedAt)
            })
          }}
        </span>
      </div>
    </div>
  </UPageCard>
</template>
