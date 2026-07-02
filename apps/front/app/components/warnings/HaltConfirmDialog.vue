<script lang="ts" setup>
  import type { JiraWarning } from '~~/types/DirectusTypes'

  const props = defineProps<{
    warning: JiraWarning | null
  }>()

  const emit = defineEmits<{
    confirm: []
    cancel: []
  }>()

  const { t } = useI18n()

  // The issue key is rendered with monospace emphasis inside the sentence, so
  // we build the highlighted markup here and inject it into the (HTML) message.
  const introHtml = computed<string>(() =>
    t('workLog.confirmDialog.intro', {
      key: `<span class="font-mono font-semibold">${props.warning?.jira_issue_key ?? ''}</span>`
    })
  )
</script>

<template>
  <UModal
    :open="warning !== null"
    @update:open="
      (v: boolean) => {
        if (!v) emit('cancel')
      }
    "
  >
    <template #content>
      <div class="p-6 space-y-4">
        <div class="flex items-center gap-3">
          <UIcon name="lucide:circle-stop" class="text-3xl text-error" />
          <h3 class="text-lg font-bold">
            {{ t('workLog.confirmDialog.title') }}
          </h3>
        </div>
        <p class="text-sm" v-html="introHtml" />
        <div class="text-sm space-y-2 border-l-4 border-error-500 pl-3">
          <p v-html="t('workLog.confirmDialog.whatHappens')" />
          <p v-html="t('workLog.confirmDialog.untilWhen')" />
          <p class="text-muted">
            {{ t('workLog.confirmDialog.hint') }}
          </p>
        </div>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="emit('cancel')">
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            color="error"
            variant="solid"
            icon="lucide:circle-stop"
            @click="emit('confirm')"
          >
            {{ t('workLog.confirmDialog.confirm') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
