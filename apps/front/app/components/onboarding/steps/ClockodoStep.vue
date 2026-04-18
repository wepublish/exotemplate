<script lang="ts" setup>
  import {
    ONBOARDING_DATA_KEY,
    ADVANCE_STEP_KEY
  } from '~~/types/OnboardingTypes'

  const data = inject(ONBOARDING_DATA_KEY)!
  const advanceStep = inject(ADVANCE_STEP_KEY)!
  const directusStore = useDirectus()
  const toast = useToast()

  const loading = ref(false)
  const executionError = ref<string | null>(null)
  const completed = ref(data.clockodoId !== null)

  const hasBexioContact = computed(() => data.bexioContactId !== null)

  async function syncAndLink() {
    if (!data.clientId || !data.clientName) return

    loading.value = true
    executionError.value = null

    try {
      const result = await directusStore.postCustomEndpoint(
        'client-onboarding/sync-clockodo',
        {
          clientId: data.clientId,
          clientName: data.clientName
        }
      )

      data.clockodoId = result.data.clockodoCustomerId
      completed.value = true
      toast.add({
        color: 'success',
        title: 'Clockodo-Kunde gefunden und verknüpft!'
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

  async function saveManualId() {
    if (!data.clientId || !data.clockodoId) return
    loading.value = true
    try {
      await advanceStep({ clockodo_customer_id: data.clockodoId })
      completed.value = true
      toast.add({ color: 'success', title: 'Clockodo-ID gespeichert.' })
    } catch (e: any) {
      toast.add({
        color: 'error',
        title: 'Fehler beim Speichern',
        description: e?.message
      })
    } finally {
      loading.value = false
    }
  }
</script>

<template>
  <!-- Already completed -->
  <div v-if="completed && data.clockodoId" class="flex flex-col gap-4">
    <UAlert
      color="success"
      variant="soft"
      icon="material-symbols:check-circle-rounded"
    >
      <template #title>Clockodo-Kunde erfolgreich verknüpft</template>
      <template #description>
        Clockodo Kunden-ID:
        <span class="font-mono font-bold">{{ data.clockodoId }}</span>
        — wurde auf dem Client-Eintrag gespeichert.
      </template>
    </UAlert>

    <a
      :href="composeClockodoCustomerUrl(data.clockodoId)"
      target="_blank"
      rel="noopener"
      class="inline-flex items-center gap-2 text-sm text-primary hover:underline"
    >
      <UIcon name="material-symbols:sync-rounded" class="text-base" />
      Kunde in Clockodo öffnen
      <UIcon name="material-symbols:open-in-new-rounded" class="text-sm" />
    </a>
  </div>

  <!-- Form -->
  <div v-else class="grid grid-cols-12 gap-4">
    <div class="col-span-12">
      <UAlert color="info" variant="soft" icon="material-symbols:info-rounded">
        <template #description>
          Den Bexio-Kunden mit Clockodo verknüpfen, damit Stunden korrekt
          erfasst und verrechnet werden können. Die Clockodo Bexio-Integration
          synchronisiert die Bexio-Kontakte automatisch als Clockodo-Kunden.
        </template>
      </UAlert>
    </div>

    <!-- Prerequisite: Bexio contact must exist -->
    <div v-if="!hasBexioContact" class="col-span-12">
      <UAlert
        color="warning"
        variant="soft"
        icon="material-symbols:warning-rounded"
      >
        <template #description>
          Schritt 4 (Bexio) muss zuerst abgeschlossen werden, bevor der
          Clockodo-Abgleich durchgeführt werden kann.
        </template>
      </UAlert>
    </div>

    <UFormField
      label="Bexio Kontakt-ID"
      name="bexioRef"
      hint="Aus Schritt «Bexio-Kunde anlegen»"
      class="col-span-6"
    >
      <UInput
        :model-value="data.bexioContactId?.toString() ?? ''"
        placeholder="Aus Schritt «Bexio»"
        class="w-full font-mono"
        readonly
      />
    </UFormField>

    <UFormField
      label="Client-Name"
      name="clientNameRef"
      hint="Wird zur Suche in Clockodo verwendet"
      class="col-span-6"
    >
      <UInput :model-value="data.clientName" class="w-full" readonly />
    </UFormField>

    <!-- Error -->
    <div v-if="executionError" class="col-span-12">
      <UAlert
        color="error"
        variant="soft"
        icon="material-symbols:error-rounded"
      >
        <template #title>Fehler beim Abgleich</template>
        <template #description>{{ executionError }}</template>
      </UAlert>
    </div>

    <!-- Primary action: auto-sync -->
    <div class="col-span-12 flex justify-end pt-2">
      <UButton
        icon="material-symbols:sync-rounded"
        :loading="loading"
        :disabled="!hasBexioContact || !data.clientId"
        @click="syncAndLink"
      >
        In Clockodo suchen und verknüpfen
      </UButton>
    </div>

    <!-- Manual fallback -->
    <div class="col-span-12">
      <UDivider label="oder manuell eintragen" />
    </div>

    <UFormField
      label="Clockodo Kunden-ID"
      name="clockodoId"
      hint="Falls die automatische Suche fehlschlägt"
      class="col-span-6"
    >
      <UInput
        v-model="data.clockodoId"
        placeholder="z.B. 67890"
        class="w-full font-mono"
      />
    </UFormField>

    <div class="col-span-6 flex items-end pb-0.5">
      <UButton
        :loading="loading"
        :disabled="!data.clientId || !data.clockodoId"
        icon="material-symbols:save-rounded"
        variant="outline"
        @click="saveManualId"
      >
        Manuell speichern
      </UButton>
    </div>
  </div>
</template>
