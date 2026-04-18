<script lang="ts" setup>
  import {
    ONBOARDING_DATA_KEY,
    ADVANCE_STEP_KEY
  } from '~~/types/OnboardingTypes'

  const data = inject(ONBOARDING_DATA_KEY)!
  const advanceStep = inject(ADVANCE_STEP_KEY)!
  const directusStore = useDirectus()
  const userStore = useUserStore()
  const toast = useToast()

  const loading = ref(false)
  const completed = ref(data.slackResult !== null)
  const executionError = ref<string | null>(null)

  // ── Channel name ──────────────────────────────────────────────────────────

  // Pre-fill channel name as wep-[client-name] when client name is set
  watch(
    () => data.clientName,
    (name) => {
      if (name && !data.slackChannel) {
        data.slackChannel = `wep-${name
          ?.toLowerCase()
          ?.replace(/[^a-z0-9]/g, '-')
          ?.replace(/-+/g, '-')
          ?.replace(/^-|-$/g, '')}`
      }
    },
    { immediate: true }
  )

  // Enforce Slack channel name rules on every keystroke
  function normalizeChannelName(value: string) {
    data.slackChannel = value
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80)
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  async function execute() {
    if (!userStore.amIAdministrator()) {
      executionError.value =
        'Nur Administratoren können diesen Schritt ausführen.'
      return
    }

    if (!data.slackChannel.trim()) {
      executionError.value = 'Bitte einen Kanalnamen eingeben.'
      return
    }

    loading.value = true
    executionError.value = null

    try {
      const result = await directusStore.postCustomEndpoint(
        'client-onboarding/create-slack-channel',
        {
          channelName: data.slackChannel.trim(),
          description: data.slackDescription.trim()
        }
      )

      data.slackResult = result.data

      completed.value = true
      toast.add({
        color: 'success',
        title: `#${result.data.channel.name} erfolgreich erstellt!`
      })
      await advanceStep({ slack_channel_id: result.data.channel.id })
    } catch (e: any) {
      const msg =
        e?.response?.data?.errors?.[0]?.message ??
        e?.message ??
        'Unbekannter Fehler'
      executionError.value = msg
      toast.add({ color: 'error', title: 'Fehler', description: msg })
    } finally {
      loading.value = false
    }
  }
</script>

<template>
  <!-- ── Completed view ──────────────────────────────────────────────────── -->
  <div v-if="completed && data.slackResult" class="flex flex-col gap-4">
    <UAlert
      color="success"
      variant="soft"
      icon="material-symbols:check-circle-rounded"
    >
      <template #title>Slack-Kanal erfolgreich erstellt</template>
      <template #description>
        <template v-if="data.slackResult.channel.name">
          <span class="font-mono font-bold"
            >#{{ data.slackResult.channel.name }}</span
          >
          —
        </template>
        ID:
        <span class="font-mono">{{ data.slackResult.channel.id }}</span>
      </template>
    </UAlert>

    <a
      :href="composeSlackChannelUrl(data.slackResult.channel.id)"
      target="_blank"
      rel="noopener"
      class="inline-flex items-center gap-2 text-sm text-primary hover:underline"
    >
      <UIcon name="simple-icons:slack" class="text-base" />
      Kanal in Slack öffnen
      <UIcon name="material-symbols:open-in-new-rounded" class="text-sm" />
    </a>
  </div>

  <!-- ── Form ───────────────────────────────────────────────────────────── -->
  <div v-else class="grid grid-cols-12 gap-4">
    <div class="col-span-12">
      <UAlert color="info" variant="soft" icon="material-symbols:info-rounded">
        <template #description>
          Einen dedizierten Slack-Kanal für den Client erstellen.
        </template>
      </UAlert>
    </div>

    <!-- Channel name -->
    <UFormField
      label="Kanalname"
      name="slackChannel"
      required
      class="col-span-6"
      hint="Kleinbuchstaben, Zahlen, Bindestriche — wird automatisch normalisiert"
    >
      <UInput
        :model-value="data.slackChannel"
        placeholder="wep-muster-ag"
        class="w-full font-mono"
        @update:model-value="normalizeChannelName($event as string)"
      />
    </UFormField>

    <!-- Description -->
    <UFormField
      label="Beschreibung (optional)"
      name="slackDescription"
      class="col-span-6 self-end"
    >
      <UInput
        v-model="data.slackDescription"
        placeholder="Client-Kommunikationskanal"
        class="w-full"
      />
    </UFormField>

    <!-- Error -->
    <div v-if="executionError" class="col-span-12">
      <UAlert
        color="error"
        variant="soft"
        icon="material-symbols:error-rounded"
      >
        <template #title>Fehler</template>
        <template #description>{{ executionError }}</template>
      </UAlert>
    </div>

    <!-- Execute -->
    <div class="col-span-12 flex justify-end pt-2">
      <UButton
        icon="simple-icons:slack"
        :loading="loading"
        :disabled="!data.slackChannel.trim()"
        @click="execute"
      >
        Slack-Kanal erstellen
      </UButton>
    </div>
  </div>
</template>
