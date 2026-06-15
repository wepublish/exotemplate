<script lang="ts" setup>
  import type { JiraWarning } from '~~/types/DirectusTypes'

  export type WarningAction =
    | 'requestHalt'
    | 'resolveHalt'
    | 'silence'
    | 'unsilence'

  const props = defineProps<{
    warning: JiraWarning
    pendingAction?: WarningAction | null
  }>()

  const emit = defineEmits<{
    requestHalt: [warning: JiraWarning]
    resolveHalt: [warning: JiraWarning]
    silence: [warning: JiraWarning]
    unsilence: [warning: JiraWarning]
  }>()

  const { t } = useI18n()

  const busy = computed<boolean>(() => props.pendingAction != null)
  function isPending(action: WarningAction): boolean {
    return props.pendingAction === action
  }
</script>

<template>
  <div class="flex gap-2 flex-wrap justify-end">
    <UButton
      v-if="!warning.halt_requested"
      size="xs"
      color="error"
      variant="outline"
      icon="lucide:circle-stop"
      :loading="isPending('requestHalt')"
      :disabled="busy && !isPending('requestHalt')"
      @click="emit('requestHalt', warning)"
    >
      {{ t('workLog.actions.stopWork') }}
    </UButton>
    <UButton
      v-else
      size="xs"
      color="success"
      variant="solid"
      icon="lucide:circle-play"
      :loading="isPending('resolveHalt')"
      :disabled="busy && !isPending('resolveHalt')"
      @click="emit('resolveHalt', warning)"
    >
      {{ t('workLog.actions.resolveHalt') }}
    </UButton>
    <UButton
      v-if="!warning.silenced_permanently"
      size="xs"
      color="neutral"
      variant="soft"
      icon="i-heroicons-bell-slash"
      :loading="isPending('silence')"
      :disabled="busy && !isPending('silence')"
      @click="emit('silence', warning)"
    >
      {{ t('workLog.actions.silence') }}
    </UButton>
    <UButton
      v-else
      size="xs"
      color="primary"
      variant="soft"
      icon="i-heroicons-bell"
      :loading="isPending('unsilence')"
      :disabled="busy && !isPending('unsilence')"
      @click="emit('unsilence', warning)"
    >
      {{ t('workLog.actions.unsilence') }}
    </UButton>
  </div>
</template>
