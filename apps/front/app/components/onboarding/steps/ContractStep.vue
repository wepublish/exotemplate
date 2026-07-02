<script lang="ts" setup>
  import {
    ONBOARDING_DATA_KEY,
    ADVANCE_STEP_KEY
  } from '~~/types/OnboardingTypes'

  const data = inject(ONBOARDING_DATA_KEY)!
  const advanceStep = inject(ADVANCE_STEP_KEY)!
  const { uploadContract } = useContracts()
  const toast = useToast()
  const { t } = useI18n()

  const file = ref<File | null>(null)
  const signed = ref(false)
  const uploading = ref(false)
  const executionError = ref<string | null>(null)

  const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

  function onFileChange(event: Event) {
    const picked = (event.target as HTMLInputElement).files?.[0] ?? null
    if (picked && picked.type && picked.type !== 'application/pdf') {
      executionError.value = t('onboarding.steps.contract.mustBePdf')
      file.value = null
      return
    }
    if (picked && picked.size > MAX_FILE_BYTES) {
      executionError.value = t('onboarding.steps.contract.fileTooLarge')
      file.value = null
      return
    }
    executionError.value = null
    file.value = picked
  }

  async function upload() {
    if (!data.clientId) {
      executionError.value = t('onboarding.steps.contract.directusRequired')
      return
    }
    if (!file.value) {
      executionError.value = t('onboarding.steps.contract.fileRequired')
      return
    }
    uploading.value = true
    executionError.value = null
    try {
      await uploadContract(data.clientId, file.value, { signed: signed.value })
      data.contractCreated = true
      toast.add({
        color: 'success',
        title: t('onboarding.steps.contract.successToast')
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
        title: t('onboarding.steps.contract.errorTitle'),
        description: msg
      })
    } finally {
      uploading.value = false
    }
  }
</script>

<template>
  <!-- Already uploaded -->
  <div v-if="data.contractCreated" class="flex flex-col gap-4">
    <UAlert color="success" variant="soft" icon="lucide:circle-check">
      <template #title>{{
        t('onboarding.steps.contract.completedTitle')
      }}</template>
      <template #description>
        {{ t('onboarding.steps.contract.completedDescription') }}
      </template>
    </UAlert>
  </div>

  <!-- Upload form -->
  <div v-else class="grid grid-cols-12 gap-4">
    <div class="col-span-12">
      <UAlert color="info" variant="soft" icon="lucide:info">
        <template #description>
          {{ t('onboarding.steps.contract.intro') }}
        </template>
      </UAlert>
    </div>

    <div v-if="!data.clientId" class="col-span-12">
      <UAlert color="warning" variant="soft" icon="lucide:triangle-alert">
        <template #description>
          {{ t('onboarding.steps.contract.directusRequired') }}
        </template>
      </UAlert>
    </div>

    <UFormField
      :label="t('onboarding.steps.contract.fileLabel')"
      name="contractFile"
      required
      class="col-span-12"
      :hint="t('onboarding.steps.contract.fileHint')"
    >
      <input
        type="file"
        accept="application/pdf"
        class="block w-full text-sm text-muted file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-white file:cursor-pointer hover:file:bg-primary/90"
        @change="onFileChange"
      />
    </UFormField>

    <div class="col-span-12">
      <UCheckbox
        v-model="signed"
        :label="t('onboarding.steps.contract.signedLabel')"
      />
    </div>

    <!-- Error -->
    <div v-if="executionError" class="col-span-12">
      <UAlert color="error" variant="soft" icon="lucide:circle-alert">
        <template #title>{{
          t('onboarding.steps.contract.errorTitle')
        }}</template>
        <template #description>{{ executionError }}</template>
      </UAlert>
    </div>

    <div class="col-span-12 flex justify-end pt-2">
      <UButton
        icon="lucide:upload"
        :loading="uploading"
        :disabled="!data.clientId || !file"
        @click="upload"
      >
        {{ t('onboarding.steps.contract.upload') }}
      </UButton>
    </div>
  </div>
</template>
