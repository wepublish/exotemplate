<script lang="ts" setup>
  import type { Client } from '~~/types/DirectusTypes'

  const route = useRoute()
  const router = useRouter()
  const userStore = useUserStore()
  const onboardingProgress = useOnboardingProgress()

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
      router.replace(`/onboarding/${newClient.id}`)
    }
  }

  function handleClientUpdated(updated: Client) {
    client.value = updated
  }

  async function handleCompleted() {
    await router.push('/onboarding')
  }
</script>

<template>
  <!-- Access denied for non-admins -->
  <div v-if="!userStore.amIAdministrator()" class="flex justify-center pt-16">
    <UPageCard class="max-w-md w-full">
      <template #header>
        <div class="flex items-center gap-3">
          <UIcon
            name="material-symbols:lock-rounded"
            class="text-3xl text-error"
          />
          <div>
            <p class="font-bold text-lg">Kein Zugriff</p>
            <p class="text-sm text-muted">Unzureichende Berechtigungen</p>
          </div>
        </div>
      </template>
      <UAlert
        color="error"
        variant="soft"
        icon="material-symbols:no-accounts-rounded"
      >
        <template #title>Nur für Administratoren</template>
        <template #description>
          Diese Seite ist ausschliesslich für Administratoren zugänglich.
        </template>
      </UAlert>
    </UPageCard>
  </div>

  <div v-else-if="notFound" class="flex justify-center pt-16">
    <UPageCard class="max-w-md w-full">
      <template #header>
        <div class="flex items-center gap-3">
          <UIcon
            name="material-symbols:search-off-rounded"
            class="text-3xl text-warning"
          />
          <div>
            <p class="font-bold text-lg">Client nicht gefunden</p>
            <p class="text-sm text-muted">
              Der angefragte Client existiert nicht (mehr).
            </p>
          </div>
        </div>
      </template>
      <UButton
        to="/onboarding"
        icon="material-symbols:arrow-back-ios-rounded"
        variant="outline"
      >
        Zurück zur Übersicht
      </UButton>
    </UPageCard>
  </div>

  <div v-else>
    <div class="flex items-center gap-3 mb-4">
      <UButton
        to="/onboarding"
        icon="material-symbols:arrow-back-ios-rounded"
        variant="ghost"
        color="neutral"
        size="sm"
      >
        Zurück zur Übersicht
      </UButton>
      <UBadge
        v-if="client"
        color="info"
        variant="soft"
        icon="material-symbols:history-rounded"
      >
        {{ client.name }}
      </UBadge>
      <UBadge
        v-else
        color="success"
        variant="soft"
        icon="material-symbols:add-circle-rounded"
      >
        Neues Onboarding
      </UBadge>
    </div>

    <div v-if="loading" class="flex justify-center py-12">
      <UIcon
        name="material-symbols:sync-rounded"
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
