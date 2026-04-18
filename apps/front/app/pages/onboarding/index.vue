<script lang="ts" setup>
  import type { Client } from '~~/types/DirectusTypes'
  import {
    deriveStepStatuses,
    isOnboardingComplete,
    ONBOARDING_STEP_COUNT
  } from '~/composables/useOnboardingProgress'

  const userStore = useUserStore()
  const onboardingProgress = useOnboardingProgress()

  const allClients = ref<Client[]>([])
  const clientsLoading = ref(false)
  const clientSearch = ref('')

  const filteredClients = computed(() => {
    const q = clientSearch.value.trim().toLowerCase()
    if (!q) return allClients.value
    return allClients.value.filter((c) => c.name.toLowerCase().includes(q))
  })

  async function loadAllClients() {
    if (!userStore.amIAdministrator()) return
    clientsLoading.value = true
    try {
      allClients.value = await onboardingProgress.fetchAllClients()
    } finally {
      clientsLoading.value = false
    }
  }

  onMounted(loadAllClients)

  // ── Display helpers ────────────────────────────────────────────────────────

  const STEP_TITLES = [
    'ONE',
    'Jira',
    'Slack',
    'Bexio',
    'Clockodo',
    'Infrastruktur',
    'Manuelle Schritte',
    'E-Mail'
  ]

  function stepLabel(client: Client): string {
    const statuses = deriveStepStatuses(client)
    const completedCount = statuses.filter((s) => s === 'completed').length
    if (completedCount === ONBOARDING_STEP_COUNT) return 'Abgeschlossen'
    const firstIncomplete = statuses.findIndex((s) => s !== 'completed')
    const idx = firstIncomplete === -1 ? statuses.length - 1 : firstIncomplete
    const current = STEP_TITLES[idx] ?? `Schritt ${idx + 1}`
    return `${completedCount}/${ONBOARDING_STEP_COUNT} — ${current}`
  }

  function progressValue(client: Client): number {
    const statuses = deriveStepStatuses(client)
    return Math.round(
      (statuses.filter((s) => s === 'completed').length /
        ONBOARDING_STEP_COUNT) *
        100
    )
  }

  function isComplete(client: Client): boolean {
    return isOnboardingComplete(deriveStepStatuses(client))
  }

  function hasAnyProgress(client: Client): boolean {
    const statuses = deriveStepStatuses(client)
    return (
      statuses.slice(1).some((s) => s === 'completed') ||
      (client.onboarding_current_step ?? 0) > 0
    )
  }

  function actionLabel(client: Client): string {
    if (isComplete(client)) return 'Ansehen'
    if (hasAnyProgress(client)) return 'Fortsetzen'
    return 'Starten'
  }

  function actionIcon(client: Client): string {
    if (isComplete(client)) return 'material-symbols:visibility-rounded'
    return 'material-symbols:play-arrow-rounded'
  }

  function actionColor(client: Client): 'neutral' | 'primary' {
    return isComplete(client) ? 'neutral' : 'primary'
  }

  function statusIcon(client: Client): string {
    if (isComplete(client)) return 'material-symbols:verified-rounded'
    if (hasAnyProgress(client)) return 'material-symbols:pending-rounded'
    return 'material-symbols:business-rounded'
  }

  function statusIconColor(client: Client): string {
    if (isComplete(client)) return 'text-success'
    if (hasAnyProgress(client)) return 'text-primary'
    return 'text-muted'
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return ''
    return new Date(dateStr).toLocaleDateString('de-CH', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
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
          Diese Seite ist ausschliesslich für Administratoren zugänglich. Bitte
          wende Dich an einen Administrator, falls Du Zugriff benötigst.
        </template>
      </UAlert>

      <div class="pt-4">
        <UButton
          to="/"
          icon="material-symbols:arrow-back-ios-rounded"
          variant="ghost"
          color="neutral"
        >
          Zurück zum Dashboard
        </UButton>
      </div>
    </UPageCard>
  </div>

  <!-- Admin view -->
  <div v-else>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold">Client Onboarding</h1>
        <p class="text-muted">
          Neuen Client Schritt für Schritt in allen Systemen einrichten.
        </p>
      </div>
      <UBadge
        color="primary"
        variant="soft"
        icon="material-symbols:admin-panel-settings-rounded"
      >
        Admin
      </UBadge>
    </div>

    <div class="flex flex-col gap-6">
      <!-- Start new -->
      <UPageCard>
        <template #header>
          <div class="flex items-center gap-3">
            <UIcon
              name="material-symbols:add-circle-rounded"
              class="text-2xl text-primary"
            />
            <p class="font-semibold">Neues Onboarding starten</p>
          </div>
        </template>
        <p class="text-sm text-muted mb-4">
          Einen neuen Client von Grund auf in allen Systemen einrichten.
        </p>
        <UButton
          icon="material-symbols:rocket-launch-rounded"
          to="/onboarding/new"
        >
          Neues Onboarding starten
        </UButton>
      </UPageCard>

      <!-- Clients overview -->
      <UPageCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <UIcon
                name="material-symbols:manage-accounts-rounded"
                class="text-2xl text-warning"
              />
              <p class="font-semibold">Clients</p>
            </div>
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="material-symbols:refresh-rounded"
              :loading="clientsLoading"
              @click="loadAllClients"
            />
          </div>
        </template>
        <p class="text-sm text-muted mb-4">
          Jeden Client ansehen, fortsetzen oder starten. Der Fortschritt wird
          anhand der in den jeweiligen Diensten hinterlegten IDs ermittelt.
        </p>

        <div class="flex flex-col gap-3">
          <UInput
            v-model="clientSearch"
            placeholder="Client suchen…"
            icon="material-symbols:search-rounded"
            :loading="clientsLoading"
          />

          <div
            v-if="!clientsLoading && filteredClients.length === 0"
            class="text-sm text-muted italic"
          >
            Keine Clients gefunden.
          </div>

          <div v-else class="flex flex-col gap-2 max-h-96 overflow-y-auto">
            <NuxtLink
              v-for="client in filteredClients"
              :key="client.id"
              :to="`/onboarding/${client.id}`"
              class="flex items-center gap-4 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
            >
              <!-- Status icon -->
              <UIcon
                :name="statusIcon(client)"
                class="text-2xl shrink-0"
                :class="statusIconColor(client)"
              />

              <!-- Info -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-sm font-semibold truncate">{{
                    client.name
                  }}</span>
                  <div class="flex items-center gap-1 shrink-0">
                    <UBadge
                      v-if="client.jira_short_code"
                      size="xs"
                      color="info"
                      variant="soft"
                    >
                      Jira
                    </UBadge>
                    <UBadge
                      v-if="client.slack_channel_id"
                      size="xs"
                      color="primary"
                      variant="soft"
                    >
                      Slack
                    </UBadge>
                    <UBadge
                      v-if="client.bexio_contact_id"
                      size="xs"
                      color="success"
                      variant="soft"
                    >
                      Bexio
                    </UBadge>
                    <UBadge
                      v-if="client.clockodo_customer_id"
                      size="xs"
                      color="warning"
                      variant="soft"
                    >
                      Clockodo
                    </UBadge>
                    <UBadge
                      v-if="client.apiUrl"
                      size="xs"
                      color="secondary"
                      variant="soft"
                    >
                      Infra
                    </UBadge>
                  </div>
                </div>
                <div class="flex items-center gap-3 mt-1">
                  <UProgress
                    :model-value="progressValue(client)"
                    size="xs"
                    class="w-24"
                    :color="isComplete(client) ? 'success' : 'primary'"
                  />
                  <span class="text-xs text-muted">{{
                    stepLabel(client)
                  }}</span>
                </div>
              </div>

              <!-- Date -->
              <p
                v-if="client.date_updated"
                class="text-xs text-muted whitespace-nowrap shrink-0"
              >
                {{ formatDate(client.date_updated) }}
              </p>

              <!-- Action -->
              <UButton
                size="xs"
                variant="outline"
                :color="actionColor(client)"
                :icon="actionIcon(client)"
                tabindex="-1"
              >
                {{ actionLabel(client) }}
              </UButton>
            </NuxtLink>
          </div>
        </div>
      </UPageCard>
    </div>
  </div>
</template>
