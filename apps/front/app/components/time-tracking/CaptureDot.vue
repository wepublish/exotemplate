<script lang="ts" setup>
  import type { CaptureDayStatus } from '~/composables/useTimeTracking'

  const props = defineProps<{
    status: CaptureDayStatus
    date: string
    expectedHours: number
    capturedHours: number
    holidayName?: string
  }>()

  const { t } = useI18n()
  const { formatHours } = useFormatters()

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
        return t('timeTracking.dot.captured')
      case 'partial':
        return t('timeTracking.dot.partial')
      case 'missing':
        return t('timeTracking.dot.missing')
      case 'absent':
        return t('timeTracking.dot.absent')
      case 'weekend':
        return t('timeTracking.dot.weekend')
      case 'off':
        return t('timeTracking.dot.off')
      case 'holiday':
        return props.holidayName
          ? t('timeTracking.dot.holidayNamed', { name: props.holidayName })
          : t('timeTracking.dot.holiday')
    }
  })

  const tooltipText = computed<string>(() => {
    const base = t('timeTracking.dot.tooltipBase', {
      date: props.date,
      label: statusLabel.value
    })
    if (
      props.status === 'weekend' ||
      props.status === 'off' ||
      props.status === 'holiday'
    ) {
      return base
    }
    if (props.status === 'absent')
      return t('timeTracking.dot.absentInClockodo', { base })
    const captured = formatHours(props.capturedHours)
    const expected = formatHours(props.expectedHours)
    return t('timeTracking.dot.tooltipHours', { base, captured, expected })
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
