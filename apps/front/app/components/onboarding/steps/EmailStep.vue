<script lang="ts" setup>
  import { ONBOARDING_DATA_KEY } from '~~/types/OnboardingTypes'

  const data = inject(ONBOARDING_DATA_KEY)!
  const toast = useToast()

  // Pre-fill recipient from step 1 user
  watch(
    () => data.users[0]?.email,
    (email) => {
      if (email && !data.emailTo) data.emailTo = email
    },
    { immediate: true }
  )

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
      ? `https://editor.${data.infraMediumName}.wepublish.cloud`
      : 'https://editor.<medium>.wepublish.cloud'
  }

  function buildFirstName() {
    return data.users[0]?.firstName?.trim() || 'zämme'
  }

  // ── Body generation ───────────────────────────────────────────────────────

  function generateBody(): string {
    const channelName = buildSlackChannelName()
    const slackBlock = channelName
      ? `  ${buildSlackUrl()}\n  Unser gemeinsamer Kanal: #${channelName}`
      : `  ${buildSlackUrl()}`

    return `Hoi ${buildFirstName()}

schön, dass du bei We.Publish an Bord bist! Damit du direkt loslegen kannst, hier die vier Plattformen, mit denen wir zusammenarbeiten – jede mit einem klaren Zweck, damit du immer weisst, wo du was findest:

• ONE – transparente Finanzen
  ${oneUrl}
  Hier siehst du jederzeit, wie viele Stunden wir für dich gearbeitet haben, was auf deinem Guthaben steht und alle Rechnungen. Volle Transparenz über die Kosten.

• Jira – Projektmanagement & Arbeitsfortschritt
  ${buildJiraUrl()}
  Dein Projektboard: Hier verfolgen wir alle Aufgaben, Bugs und Features. Du kannst jederzeit nachschauen, woran wir arbeiten, Tickets kommentieren oder neue Anfragen erfassen.

• Slack – tägliche Kommunikation
${slackBlock}
  Für den kurzen Draht: Fragen, Absprachen und direkter Austausch mit dem Team – schneller und persönlicher als E-Mail.

• Editor – Website & CRM verwalten
  ${buildEditorUrl()}
  Dein Redaktions-Cockpit: Artikel, Seiten und Inhalte deiner Website pflegen sowie Abonnent:innen und CRM verwalten.

Kurz zusammengefasst: ONE für die Finanzen, Jira für die Projektarbeit, Slack für die Kommunikation und der Editor für deine Inhalte. So bleibt alles an seinem Platz.

Die Zugangsdaten solltest du als Einladungen bereits erhalten haben.

In den nächsten Tagen melden wir uns bei dir, um einen Termin für ein persönliches Treffen zu vereinbaren – damit wir uns in Ruhe kennenlernen und gemeinsam die nächsten Schritte besprechen.

Bis bald und liebe Grüsse
Dein We.Publish-Team`
  }

  // Editable body. `lastGenerated` tracks the latest auto-generated text so
  // we can tell whether the user has edited it: if the current body still
  // matches, it's safe to overwrite when upstream data (e.g. a late-arriving
  // Slack channel id) changes. Otherwise we leave the user's edits alone.
  let lastGenerated = generateBody()
  const emailBody = ref(lastGenerated)

  watch(
    [
      () => data.slackResult?.channel?.id,
      () => data.slackResult?.channel?.name,
      () => data.slackChannel,
      () => data.jiraResult?.key,
      () => data.infraMediumName,
      () => data.users[0]?.firstName
    ],
    () => {
      const next = generateBody()
      if (emailBody.value === lastGenerated) {
        emailBody.value = next
      }
      lastGenerated = next
    }
  )

  function regenerate() {
    const next = generateBody()
    lastGenerated = next
    emailBody.value = next
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
      <UAlert color="info" variant="soft" icon="material-symbols:info-rounded">
        <template #description>
          Der Text unten ist aus den vorherigen Schritten vorformuliert. Bei
          Bedarf anpassen, dann kopieren und aus deinem Mail-Client versenden.
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
            icon="material-symbols:content-copy-rounded"
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
            icon="material-symbols:content-copy-rounded"
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
            icon="material-symbols:refresh-rounded"
            @click="regenerate"
          >
            Neu generieren
          </UButton>
          <UButton
            size="xs"
            icon="material-symbols:content-copy-rounded"
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
      <UAlert
        color="warning"
        variant="soft"
        icon="material-symbols:construction-rounded"
      >
        <template #description>
          Der automatische E-Mail-Versand ist nicht implementiert. Text kopieren
          und aus deinem Mail-Client an
          <span class="font-mono">{{ data.emailTo || '(Empfänger)' }}</span>
          senden.
        </template>
      </UAlert>
    </div>
  </div>
</template>
