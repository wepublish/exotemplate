<script lang="ts" setup>
  import { statusMeta, formatLatency } from '~/utils/monitoring'
  import type { EnvironmentHealth } from '~/utils/monitoring'

  const props = defineProps<{
    env: EnvironmentHealth | null
    showLatency?: boolean
  }>()

  const { t } = useI18n()

  const meta = computed(() => statusMeta(props.env?.status ?? 'unknown'))
  const latency = computed(() =>
    props.env ? formatLatency(props.env.responseTimeMs) : null
  )
</script>

<template>
  <div class="flex items-center gap-2">
    <UBadge :color="meta.color" variant="subtle" size="sm" class="gap-1">
      <UIcon :name="meta.icon" />
      {{ t(meta.labelKey) }}
    </UBadge>
    <span v-if="showLatency && latency" class="text-xs text-muted tabular-nums">
      {{ latency }}
    </span>
  </div>
</template>
