<script lang="ts" setup>
  import { ONBOARDING_DATA_KEY } from '~~/types/OnboardingTypes'

  const data = inject(ONBOARDING_DATA_KEY)!
  const directusStore = useDirectus()
  const toast = useToast()

  const REVIEWER_EMAILS = ['elias@wepublish.ch', 'lukas@wepublish.ch']
  const reviewerEmails = ref([...REVIEWER_EMAILS])
  const reviewerMessage = ref('')
  const sendingDm = ref(false)
  const dmError = ref<string | null>(null)
  const newReviewerEmail = ref('')

  function buildReviewerMessage(): string {
    const name = data.clientName || data.infraMediumName || 'neues Medium'
    const configPr = data.infraResult?.config_pr?.pr_url ?? ''
    const websitePr = data.infraResult?.website_pr?.pr_url ?? ''
    return `Hoi Elias und Lukas

bitte reviewt die offenen Pull Requests für das neue Medium «${name}» und merged sie:
• ${configPr}
• ${websitePr}

Sobald die Merges durch sind, kurze Rückmeldung, damit das Onboarding weitergeführt werden kann.

Danke!`
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
      dmError.value = 'Empfänger und Nachricht dürfen nicht leer sein.'
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
          title: `Nachricht an ${sent.length} Reviewer gesendet.`
        })
      } else {
        toast.add({
          color: 'warning',
          title: `${sent.length} gesendet, ${failed.length} fehlgeschlagen`,
          description: failed.map((f) => `${f.email}: ${f.error}`).join(', ')
        })
      }
    } catch (e: any) {
      const msg =
        e?.response?.data?.errors?.[0]?.message ??
        e?.message ??
        'Unbekannter Fehler'
      dmError.value = msg
      toast.add({ color: 'error', title: 'Fehler', description: msg })
    } finally {
      sendingDm.value = false
    }
  }

  function addReviewerEmail() {
    const email = newReviewerEmail.value.trim().toLowerCase()
    if (!email) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.add({ color: 'warning', title: 'Ungültige E-Mail-Adresse' })
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
      <UIcon name="simple-icons:slack" class="text-lg text-primary" />
      <p class="text-sm font-semibold">Reviewer per Slack benachrichtigen</p>
    </div>
    <p class="text-xs text-muted">
      Sendet eine Direktnachricht in Slack an die unten aufgeführten Empfänger.
      Nachrichtentext kann vor dem Senden angepasst werden.
    </p>

    <UFormField label="Empfänger">
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
            <UIcon name="material-symbols:close-rounded" class="text-sm" />
          </button>
        </div>
      </div>
      <div class="flex gap-2 mt-2">
        <UInput
          v-model="newReviewerEmail"
          type="email"
          placeholder="weitere E-Mail hinzufügen"
          class="flex-1 font-mono"
          size="xs"
          @keydown.enter.prevent="addReviewerEmail"
        />
        <UButton
          size="xs"
          variant="outline"
          color="neutral"
          icon="material-symbols:add-rounded"
          :disabled="!newReviewerEmail.trim()"
          @click="addReviewerEmail"
        >
          Hinzufügen
        </UButton>
      </div>
    </UFormField>

    <UFormField label="Nachricht">
      <template #hint>
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="material-symbols:refresh-rounded"
          @click="resetReviewerMessage()"
        >
          Neu generieren
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
      icon="material-symbols:error-rounded"
    >
      <template #description>{{ dmError }}</template>
    </UAlert>

    <div class="flex justify-end">
      <UButton
        icon="material-symbols:send-rounded"
        :loading="sendingDm"
        :disabled="reviewerEmails.length === 0 || !reviewerMessage.trim()"
        @click="sendReviewerNotification"
      >
        Nachricht senden
      </UButton>
    </div>
  </div>
</template>
