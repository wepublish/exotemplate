<script lang="ts" setup>
  import { ONBOARDING_DATA_KEY } from '~~/types/OnboardingTypes'

  const data = inject(ONBOARDING_DATA_KEY)!
  const directusStore = useDirectus()
  const toast = useToast()
  const { t } = useI18n()

  const REVIEWER_EMAILS = ['elias@wepublish.ch', 'lukas@wepublish.ch']
  const reviewerEmails = ref([...REVIEWER_EMAILS])
  const reviewerMessage = ref('')
  const sendingDm = ref(false)
  const dmError = ref<string | null>(null)
  const newReviewerEmail = ref('')

  function buildReviewerMessage(): string {
    const name =
      data.clientName ||
      data.infraMediumName ||
      t('onboarding.infrastructure.reviewer.template.fallbackName')
    const configPr = data.infraResult?.config_pr?.pr_url ?? ''
    const websitePr = data.infraResult?.website_pr?.pr_url ?? ''
    return t('onboarding.infrastructure.reviewer.template.body', {
      name,
      configPr,
      websitePr
    })
  }

  // `lastGeneratedReviewerMessage` tracks the most recent auto-generated text
  // so we can tell whether the user has typed their own changes. PR URLs may
  // arrive late (via checkPendingPRs on mount), so we overwrite the stale
  // template as long as the user hasn't edited it.
  let lastGeneratedReviewerMessage = ''

  watch(
    [
      () => data.infraResult?.config_pr?.pr_url,
      () => data.infraResult?.website_pr?.pr_url,
      () => data.clientName,
      () => data.infraMediumName
    ],
    () => {
      if (!data.infraResult) return
      const next = buildReviewerMessage()
      if (
        !reviewerMessage.value.trim() ||
        reviewerMessage.value === lastGeneratedReviewerMessage
      ) {
        reviewerMessage.value = next
      }
      lastGeneratedReviewerMessage = next
    },
    { immediate: true }
  )

  function resetReviewerMessage() {
    const next = buildReviewerMessage()
    lastGeneratedReviewerMessage = next
    reviewerMessage.value = next
  }

  async function sendReviewerNotification() {
    if (reviewerEmails.value.length === 0 || !reviewerMessage.value.trim()) {
      dmError.value = t('onboarding.infrastructure.reviewer.emptyError')
      return
    }

    sendingDm.value = true
    dmError.value = null

    try {
      const result = await directusStore.postCustomEndpoint(
        'client-onboarding/slack-send-dm',
        {
          emails: reviewerEmails.value,
          message: reviewerMessage.value
        }
      )

      const results: Array<{ email: string; sent: boolean; error?: string }> =
        result.data?.results ?? []
      const sent = results.filter((r) => r.sent)
      const failed = results.filter((r) => !r.sent)

      if (failed.length === 0) {
        toast.add({
          color: 'success',
          title: t('onboarding.infrastructure.reviewer.sentToast', {
            count: sent.length
          })
        })
      } else {
        toast.add({
          color: 'warning',
          title: t('onboarding.infrastructure.reviewer.partialToast', {
            sent: sent.length,
            failed: failed.length
          }),
          description: failed.map((f) => `${f.email}: ${f.error}`).join(', ')
        })
      }
    } catch (e: any) {
      const msg =
        e?.response?.data?.errors?.[0]?.message ??
        e?.message ??
        t('common.unexpectedError')
      dmError.value = msg
      toast.add({
        color: 'error',
        title: t('onboarding.infrastructure.provisioning.errorTitle'),
        description: msg
      })
    } finally {
      sendingDm.value = false
    }
  }

  function addReviewerEmail() {
    const email = newReviewerEmail.value.trim().toLowerCase()
    if (!email) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.add({
        color: 'warning',
        title: t('onboarding.infrastructure.reviewer.invalidEmail')
      })
      return
    }
    if (!reviewerEmails.value.includes(email)) {
      reviewerEmails.value.push(email)
    }
    newReviewerEmail.value = ''
  }

  function removeReviewerEmail(index: number) {
    reviewerEmails.value.splice(index, 1)
  }
</script>

<template>
  <div
    class="flex flex-col gap-3 p-4 rounded-lg border border-neutral-200 dark:border-neutral-700"
  >
    <div class="flex items-center gap-2">
      <UIcon name="lucide:slack" class="text-lg text-primary" />
      <p class="text-sm font-semibold">
        {{ t('onboarding.infrastructure.reviewer.title') }}
      </p>
    </div>
    <p class="text-xs text-muted">
      {{ t('onboarding.infrastructure.reviewer.description') }}
    </p>

    <UFormField :label="t('onboarding.infrastructure.reviewer.recipients')">
      <div class="flex flex-wrap gap-1.5 items-center">
        <div
          v-for="(email, index) in reviewerEmails"
          :key="email"
          class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-mono"
        >
          {{ email }}
          <button
            class="hover:text-error transition-colors"
            @click="removeReviewerEmail(index)"
          >
            <UIcon name="lucide:x" class="text-sm" />
          </button>
        </div>
      </div>
      <div class="flex gap-2 mt-2">
        <UInput
          v-model="newReviewerEmail"
          type="email"
          :placeholder="
            t('onboarding.infrastructure.reviewer.addEmailPlaceholder')
          "
          class="flex-1 font-mono"
          size="xs"
          @keydown.enter.prevent="addReviewerEmail"
        />
        <UButton
          size="xs"
          variant="outline"
          color="neutral"
          icon="lucide:plus"
          :disabled="!newReviewerEmail.trim()"
          @click="addReviewerEmail"
        >
          {{ t('onboarding.infrastructure.reviewer.add') }}
        </UButton>
      </div>
    </UFormField>

    <UFormField :label="t('onboarding.infrastructure.reviewer.message')">
      <template #hint>
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="lucide:refresh-cw"
          @click="resetReviewerMessage()"
        >
          {{ t('onboarding.infrastructure.reviewer.regenerate') }}
        </UButton>
      </template>
      <UTextarea
        v-model="reviewerMessage"
        :rows="8"
        class="w-full"
        :ui="{ base: 'font-mono text-sm' }"
      />
    </UFormField>

    <UAlert
      v-if="dmError"
      color="error"
      variant="soft"
      icon="lucide:circle-alert"
    >
      <template #description>{{ dmError }}</template>
    </UAlert>

    <div class="flex justify-end">
      <UButton
        icon="lucide:send"
        :loading="sendingDm"
        :disabled="reviewerEmails.length === 0 || !reviewerMessage.trim()"
        @click="sendReviewerNotification"
      >
        {{ t('onboarding.infrastructure.reviewer.send') }}
      </UButton>
    </div>
  </div>
</template>
