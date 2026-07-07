<script lang="ts" setup>
  /**
   * Admin-authored messages (info / warning / critical) shown at the top of the
   * dashboard. Fed by the public `/messages` endpoint (via `useAnnouncements`).
   * A `dismissible` message can be *minimized* to a compact, re-expandable bar
   * (never fully removed); the minimized state is remembered per browser
   * (localStorage). Non-dismissible ones (e.g. critical) always show in full.
   */
  import type { DashboardMessage } from '~/composables/useAnnouncements'

  defineProps<{ messages: DashboardMessage[] }>()
  const { t } = useI18n()

  const STORAGE_KEY = 'wep-minimized-announcements'
  const minimized = ref<number[]>([])

  onMounted(() => {
    try {
      minimized.value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    } catch {
      minimized.value = []
    }
  })

  function persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(minimized.value))
    } catch {
      /* ignore */
    }
  }
  function minimize(id: number): void {
    if (!minimized.value.includes(id)) {
      minimized.value = [...minimized.value, id]
      persist()
    }
  }
  function expand(id: number): void {
    minimized.value = minimized.value.filter((x) => x !== id)
    persist()
  }
  const isMinimized = (m: DashboardMessage): boolean =>
    m.dismissible && minimized.value.includes(m.id)

  const colorFor = (s: DashboardMessage['severity']) =>
    s === 'critical' ? 'error' : s === 'warning' ? 'warning' : 'info'
  const iconFor = (s: DashboardMessage['severity']) =>
    s === 'critical'
      ? 'lucide:octagon-alert'
      : s === 'warning'
        ? 'lucide:triangle-alert'
        : 'lucide:info'
  const textFor = (s: DashboardMessage['severity']) =>
    s === 'critical'
      ? 'text-error'
      : s === 'warning'
        ? 'text-warning'
        : 'text-info'
</script>

<template>
  <div v-if="messages.length" class="flex flex-col gap-2">
    <template v-for="m in messages" :key="m.id">
      <!-- Minimized: a compact bar; click to expand again. -->
      <button
        v-if="isMinimized(m)"
        type="button"
        class="flex items-center gap-2 w-full text-left rounded-md border border-default bg-elevated/50 px-3 py-1.5 text-sm hover:bg-elevated transition-colors"
        :title="t('messages.expand')"
        @click="expand(m.id)"
      >
        <UIcon
          :name="iconFor(m.severity)"
          :class="[textFor(m.severity), 'shrink-0']"
        />
        <span class="font-medium truncate flex-1">{{ m.title }}</span>
        <UIcon name="lucide:chevron-down" class="text-muted shrink-0" />
      </button>

      <!-- Full alert; the "close" control minimizes (does not remove). -->
      <UAlert
        v-else
        :color="colorFor(m.severity)"
        variant="soft"
        :icon="iconFor(m.severity)"
        :title="m.title"
        :close="m.dismissible"
        :close-icon="'lucide:chevron-up'"
        @update:open="(open: boolean) => !open && minimize(m.id)"
      >
        <template v-if="m.body || m.link_url" #description>
          <div class="flex flex-col gap-2 items-start">
            <p v-if="m.body" class="whitespace-pre-line">{{ m.body }}</p>
            <UButton
              v-if="m.link_url"
              :to="m.link_url"
              target="_blank"
              rel="noopener noreferrer"
              size="xs"
              :color="colorFor(m.severity)"
              variant="outline"
              trailing-icon="lucide:external-link"
            >
              {{ m.link_label || t('messages.openLink') }}
            </UButton>
          </div>
        </template>
      </UAlert>
    </template>
  </div>
</template>
