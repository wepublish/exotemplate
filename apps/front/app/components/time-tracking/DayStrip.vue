<script lang="ts" setup>
  import type { CaptureUserDay } from '~/composables/useTimeTracking'

  const props = defineProps<{
    days: CaptureUserDay[]
  }>()

  const { formatDate } = useFormatters()

  function weekdayLabel(date: string): string {
    return formatDate(parseUtcDate(date), {
      weekday: 'short',
      timeZone: 'UTC'
    }).replace(/\.$/, '')
  }

  function dayOfMonth(date: string): string {
    return String(parseUtcDate(date).getUTCDate())
  }

  /**
   * Parse a YYYY-MM-DD string as a UTC date. Without forcing UTC, browsers in
   * negative-offset timezones would shift the date back by one calendar day.
   */
  function parseUtcDate(value: string): Date {
    const [y, m, d] = value.split('-').map((p) => Number(p))
    return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1))
  }

  const cells = computed(() =>
    props.days.map((day) => ({
      key: day.date,
      weekday: weekdayLabel(day.date),
      dom: dayOfMonth(day.date),
      day
    }))
  )
</script>

<template>
  <div class="flex items-end gap-2">
    <div
      v-for="cell in cells"
      :key="cell.key"
      class="flex flex-col items-center gap-1 text-xs text-muted"
    >
      <span class="leading-none">{{ cell.weekday }}</span>
      <TimeTrackingCaptureDot
        :status="cell.day.status"
        :date="cell.day.date"
        :expected-hours="cell.day.expectedHours"
        :captured-hours="cell.day.capturedHours"
        :holiday-name="cell.day.holidayName"
      />
      <span class="leading-none">{{ cell.dom }}</span>
    </div>
  </div>
</template>
