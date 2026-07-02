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
      executionError.value = t('onboarding.steps.bexio.allFieldsRequired')
      return
    }

    if (!data.clientId) {
      executionError.value = t('onboarding.steps.bexio.directusFirst')
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
        title: t('onboarding.steps.bexio.successToast')
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
        title: t('onboarding.steps.bexio.errorTitle'),
        description: msg
      })
    } finally {
      loading.value = false
    }
  }
</script>

<template>
  <!-- Already completed -->
  <div v-if="completed && data.bexioContactId" class="flex flex-col gap-4">
    <UAlert color="success" variant="soft" icon="lucide:circle-check">
      <template #title>{{
        t('onboarding.steps.bexio.completedTitle')
      }}</template>
      <template #description>
        {{ t('onboarding.steps.bexio.completedDescription') }}
        <span class="font-mono font-bold">{{ data.bexioContactId }}</span>
        {{ t('onboarding.steps.bexio.savedOnClient') }}
      </template>
    </UAlert>

    <div class="grid grid-cols-12 gap-3">
      <div
        class="col-span-6 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
        <p class="text-xs text-muted">
          {{ t('onboarding.steps.bexio.company') }}
        </p>
        <p class="font-medium">{{ data.bexioCompany }}</p>
      </div>
      <div
        class="col-span-6 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
        <p class="text-xs text-muted">
          {{ t('onboarding.steps.bexio.email') }}
        </p>
        <p class="font-medium">{{ data.bexioEmail }}</p>
      </div>
      <div
        class="col-span-8 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
        <p class="text-xs text-muted">
          {{ t('onboarding.steps.bexio.fieldStreet') }}
        </p>
        <p class="font-medium">
          {{ data.bexioStreet }} {{ data.bexioStreetNumber }}
        </p>
      </div>
      <div
        class="col-span-4 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700"
      >
        <p class="text-xs text-muted">
          {{ t('onboarding.steps.bexio.fieldZipCity') }}
        </p>
        <p class="font-medium">{{ data.bexioZip }} {{ data.bexioCity }}</p>
      </div>
    </div>

    <a
      :href="composeBexioContactUrl(data.bexioContactId)"
      target="_blank"
      rel="noopener"
      class="inline-flex items-center gap-2 text-sm text-primary hover:underline"
    >
      <UIcon name="lucide:briefcase" class="text-base" />
      {{ t('onboarding.steps.bexio.openContact') }}
      <UIcon name="lucide:external-link" class="text-sm" />
    </a>
  </div>

  <!-- Form -->
  <div v-else class="grid grid-cols-12 gap-4">
    <div class="col-span-12">
      <UAlert color="info" variant="soft" icon="lucide:info">
        <template #description>
          {{ t('onboarding.steps.bexio.intro') }}
        </template>
      </UAlert>
    </div>

    <div v-if="!data.clientId" class="col-span-12">
      <UAlert color="warning" variant="soft" icon="lucide:triangle-alert">
        <template #description>
          {{ t('onboarding.steps.bexio.directusRequired') }}
        </template>
      </UAlert>
    </div>

    <UFormField
      :label="t('onboarding.steps.bexio.company')"
      name="bexioCompany"
      required
      class="col-span-12"
    >
      <UInput
        v-model="data.bexioCompany"
        :placeholder="t('onboarding.steps.bexio.companyPlaceholder')"
        class="w-full"
      />
    </UFormField>

    <UFormField
      :label="t('onboarding.steps.bexio.email')"
      name="bexioEmail"
      required
      class="col-span-12"
      :hint="t('onboarding.steps.bexio.emailHint')"
    >
      <UInput
        v-model="data.bexioEmail"
        type="email"
        :placeholder="t('onboarding.steps.bexio.emailPlaceholder')"
        class="w-full"
      />
    </UFormField>

    <UFormField
      :label="t('onboarding.steps.bexio.street')"
      name="bexioStreet"
      required
      class="col-span-8"
    >
      <UInput
        v-model="data.bexioStreet"
        :placeholder="t('onboarding.steps.bexio.streetPlaceholder')"
        class="w-full"
      />
    </UFormField>

    <UFormField
      :label="t('onboarding.steps.bexio.streetNumber')"
      name="bexioStreetNumber"
      required
      class="col-span-4"
    >
      <UInput v-model="data.bexioStreetNumber" placeholder="1" class="w-full" />
    </UFormField>

    <UFormField
      :label="t('onboarding.steps.bexio.zip')"
      name="bexioZip"
      required
      class="col-span-4"
    >
      <UInput v-model="data.bexioZip" placeholder="8000" class="w-full" />
    </UFormField>

    <UFormField
      :label="t('onboarding.steps.bexio.city')"
      name="bexioCity"
      required
      class="col-span-8"
    >
      <UInput
        v-model="data.bexioCity"
        :placeholder="t('onboarding.steps.bexio.cityPlaceholder')"
        class="w-full"
      />
    </UFormField>

    <!-- Error -->
    <div v-if="executionError" class="col-span-12">
      <UAlert color="error" variant="soft" icon="lucide:circle-alert">
        <template #title>{{ t('onboarding.steps.bexio.errorTitle') }}</template>
        <template #description>{{ executionError }}</template>
      </UAlert>
    </div>

    <!-- Execute -->
    <div class="col-span-12 flex justify-end pt-2">
      <UButton
        icon="lucide:briefcase"
        :loading="loading"
        :disabled="!data.clientId"
        @click="execute"
      >
        {{ t('onboarding.steps.bexio.execute') }}
      </UButton>
    </div>
  </div>
</template>
