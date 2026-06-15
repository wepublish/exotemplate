<script lang="ts" setup>
  defineProps<{
    status: string | null
  }>()

  const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col gap-4">
    <UAlert color="info" variant="soft" icon="lucide:hourglass">
      <template #title>{{
        t('onboarding.infrastructure.polling.title')
      }}</template>
      <template #description>
        {{ t('onboarding.infrastructure.polling.description') }}
      </template>
    </UAlert>

    <div class="flex flex-col items-center gap-3 py-6">
      <UIcon
        name="lucide:refresh-cw"
        class="text-4xl text-primary animate-spin"
      />
      <p class="text-sm text-muted">{{ status }}</p>
    </div>
  </div>
</template>
