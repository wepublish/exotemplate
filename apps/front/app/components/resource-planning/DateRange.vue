<script lang="ts" setup>
  /**
   * Range date picker for resource planning: one calendar where you click a
   * start then an end (drag-select). Bound with v-model:from / v-model:to as
   * ISO (YYYY-MM-DD) strings; displays Swiss dd.mm.yyyy. Closes once a full
   * range is chosen. Single instance per use (phase dialog / Betriebsferien),
   * so the teleported calendar is safe.
   */
  import { parseDate, type DateValue } from '@internationalized/date'

  const props = defineProps<{
    from: string
    to: string
    placeholder?: string
  }>()
  const emit = defineEmits<{
    'update:from': [string]
    'update:to': [string]
  }>()

  const open = ref(false)

  const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
  const toCal = (iso: string): DateValue | undefined =>
    isIso(iso) ? parseDate(iso) : undefined
  const fmt = (iso: string): string => {
    if (!isIso(iso)) return ''
    const [y, m, d] = iso.split('-')
    return `${d}.${m}.${y}`
  }

  const range = computed({
    get: () => ({ start: toCal(props.from), end: toCal(props.to) }),
    set: (v: { start?: DateValue; end?: DateValue } | null) => {
      const start = v?.start?.toString() ?? ''
      const end = v?.end?.toString() ?? ''
      emit('update:from', start)
      emit('update:to', end)
      // Full range picked → close the calendar.
      if (start && end) open.value = false
    }
  })

  const label = computed(() => {
    const f = fmt(props.from)
    const t = fmt(props.to)
    if (f && t) return `${f} – ${t}`
    return f || props.placeholder || 'TT.MM.JJJJ'
  })
</script>

<template>
  <UPopover v-model:open="open">
    <UButton
      icon="lucide:calendar"
      color="neutral"
      variant="outline"
      class="justify-start font-normal w-full"
    >
      {{ label }}
    </UButton>
    <template #content>
      <UCalendar v-model="range" range class="p-2" />
    </template>
  </UPopover>
</template>
