<script lang="ts" setup>
  import type { Client } from '~~/types/DirectusTypes'

  const route = useRoute()
  const router = useRouter()
  const userStore = useUserStore()
  const onboardingProgress = useOnboardingProgress()
  const { t } = useI18n()
  const link = useClientPeriodLink()

  const rawId = computed(() => String(route.params.clientId ?? ''))
  const isNew = computed(() => rawId.value === 'new')

  const client = ref<Client | null>(null)
  const loading = ref(false)
  const notFound = ref(false)

  async function loadClient() {
    if (isNew.value) {
      client.value = null
      notFound.value = false
      return
    }
    loading.value = true
    notFound.value = false
    try {
      const c = await onboardingProgress.fetchClient(rawId.value)
      if (!c) {
        notFound.value = true
      } else {
        client.value = c
      }
    } finally {
      loading.value = false
    }
  }

  watch(rawId, loadClient, { immediate: true })

  // When the Directus step creates a client, switch URL from /new to the
  // real client id so reload keeps the user on the same onboarding.
  function handleClientCreated(newClient: Client) {
    client.value = newClient
    if (isNew.value) {
      router.replace(link(`/onboarding/${newClient.id}`))
    }
  }

  function handleClientUpdated(updated: Client) {
    client.value = updated
  }

  async function handleCompleted() {
    await router.push(link('/onboarding'))
  }
</script>

<template>
  <!-- Access denied for non-admins -->
  <div v-if="!userStore.amIAdministrator()" class="flex justify-center pt-16">
    <UPageCard class="max-w-md w-full">
      <template #header>
        <div class="flex items-center gap-3">
          <UIcon name="lucide:lock" class="text-3xl text-error" />
          <div>
            <p class="font-bold text-lg">
              {{ t('common.accessDenied.title') }}
            </p>
            <p class="text-sm text-muted">
              {{ t('onboarding.index.accessSubtitle') }}
            </p>
          </div>
        </div>
      </template>
      <UAlert color="error" variant="soft" icon="lucide:user-x">
        <template #title>{{ t('common.accessDenied.title') }}</template>
        <template #description>
          {{ t('common.accessDenied.body') }}
        </template>
      </UAlert>
    </UPageCard>
  </div>

  <div v-else-if="notFound" class="flex justify-center pt-16">
    <UPageCard class="max-w-md w-full">
      <template #header>
        <div class="flex items-center gap-3">
          <UIcon name="lucide:search-x" class="text-3xl text-warning" />
          <div>
            <p class="font-bold text-lg">
              {{ t('onboarding.detail.notFoundTitle') }}
            </p>
            <p class="text-sm text-muted">
              {{ t('onboarding.detail.notFoundDescription') }}
            </p>
          </div>
        </div>
      </template>
      <UButton
        :to="link('/onboarding')"
        icon="lucide:chevron-left"
        variant="outline"
      >
        {{ t('onboarding.detail.backToOverview') }}
      </UButton>
    </UPageCard>
  </div>

  <div v-else>
    <div class="flex items-center gap-3 mb-4">
      <UButton
        :to="link('/onboarding')"
        icon="lucide:chevron-left"
        variant="ghost"
        color="neutral"
        size="sm"
      >
        {{ t('onboarding.detail.backToOverview') }}
      </UButton>
      <UBadge v-if="client" color="info" variant="soft" icon="lucide:history">
        {{ client.name }}
      </UBadge>
      <UBadge v-else color="success" variant="soft" icon="lucide:circle-plus">
        {{ t('onboarding.detail.newOnboarding') }}
      </UBadge>
    </div>

    <div v-if="loading" class="flex justify-center py-12">
      <UIcon
        name="lucide:refresh-cw"
        class="text-3xl text-muted animate-spin"
      />
    </div>

    <OnboardingStepper
      v-else
      :initial-client="client"
      @client-created="handleClientCreated"
      @client-updated="handleClientUpdated"
      @completed="handleCompleted"
    />
  </div>
</template>
