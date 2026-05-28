<script lang="ts" setup>
  import type { CaptureDayStatus } from '~/composables/useTimeTracking'

  const props = defineProps<{
    status: CaptureDayStatus
    date: string
    expectedHours: number
    capturedHours: number
    holidayName?: string
  }>()

  const HOURS_FORMATTER = new Intl.NumberFormat('de-CH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })

  function formatHours(h: number): string {
    return `${HOURS_FORMATTER.format(h)} h`
  }

  const dotClass = computed<string>(() => {
    switch (props.status) {
      case 'captured':
        return 'bg-success border-success'
      case 'partial':
        return 'bg-warning border-warning'
      case 'missing':
        return 'bg-error border-error'
      case 'absent':
        return 'bg-neutral-300 dark:bg-neutral-600 border-neutral-400 dark:border-neutral-500'
      case 'weekend':
        return 'bg-transparent border-default'
      case 'off':
        return 'bg-transparent border-muted border-dashed'
      case 'holiday':
        return 'bg-blue-300 dark:bg-blue-700 border-blue-400 dark:border-blue-600'
    }
  })

  const statusLabel = computed<string>(() => {
    switch (props.status) {
      case 'captured':
        return 'Erfasst'
      case 'partial':
        return 'Teilweise erfasst'
      case 'missing':
        return 'Nicht erfasst'
      case 'absent':
        return 'Abwesend'
      case 'weekend':
        return 'Wochenende'
      case 'off':
        return 'Frei (laut Vertrag)'
      case 'holiday':
        return props.holidayName ? `Feiertag: ${props.holidayName}` : 'Feiertag'
    }
  })

  const tooltipText = computed<string>(() => {
    const base = `${props.date}: ${statusLabel.value}`
    if (
      props.status === 'weekend' ||
      props.status === 'off' ||
      props.status === 'holiday'
    ) {
      return base
    }
    if (props.status === 'absent') return `${base} (in Clockodo)`
    const captured = formatHours(props.capturedHours)
    const expected = formatHours(props.expectedHours)
    return `${base} — ${captured} von ${expected}`
  })

  const ariaLabel = computed<string>(() => tooltipText.value)
</script>

<template>
  <UTooltip :text="tooltipText" :delay-duration="150">
    <span
      class="inline-block w-3.5 h-3.5 rounded-full border"
      :class="dotClass"
      :aria-label="ariaLabel"
      role="img"
    />
  </UTooltip>
</template>
