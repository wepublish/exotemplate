<script lang="ts" setup>
  import type { Client } from '~~/types/DirectusTypes'
  import {
    deriveStepStatuses,
    isOnboardingComplete,
    ONBOARDING_STEP_COUNT
  } from '~/composables/useOnboardingProgress'

  const userStore = useUserStore()
  const onboardingProgress = useOnboardingProgress()
  const { t } = useI18n()
  const { formatDateTime } = useFormatters()
  const link = useClientPeriodLink()

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

  const stepTitles = computed(() => [
    t('onboarding.steps.directus.title'),
    t('onboarding.steps.jira.title'),
    t('onboarding.steps.slack.title'),
    t('onboarding.steps.bexio.title'),
    t('onboarding.steps.clockodo.title'),
    t('onboarding.steps.infrastructure.title'),
    t('onboarding.steps.manualTasks.title'),
    t('onboarding.steps.email.title')
  ])

  function stepLabel(client: Client): string {
    const statuses = deriveStepStatuses(client)
    const completedCount = statuses.filter((s) => s === 'completed').length
    if (completedCount === ONBOARDING_STEP_COUNT)
      return t('onboarding.index.status.completed')
    const firstIncomplete = statuses.findIndex((s) => s !== 'completed')
    const idx = firstIncomplete === -1 ? statuses.length - 1 : firstIncomplete
    const current =
      stepTitles.value[idx] ??
      t('onboarding.index.status.stepFallback', { n: idx + 1 })
    return t('onboarding.index.status.stepProgress', {
      completed: completedCount,
      total: ONBOARDING_STEP_COUNT,
      current
    })
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
    if (isComplete(client)) return t('onboarding.index.action.view')
    if (hasAnyProgress(client)) return t('onboarding.index.action.continue')
    return t('onboarding.index.action.start')
  }

  function actionIcon(client: Client): string {
    if (isComplete(client)) return 'lucide:eye'
    return 'lucide:play'
  }

  function actionColor(client: Client): 'neutral' | 'primary' {
    return isComplete(client) ? 'neutral' : 'primary'
  }

  function statusIcon(client: Client): string {
    if (isComplete(client)) return 'lucide:badge-check'
    if (hasAnyProgress(client)) return 'lucide:clock'
    return 'lucide:building-2'
  }

  function statusIconColor(client: Client): string {
    if (isComplete(client)) return 'text-success'
    if (hasAnyProgress(client)) return 'text-primary'
    return 'text-muted'
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

      <div class="pt-4">
        <UButton
          :to="link('/dashboard')"
          icon="lucide:chevron-left"
          variant="ghost"
          color="neutral"
        >
          {{ t('onboarding.index.backToDashboard') }}
        </UButton>
      </div>
    </UPageCard>
  </div>

  <!-- Admin view -->
  <div v-else>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold">{{ t('onboarding.index.title') }}</h1>
        <p class="text-muted">
          {{ t('onboarding.index.subtitle') }}
        </p>
      </div>
      <UBadge color="primary" variant="soft" icon="lucide:shield-check">
        {{ t('onboarding.index.adminBadge') }}
      </UBadge>
    </div>

    <div class="flex flex-col gap-6">
      <!-- Start new -->
      <UPageCard>
        <template #header>
          <div class="flex items-center gap-3">
            <UIcon name="lucide:circle-plus" class="text-2xl text-primary" />
            <p class="font-semibold">
              {{ t('onboarding.index.startNew.title') }}
            </p>
          </div>
        </template>
        <p class="text-sm text-muted mb-4">
          {{ t('onboarding.index.startNew.description') }}
        </p>
        <UButton icon="lucide:rocket" :to="link('/onboarding/new')">
          {{ t('onboarding.index.startNew.button') }}
        </UButton>
      </UPageCard>

      <!-- Clients overview -->
      <UPageCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <UIcon name="lucide:user-cog" class="text-2xl text-warning" />
              <p class="font-semibold">
                {{ t('onboarding.index.clients.title') }}
              </p>
            </div>
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="lucide:refresh-cw"
              :loading="clientsLoading"
              @click="loadAllClients"
            />
          </div>
        </template>
        <p class="text-sm text-muted mb-4">
          {{ t('onboarding.index.clients.description') }}
        </p>

        <div class="flex flex-col gap-3">
          <UInput
            v-model="clientSearch"
            :placeholder="t('onboarding.index.clients.searchPlaceholder')"
            icon="lucide:search"
            :loading="clientsLoading"
          />

          <div
            v-if="!clientsLoading && filteredClients.length === 0"
            class="text-sm text-muted italic"
          >
            {{ t('onboarding.index.clients.noneFound') }}
          </div>

          <div v-else class="flex flex-col gap-2 max-h-96 overflow-y-auto">
            <NuxtLink
              v-for="client in filteredClients"
              :key="client.id"
              :to="link(`/onboarding/${client.id}`)"
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
                {{ formatDateTime(client.date_updated) }}
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
