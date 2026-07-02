<script lang="ts" setup>
  import {
    ONBOARDING_DATA_KEY,
    ADVANCE_STEP_KEY
  } from '~~/types/OnboardingTypes'

  const data = inject(ONBOARDING_DATA_KEY)!
  const advanceStep = inject(ADVANCE_STEP_KEY)!
  const directusStore = useDirectus()
  const toast = useToast()
  const { t } = useI18n()

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
        title: t('onboarding.steps.clockodo.syncedToast')
      })
      await advanceStep()
    } catch (e: any) {
      const msg =
        e?.response?.data?.errors?.[0]?.message ??
        e?.message ??
        t('common.unexpectedError')
      executionError.value = msg
      toast.add({
        color: 'error',
        title: t('onboarding.steps.clockodo.errorTitle'),
        description: msg
      })
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
      toast.add({
        color: 'success',
        title: t('onboarding.steps.clockodo.savedToast')
      })
    } catch (e: any) {
      toast.add({
        color: 'error',
        title: t('onboarding.steps.clockodo.saveErrorTitle'),
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
    <UAlert color="success" variant="soft" icon="lucide:circle-check">
      <template #title>{{
        t('onboarding.steps.clockodo.completedTitle')
      }}</template>
      <template #description>
        {{ t('onboarding.steps.clockodo.completedDescription') }}
        <span class="font-mono font-bold">{{ data.clockodoId }}</span>
        {{ t('onboarding.steps.clockodo.savedOnClient') }}
      </template>
    </UAlert>

    <a
      :href="composeClockodoCustomerUrl(data.clockodoId)"
      target="_blank"
      rel="noopener"
      class="inline-flex items-center gap-2 text-sm text-primary hover:underline"
    >
      <UIcon name="lucide:refresh-cw" class="text-base" />
      {{ t('onboarding.steps.clockodo.openCustomer') }}
      <UIcon name="lucide:external-link" class="text-sm" />
    </a>
  </div>

  <!-- Form -->
  <div v-else class="grid grid-cols-12 gap-4">
    <div class="col-span-12">
      <UAlert color="info" variant="soft" icon="lucide:info">
        <template #description>
          {{ t('onboarding.steps.clockodo.intro') }}
        </template>
      </UAlert>
    </div>

    <!-- Prerequisite: Bexio contact must exist -->
    <div v-if="!hasBexioContact" class="col-span-12">
      <UAlert color="warning" variant="soft" icon="lucide:triangle-alert">
        <template #description>
          {{ t('onboarding.steps.clockodo.bexioRequired') }}
        </template>
      </UAlert>
    </div>

    <UFormField
      :label="t('onboarding.steps.clockodo.bexioContactId')"
      name="bexioRef"
      :hint="t('onboarding.steps.clockodo.bexioContactIdHint')"
      class="col-span-6"
    >
      <UInput
        :model-value="data.bexioContactId?.toString() ?? ''"
        :placeholder="t('onboarding.steps.clockodo.bexioContactIdPlaceholder')"
        class="w-full font-mono"
        readonly
      />
    </UFormField>

    <UFormField
      :label="t('onboarding.steps.clockodo.clientName')"
      name="clientNameRef"
      :hint="t('onboarding.steps.clockodo.clientNameHint')"
      class="col-span-6"
    >
      <UInput :model-value="data.clientName" class="w-full" readonly />
    </UFormField>

    <!-- Error -->
    <div v-if="executionError" class="col-span-12">
      <UAlert color="error" variant="soft" icon="lucide:circle-alert">
        <template #title>{{
          t('onboarding.steps.clockodo.errorTitle')
        }}</template>
        <template #description>{{ executionError }}</template>
      </UAlert>
    </div>

    <!-- Primary action: auto-sync -->
    <div class="col-span-12 flex justify-end pt-2">
      <UButton
        icon="lucide:refresh-cw"
        :loading="loading"
        :disabled="!hasBexioContact || !data.clientId"
        @click="syncAndLink"
      >
        {{ t('onboarding.steps.clockodo.syncAndLink') }}
      </UButton>
    </div>

    <!-- Manual fallback -->
    <div class="col-span-12">
      <UDivider :label="t('onboarding.steps.clockodo.orManual')" />
    </div>

    <UFormField
      :label="t('onboarding.steps.clockodo.clockodoId')"
      name="clockodoId"
      :hint="t('onboarding.steps.clockodo.clockodoIdHint')"
      class="col-span-6"
    >
      <UInput
        v-model="data.clockodoId"
        :placeholder="t('onboarding.steps.clockodo.clockodoIdPlaceholder')"
        class="w-full font-mono"
      />
    </UFormField>

    <div class="col-span-6 flex items-end pb-0.5">
      <UButton
        :loading="loading"
        :disabled="!data.clientId || !data.clockodoId"
        icon="lucide:save"
        variant="outline"
        @click="saveManualId"
      >
        {{ t('onboarding.steps.clockodo.saveManual') }}
      </UButton>
    </div>
  </div>
</template>
