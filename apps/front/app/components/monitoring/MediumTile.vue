<script lang="ts" setup>
  import { statusMeta } from '~/utils/monitoring'
  import type { MediumMonitoring } from '~/utils/monitoring'

  const props = defineProps<{ medium: MediumMonitoring }>()

  const { t } = useI18n()
  const overallMeta = computed(() => statusMeta(props.medium.overall))
</script>

<template>
  <UPageCard class="h-full">
    <div class="flex flex-col gap-3">
      <!-- Header: medium name + overall status accent -->
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="font-bold truncate">{{ medium.mediumName }}</div>
        </div>
        <UIcon
          :name="overallMeta.icon"
          :class="`text-${overallMeta.color} text-lg shrink-0`"
        />
      </div>

      <div class="flex items-center justify-between gap-3">
        <span class="text-sm font-medium">
          {{ t('monitoring.environment.production') }}
        </span>
        <MonitoringStatusBadge
          :env="medium.environments.production"
          show-latency
        />
      </div>

      <div
        v-if="medium.environments.staging"
        class="flex items-center justify-between gap-3"
      >
        <span class="text-sm font-medium text-muted">
          {{ t('monitoring.environment.staging') }}
        </span>
        <MonitoringStatusBadge
          :env="medium.environments.staging"
          show-latency
        />
      </div>
    </div>
  </UPageCard>
</template>
