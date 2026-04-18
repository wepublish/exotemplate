<script lang="ts" setup>
  import { ONBOARDING_DATA_KEY } from '~~/types/OnboardingTypes'
  import InfrastructureForm from './infrastructure/InfrastructureForm.vue'
  import InfrastructurePolling from './infrastructure/InfrastructurePolling.vue'
  import InfrastructureSummary from './infrastructure/InfrastructureSummary.vue'
  import InfrastructureReviewerNotification from './infrastructure/InfrastructureReviewerNotification.vue'

  const data = inject(ONBOARDING_DATA_KEY)!

  const {
    loading,
    polling,
    cancelling,
    checkingPending,
    completed,
    executionError,
    pollStatus,
    editorUrl,
    websiteUrl,
    apiUrl,
    mediumNameValid,
    execute,
    checkPendingPRs,
    cancelOnboarding
  } = useInfrastructureProvisioning()

  onMounted(() => {
    checkPendingPRs()
  })
</script>

<template>
  <div
    v-if="checkingPending && !completed"
    class="flex flex-col items-center gap-3 py-6"
  >
    <UIcon
      name="material-symbols:sync-rounded"
      class="text-3xl text-muted animate-spin"
    />
    <p class="text-sm text-muted">
      Bestehende Onboarding-PRs werden geprüft...
    </p>
  </div>

  <div v-else-if="completed && data.infraResult" class="flex flex-col gap-4">
    <InfrastructureSummary
      :editor-url="editorUrl"
      :website-url="websiteUrl"
      :api-url="apiUrl"
    />

    <InfrastructureReviewerNotification />

    <div class="flex justify-end">
      <UButton
        color="error"
        variant="outline"
        icon="material-symbols:cancel-rounded"
        :loading="cancelling"
        @click="cancelOnboarding"
      >
        PRs abbrechen
      </UButton>
    </div>
  </div>

  <InfrastructurePolling v-else-if="polling" :status="pollStatus" />

  <InfrastructureForm
    v-else
    :loading="loading"
    :error="executionError"
    :editor-url="editorUrl"
    :website-url="websiteUrl"
    :medium-name-valid="mediumNameValid"
    @execute="execute"
  />
</template>
