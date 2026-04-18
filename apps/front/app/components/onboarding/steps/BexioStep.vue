<script lang="ts" setup>
  import {
    ONBOARDING_DATA_KEY,
    ADVANCE_STEP_KEY
  } from '~~/types/OnboardingTypes'

  const data = inject(ONBOARDING_DATA_KEY)!
  const advanceStep = inject(ADVANCE_STEP_KEY)!
  const directusStore = useDirectus()
  const toast = useToast()

  // Pre-fill company name from step 1
  watch(
    () => data.clientName,
    (name) => {
      if (name && !data.bexioCompany) data.bexioCompany = name
    },
    { immediate: true }
  )

  // Pre-fill email from the first user added in step 1
  watch(
    () => data.users[0]?.email,
    (email) => {
      if (email && !data.bexioEmail) data.bexioEmail = email
    },
    { immediate: true }
  )

  const loading = ref(false)
  const completed = ref(data.bexioContactId !== null)
  const executionError = ref<string | null>(null)

  async function execute() {
    if (
      !data.bexioCompany.trim() ||
      !data.bexioEmail.trim() ||
      !data.bexioStreet.trim() ||
      !data.bexioStreetNumber.trim() ||
      !data.bexioZip.trim() ||
      !data.bexioCity.trim()
    ) {
      executionError.value =
        'Alle Felder (Firmenname, E-Mail, Strasse, Nr., PLZ, Ort) sind erforderlich.'
      return
    }

    if (!data.clientId) {
      executionError.value =
        'Schritt 1 (Directus) muss zuerst abgeschlossen werden.'
      return
    }

    loading.value = true
    executionError.value = null

    try {
      const result = await directusStore.postCustomEndpoint(
        'client-onboarding/create-bexio-contact',
        {
          clientId: data.clientId,
          companyName: data.bexioCompany.trim(),
          email: data.bexioEmail.trim(),
          street: data.bexioStreet.trim(),
          streetNumber: data.bexioStreetNumber.trim(),
          zip: data.bexioZip.trim(),
          city: data.bexioCity.trim()
        }
      )

      data.bexioContactId = result.data.bexioContactId

      completed.value = true
      toast.add({
        color: 'success',
        title: 'Bexio-Kontakt erfolgreich erstellt!'
      })
      await advanceStep()
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
  <!-- Already completed -->
  <div v-if="completed && data.bexioContactId" class="flex flex-col gap-4">
    <UAlert
      color="success"
      variant="soft"
      icon="material-symbols:check-circle-rounded"
    >
      <template #title>Bexio-Kontakt erfolgreich erstellt</template>
      <template #description>
        Kontakt-ID:
        <span class="font-mono font-bold">{{ data.bexioContactId }}</span>
        — wurde auf dem Client-Eintrag gespeichert.
      </template>
    </UAlert>

    <div class="grid grid-cols-12 gap-3">
      <div
        class="col-span-6 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
        <p class="text-xs text-muted">Firmenname</p>
        <p class="font-medium">{{ data.bexioCompany }}</p>
      </div>
      <div
        class="col-span-6 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
        <p class="text-xs text-muted">E-Mail</p>
        <p class="font-medium">{{ data.bexioEmail }}</p>
      </div>
      <div
        class="col-span-8 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
        <p class="text-xs text-muted">Strasse</p>
        <p class="font-medium">
          {{ data.bexioStreet }} {{ data.bexioStreetNumber }}
        </p>
      </div>
      <div
        class="col-span-4 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
        <p class="text-xs text-muted">PLZ / Ort</p>
        <p class="font-medium">{{ data.bexioZip }} {{ data.bexioCity }}</p>
      </div>
    </div>

    <a
      :href="composeBexioContactUrl(data.bexioContactId)"
      target="_blank"
      rel="noopener"
      class="inline-flex items-center gap-2 text-sm text-primary hover:underline"
    >
      <UIcon
        name="material-symbols:business-center-rounded"
        class="text-base"
      />
      Kontakt in Bexio öffnen
      <UIcon name="material-symbols:open-in-new-rounded" class="text-sm" />
    </a>
  </div>

  <!-- Form -->
  <div v-else class="grid grid-cols-12 gap-4">
    <div class="col-span-12">
      <UAlert color="info" variant="soft" icon="material-symbols:info-rounded">
        <template #description>
          Den neuen Client in Bexio als Firmenkontakt erfassen. Die
          Bexio-Kontakt-ID wird automatisch auf dem Client-Eintrag gespeichert
          und für die spätere Rechnungsstellung benötigt.
        </template>
      </UAlert>
    </div>

    <div v-if="!data.clientId" class="col-span-12">
      <UAlert
        color="warning"
        variant="soft"
        icon="material-symbols:warning-rounded"
      >
        <template #description>
          Schritt 1 (Directus) muss zuerst abgeschlossen werden, damit der
          Client-Eintrag nach der Erstellung aktualisiert werden kann.
        </template>
      </UAlert>
    </div>

    <UFormField
      label="Firmenname"
      name="bexioCompany"
      required
      class="col-span-12"
    >
      <UInput
        v-model="data.bexioCompany"
        placeholder="Muster AG"
        class="w-full"
      />
    </UFormField>

    <UFormField
      label="E-Mail"
      name="bexioEmail"
      required
      class="col-span-12"
      hint="Wird als primäre E-Mail-Adresse des Kontakts hinterlegt"
    >
      <UInput
        v-model="data.bexioEmail"
        type="email"
        placeholder="info@muster.ch"
        class="w-full"
      />
    </UFormField>

    <UFormField label="Strasse" name="bexioStreet" required class="col-span-8">
      <UInput
        v-model="data.bexioStreet"
        placeholder="Musterstrasse"
        class="w-full"
      />
    </UFormField>

    <UFormField
      label="Nr."
      name="bexioStreetNumber"
      required
      class="col-span-4"
    >
      <UInput v-model="data.bexioStreetNumber" placeholder="1" class="w-full" />
    </UFormField>

    <UFormField label="PLZ" name="bexioZip" required class="col-span-4">
      <UInput v-model="data.bexioZip" placeholder="8000" class="w-full" />
    </UFormField>

    <UFormField label="Ort" name="bexioCity" required class="col-span-8">
      <UInput v-model="data.bexioCity" placeholder="Zürich" class="w-full" />
    </UFormField>

    <!-- Error -->
    <div v-if="executionError" class="col-span-12">
      <UAlert
        color="error"
        variant="soft"
        icon="material-symbols:error-rounded"
      >
        <template #title>Fehler beim Erstellen</template>
        <template #description>{{ executionError }}</template>
      </UAlert>
    </div>

    <!-- Execute -->
    <div class="col-span-12 flex justify-end pt-2">
      <UButton
        icon="material-symbols:business-center-rounded"
        :loading="loading"
        :disabled="!data.clientId"
        @click="execute"
      >
        Bexio-Kontakt erstellen
      </UButton>
    </div>
  </div>
</template>
