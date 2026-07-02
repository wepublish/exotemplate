<script lang="ts" setup>
  import { ONBOARDING_DATA_KEY } from '~~/types/OnboardingTypes'

  const data = inject(ONBOARDING_DATA_KEY)!
  const toast = useToast()
  const { invite, listMembers } = useTeam()
  const { $i18n } = useNuxtApp()

  // Pre-fill recipient from the (single) onboarding user
  watch(
    () => data.users[0]?.email,
    (email) => {
      if (email && !data.emailTo) data.emailTo = email
    },
    { immediate: true }
  )

  // ── Activation link ────────────────────────────────────────────────────────
  // The user was created in step 1 (status 'invited', no password). Instead of
  // sending a separate Directus invite, we fetch the tokenized activation link
  // here and embed it in the welcome mail text below. The /team/invite call is
  // idempotent (re-links if needed, never re-mails for sendInvite:false) and
  // returns the link only for invited users (so an existing active account
  // yields an empty link and we fall back to a plain login URL).

  const inviteAcceptUrl = ref('')

  // On a *resumed* onboarding the step-1 user isn't held in memory, so pull the
  // client's primary member here. Without this the welcome mail has no
  // recipient/name and the activation link can't be generated (it would fall
  // back to a plain login URL).
  async function hydrateRecipientFromClient() {
    if (!data.clientId) return
    if (data.users[0]?.email?.trim()) return // already entered this session
    try {
      const members = await listMembers(data.clientId)
      const m = members[0]
      if (m && data.users[0]) {
        data.users[0].firstName = m.first_name ?? ''
        data.users[0].lastName = m.last_name ?? ''
        data.users[0].email = m.email
        data.users[0].directusUserId = m.id
        if (!data.emailTo) data.emailTo = m.email
      }
    } catch {
      // ignore — falls back to the login link
    }
  }

  async function fetchInviteLink() {
    const u = data.users[0]
    if (!data.clientId || !u?.email?.trim()) {
      inviteAcceptUrl.value = ''
      return
    }
    try {
      const res = await invite({
        email: u.email.trim(),
        firstName: u.firstName || undefined,
        lastName: u.lastName || undefined,
        clientIds: [data.clientId],
        sendInvite: false,
        returnInviteUrl: true
      })
      inviteAcceptUrl.value = res.acceptInviteUrl ?? ''
    } catch {
      // Backend not reachable / not an invited user → fall back to login URL.
      inviteAcceptUrl.value = ''
    }
  }

  onMounted(async () => {
    await hydrateRecipientFromClient()
    await fetchInviteLink()
    await loadAndRegenerate()
  })
  watch(() => [data.clientId, data.users[0]?.email], fetchInviteLink)

  // ── Derived links ─────────────────────────────────────────────────────────

  const oneUrl = 'https://one.wepublish.cloud'

  function buildJiraUrl() {
    return composeJiraProjectUrl(data.jiraResult?.key)
  }

  function buildSlackUrl() {
    return composeSlackChannelUrl(data.slackResult?.channel?.id)
  }

  function buildSlackChannelName() {
    return data.slackResult?.channel?.name ?? data.slackChannel ?? ''
  }

  function buildEditorUrl() {
    return data.infraMediumName
      ? `https://editor-${data.infraMediumName}.wepublish.cloud`
      : 'https://editor-<medium>.wepublish.cloud'
  }

  // ── Subject + body generation (in the new client user's language) ──────────
  // Copy lives in the i18n catalog (onboarding.steps.email.welcome.*); we
  // render it in `data.language` (chosen in step 1), independent of the admin's
  // active UI locale. Locale catalogs are lazy-loaded, so the target locale is
  // loaded on demand before rendering (see loadAndRegenerate).

  function welcomeT(key: string, named?: Record<string, unknown>): string {
    return $i18n.t(`onboarding.steps.email.welcome.${key}`, named ?? {}, {
      locale: data.language
    })
  }

  function welcomeSubject(): string {
    return $i18n.t(
      'onboarding.steps.email.welcome.subject',
      {},
      { locale: data.language }
    )
  }

  function generateBody(): string {
    return buildWelcomeEmailBody(welcomeT, {
      firstName: data.users[0]?.firstName ?? '',
      oneUrl,
      activationUrl: inviteAcceptUrl.value || null,
      loginUrl: `${oneUrl}/auth/login`,
      jiraUrl: buildJiraUrl(),
      slackUrl: buildSlackUrl(),
      slackChannelName: buildSlackChannelName() || null,
      editorUrl: buildEditorUrl()
    })
  }

  // Editable body/subject. `lastGenerated`/`lastSubject` track the latest
  // auto-generated text so we only overwrite when the admin hasn't edited it —
  // e.g. when the language changes or a late-arriving Slack channel id lands.
  let lastGenerated = generateBody()
  const emailBody = ref(lastGenerated)

  let lastSubject = welcomeSubject()
  if (!data.emailSubject) data.emailSubject = lastSubject

  function applyRegeneration(): void {
    const next = generateBody()
    if (emailBody.value === lastGenerated) {
      emailBody.value = next
    }
    lastGenerated = next

    const nextSubject = welcomeSubject()
    if (!data.emailSubject || data.emailSubject === lastSubject) {
      data.emailSubject = nextSubject
    }
    lastSubject = nextSubject
  }

  // Locale catalogs load per-locale on demand; make sure the chosen language is
  // present before rendering so a non-active locale isn't silently rendered in
  // the fallback language.
  async function loadAndRegenerate(): Promise<void> {
    await $i18n.loadLocaleMessages(data.language)
    applyRegeneration()
  }

  watch(
    [
      () => data.language,
      () => data.slackResult?.channel?.id,
      () => data.slackResult?.channel?.name,
      () => data.slackChannel,
      () => data.jiraResult?.key,
      () => data.infraMediumName,
      () => data.users[0]?.firstName,
      () => inviteAcceptUrl.value
    ],
    loadAndRegenerate
  )

  function regenerate() {
    const next = generateBody()
    lastGenerated = next
    emailBody.value = next
    data.emailSubject = welcomeSubject()
    lastSubject = data.emailSubject
    toast.add({ color: 'success', title: 'Text neu generiert' })
  }

  // ── Copy helpers ──────────────────────────────────────────────────────────

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.add({ color: 'success', title: `${label} kopiert` })
    } catch {
      toast.add({
        color: 'error',
        title: 'Kopieren fehlgeschlagen',
        description: 'Bitte manuell markieren und kopieren.'
      })
    }
  }
</script>

<template>
  <div class="grid grid-cols-12 gap-4">
    <div class="col-span-12">
      <UAlert color="info" variant="soft" icon="lucide:info">
        <template #description>
          Diese Willkommens-E-Mail enthält bereits den Aktivierungslink, mit dem
          der Benutzer sein Passwort setzt. Aus den vorherigen Schritten
          vorformuliert — bei Bedarf anpassen, dann kopieren und aus deinem
          Mail-Client versenden. Sie wird in der im ersten Schritt gewählten
          Sprache des Hauptbenutzers erstellt.
        </template>
      </UAlert>
    </div>

    <UFormField label="Empfänger" name="emailTo" class="col-span-6">
      <UInput
        v-model="data.emailTo"
        :placeholder="data.users[0]?.email || 'max@muster-ag.ch'"
        type="email"
        class="w-full"
      >
        <template #trailing>
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="lucide:copy"
            :disabled="!data.emailTo"
            @click="copy(data.emailTo, 'Empfänger')"
          />
        </template>
      </UInput>
    </UFormField>

    <UFormField label="Betreff" name="emailSubject" class="col-span-6">
      <UInput v-model="data.emailSubject" class="w-full">
        <template #trailing>
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="lucide:copy"
            :disabled="!data.emailSubject"
            @click="copy(data.emailSubject, 'Betreff')"
          />
        </template>
      </UInput>
    </UFormField>

    <UFormField label="E-Mail-Text" name="emailBody" class="col-span-12">
      <template #hint>
        <div class="flex items-center gap-2">
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="lucide:refresh-cw"
            @click="regenerate"
          >
            Neu generieren
          </UButton>
          <UButton
            size="xs"
            icon="lucide:copy"
            @click="copy(emailBody, 'E-Mail-Text')"
          >
            Text kopieren
          </UButton>
        </div>
      </template>
      <UTextarea
        v-model="emailBody"
        :rows="24"
        class="w-full"
        :ui="{ base: 'font-mono text-sm' }"
      />
    </UFormField>

    <div class="col-span-12">
      <UAlert color="warning" variant="soft" icon="lucide:construction">
        <template #description>
          Diese E-Mail wird nicht automatisch versendet. Text kopieren und aus
          deinem Mail-Client an
          <span class="font-mono">{{ data.emailTo || '(Empfänger)' }}</span>
          senden — der Aktivierungslink ist bereits enthalten.
        </template>
      </UAlert>
    </div>
  </div>
</template>
