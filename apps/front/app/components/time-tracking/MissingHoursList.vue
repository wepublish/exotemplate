<script lang="ts" setup>
  import type { CaptureUserRow } from '~/composables/useTimeTracking'

  const props = defineProps<{
    rows: CaptureUserRow[]
    togglingId?: number | null
  }>()

  const emit = defineEmits<{
    'toggle-ignored': [row: CaptureUserRow]
  }>()

  function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return '?'
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
  }

  function summaryColor(
    row: CaptureUserRow
  ): 'success' | 'warning' | 'error' | 'neutral' {
    if (row.expectedDays === 0) return 'neutral'
    const ratio = row.capturedDays / row.expectedDays
    if (ratio >= 1) return 'success'
    if (ratio >= 0.6) return 'warning'
    return 'error'
  }

  /**
   * Sort: ignored users always pinned to the bottom. Within the non-ignored
   * group, biggest gap (most missing days) first so the people who need a
   * nudge surface at the top; ties resolved alphabetically.
   */
  const sortedRows = computed<CaptureUserRow[]>(() => {
    return [...props.rows].sort((a, b) => {
      if (a.ignored !== b.ignored) return a.ignored ? 1 : -1
      const aGap = a.expectedDays - a.capturedDays
      const bGap = b.expectedDays - b.capturedDays
      if (aGap !== bGap) return bGap - aGap
      return a.name.localeCompare(b.name, 'de')
    })
  })
</script>

<template>
  <div class="space-y-3">
    <div v-if="sortedRows.length === 0" class="text-sm text-muted">
      Keine Mitarbeiter:innen mit aktivem Clockodo-Soll-Vertrag im Zeitraum
      gefunden.
    </div>

    <div
      v-for="row in sortedRows"
      :key="row.id"
      class="flex items-center gap-4 p-3 rounded-lg border border-default"
      :class="row.ignored ? 'opacity-60' : ''"
    >
      <UAvatar :alt="row.name" size="md" :text="initials(row.name)" />

      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <p class="font-medium truncate">{{ row.name }}</p>
          <UBadge
            v-if="row.ignored"
            color="neutral"
            variant="subtle"
            size="sm"
            icon="material-symbols:person-off-outline"
          >
            Ignoriert
          </UBadge>
        </div>
        <p class="text-xs text-muted truncate">
          {{ row.email }}
          <span v-if="row.ignored && row.ignoredReason">
            — {{ row.ignoredReason }}
          </span>
        </p>
      </div>

      <TimeTrackingDayStrip :days="row.days" />

      <UBadge
        :color="summaryColor(row)"
        variant="subtle"
        size="md"
        class="shrink-0"
      >
        {{ row.capturedDays }} / {{ row.expectedDays }} Tage
      </UBadge>

      <UButton
        :icon="
          row.ignored
            ? 'material-symbols:notifications-active-outline'
            : 'material-symbols:notifications-off-outline'
        "
        size="sm"
        :color="row.ignored ? 'primary' : 'neutral'"
        variant="ghost"
        :loading="togglingId === row.id"
        :title="
          row.ignored
            ? 'Benachrichtigungen wieder aktivieren'
            : 'Diese Person ignorieren (keine Slack-Erinnerung)'
        "
        :aria-label="
          row.ignored
            ? 'Benachrichtigungen wieder aktivieren'
            : 'Diese Person ignorieren'
        "
        @click="emit('toggle-ignored', row)"
      />
    </div>
  </div>
</template>
