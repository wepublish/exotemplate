<script lang="ts" setup>
  import { createItem, updateUser } from '@directus/sdk'
  import type { AppLocale } from '~~/types/DirectusTypes'
  import {
    ONBOARDING_DATA_KEY,
    ADVANCE_STEP_KEY
  } from '~~/types/OnboardingTypes'

  const data = inject(ONBOARDING_DATA_KEY)!
  const advanceStep = inject(ADVANCE_STEP_KEY)!
  const directusStore = useDirectus()
  const { invite } = useTeam()
  const toast = useToast()

  const loading = ref(false)
  const completed = ref(data.clientId !== null)
  const executionError = ref<string | null>(null)

  // Native language names — shown the same in every UI language. Drives the
  // new client's `Clients.language` and the primary user's `directus_users.language`.
  const LANGUAGE_OPTIONS: { value: AppLocale; label: string }[] = [
    { value: 'de', label: 'Deutsch' },
    { value: 'fr', label: 'Français' },
    { value: 'en', label: 'English' }
  ]

  // Onboarding provisions a single primary user for the new client; the client
  // invites further teammates themselves later via the "Team" page.
  const user = computed(() => data.users[0]!)

  async function execute() {
    if (!data.clientName.trim()) {
      executionError.value = 'Bitte einen Client-Namen eingeben.'
      return
    }
    if (!user.value.email.trim()) {
      executionError.value =
        'Bitte eine E-Mail-Adresse für den Hauptbenutzer eingeben.'
      return
    }

    loading.value = true
    executionError.value = null

    try {
      // 1. Create the Directus client
      const createdClient = await directusStore.directus.request(
        createItem('Clients', {
          name: data.clientName.trim(),
          status: 'published',
          language: data.language
        })
      )
      data.clientId = createdClient.id as string

      // 2. Create the primary user (status 'invited', Client role) and link it
      //    to the client via the /team endpoint. sendInvite:false → no mail is
      //    sent here; the activation link is embedded in the final "E-Mail"
      //    step. If the email already exists, access is granted to that account.
      const res = await invite({
        email: user.value.email.trim(),
        firstName: user.value.firstName || undefined,
        lastName: user.value.lastName || undefined,
        clientIds: [data.clientId],
        sendInvite: false
      })
      user.value.directusUserId = res.userId

      // Set the primary user's preferred language — but not when access was
      // merely granted to a pre-existing account (don't override their choice).
      if (res.status !== 'grant') {
        await directusStore.directus.request(
          updateUser(res.userId, { language: data.language })
        )
      }

      completed.value = true
      toast.add({
        color: 'success',
        title: 'Client und Hauptbenutzer erfolgreich angelegt!'
      })
      await advanceStep()
    } catch (e: any) {
      const msg =
        e?.response?.data?.errors?.[0]?.message ??
        e?.errors?.[0]?.message ??
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
  <!-- Already completed -->
  <div v-if="completed" class="flex flex-col gap-4">
    <UAlert color="success" variant="soft" icon="lucide:circle-check">
      <template #title>Client erfolgreich angelegt</template>
      <template #description>
        Directus Client-ID:
        <span class="font-mono font-bold">{{ data.clientId }}</span>
      </template>
    </UAlert>

    <UAlert color="info" variant="soft" icon="lucide:mail">
      <template #description>
        Der Hauptbenutzer wurde ohne Passwort angelegt. Der Aktivierungslink zum
        Setzen des Passworts wird im letzten Schritt („E-Mail“) in die
        Willkommens-E-Mail eingefügt.
      </template>
    </UAlert>

    <div
      v-if="user.directusUserId"
      class="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 flex items-center justify-between"
    >
      <div class="flex items-center gap-2">
        <UIcon name="lucide:user" class="text-success" />
        <span class="font-medium"
          >{{ user.firstName }} {{ user.lastName }}</span
        >
        <span class="text-muted text-sm">{{ user.email }}</span>
      </div>
      <UBadge variant="soft" color="success" size="sm">
        {{ user.directusUserId }}
      </UBadge>
    </div>
  </div>

  <!-- Form -->
  <div v-else class="grid grid-cols-12 gap-4">
    <div class="col-span-12">
      <UAlert color="info" variant="soft" icon="lucide:info">
        <template #description>
          Lege den Mandanten und einen Hauptbenutzer an. Das Konto erhält die
          Rolle „Client“ und wird per Einladung aktiviert — der Benutzer setzt
          sein Passwort selbst. Weitere Teammitglieder kann der Kunde später
          selbst im Bereich „Team“ einladen.
        </template>
      </UAlert>
    </div>

    <!-- Client name -->
    <UFormField
      label="Client-Name"
      name="clientName"
      required
      class="col-span-12"
    >
      <UInput
        v-model="data.clientName"
        placeholder="z.B. Muster AG"
        class="w-full"
      />
    </UFormField>

    <!-- Language: applies to the client + primary user + welcome email -->
    <UFormField
      label="Sprache"
      name="language"
      description="Gilt für den Kunden und den Hauptbenutzer — Oberfläche und kundenseitige Slack-Meldungen. Auch die Willkommens-E-Mail im letzten Schritt wird in dieser Sprache erstellt."
      class="col-span-12"
    >
      <USelectMenu
        v-model="data.language"
        :items="LANGUAGE_OPTIONS"
        value-key="value"
        label-key="label"
        class="w-full md:w-60"
      />
    </UFormField>

    <!-- Primary user -->
    <div
      class="col-span-12 p-4 rounded-lg border border-neutral-200 dark:border-neutral-700"
    >
      <p class="text-sm font-semibold mb-3">Hauptbenutzer</p>
      <div class="grid grid-cols-12 gap-3">
        <UFormField label="Vorname" class="col-span-6">
          <UInput v-model="user.firstName" placeholder="Max" class="w-full" />
        </UFormField>
        <UFormField label="Nachname" class="col-span-6">
          <UInput
            v-model="user.lastName"
            placeholder="Mustermann"
            class="w-full"
          />
        </UFormField>
        <UFormField label="E-Mail" required class="col-span-12">
          <UInput
            v-model="user.email"
            placeholder="max@muster-ag.ch"
            type="email"
            class="w-full"
          />
        </UFormField>
      </div>
    </div>

    <!-- Error -->
    <div v-if="executionError" class="col-span-12">
      <UAlert color="error" variant="soft" icon="lucide:circle-alert">
        <template #title>Fehler beim Anlegen</template>
        <template #description>{{ executionError }}</template>
      </UAlert>
    </div>

    <!-- Execute -->
    <div class="col-span-12 flex justify-end pt-2">
      <UButton icon="lucide:circle-play" :loading="loading" @click="execute">
        In Directus anlegen
      </UButton>
    </div>
  </div>
</template>
