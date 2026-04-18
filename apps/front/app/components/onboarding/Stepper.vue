<script lang="ts" setup>
  import type { Component } from 'vue'
  import {
    ONBOARDING_DATA_KEY,
    ADVANCE_STEP_KEY,
    createEmptyOnboardingData,
    type AdvanceStepOptions
  } from '~~/types/OnboardingTypes'
  import type { Client } from '~~/types/DirectusTypes'
  import {
    deriveStepStatuses,
    isOnboardingComplete,
    ONBOARDING_STEP_COUNT,
    type StepStatus
  } from '~/composables/useOnboardingProgress'
  import DirectusStep from './steps/DirectusStep.vue'
  import JiraStep from './steps/JiraStep.vue'
  import SlackStep from './steps/SlackStep.vue'
  import BexioStep from './steps/BexioStep.vue'
  import ClockodoStep from './steps/ClockodoStep.vue'
  import InfrastructureStep from './steps/InfrastructureStep.vue'
  import ManualTasksStep from './steps/ManualTasksStep.vue'
  import EmailStep from './steps/EmailStep.vue'

  interface StepConfig {
    id: string
    title: string
    description: string
    icon: string
    status: StepStatus
    component: Component
  }

  const props = defineProps<{
    initialClient?: Client | null
  }>()

  const emit = defineEmits<{
    (e: 'client-updated', client: Client): void
    (e: 'client-created', client: Client): void
    (e: 'completed', client: Client): void
  }>()

  const onboardingData = reactive(createEmptyOnboardingData())
  provide(ONBOARDING_DATA_KEY, onboardingData)

  const directusStore = useDirectus()
  const onboardingProgress = useOnboardingProgress()

  const currentClient = ref<Client | null>(null)
  const isSaving = ref(false)
  const isHydrating = ref(false)

  const steps = ref<StepConfig[]>([
    {
      id: 'directus',
      title: 'ONE',
      description: 'Neuen Client und Benutzer in der Directus-Instanz anlegen.',
      icon: 'material-symbols:person-add-rounded',
      status: 'active',
      component: DirectusStep
    },
    {
      id: 'jira',
      title: 'Jira',
      description: 'Ein neues Jira-Projekt für das Medium einrichten.',
      icon: 'simple-icons:jira',
      status: 'pending',
      component: JiraStep
    },
    {
      id: 'slack',
      title: 'Slack',
      description: 'Einen dedizierten Slack-Kanal für den Client anlegen.',
      icon: 'simple-icons:slack',
      status: 'pending',
      component: SlackStep
    },
    {
      id: 'bexio',
      title: 'Bexio',
      description: 'Den neuen Client in Bexio als Kontakt / Kunde erfassen.',
      icon: 'material-symbols:business-center-rounded',
      status: 'pending',
      component: BexioStep
    },
    {
      id: 'clockodo',
      title: 'Clockodo',
      description: 'Den Bexio-Kunden mit Clockodo verknüpfen.',
      icon: 'material-symbols:sync-rounded',
      status: 'pending',
      component: ClockodoStep
    },
    {
      id: 'infrastructure',
      title: 'Infrastruktur',
      description: 'Editor- und Website-Umgebung für den Client aufsetzen.',
      icon: 'material-symbols:cloud-upload-rounded',
      status: 'pending',
      component: InfrastructureStep
    },
    {
      id: 'manual-tasks',
      title: 'Manuelle Schritte',
      description: 'Manuelle Aufgaben gemäss Checkliste abarbeiten.',
      icon: 'material-symbols:checklist-rounded',
      status: 'pending',
      component: ManualTasksStep
    },
    {
      id: 'email',
      title: 'E-Mail',
      description: 'Zusammenfassungs-E-Mail mit allen Zugangsdaten versenden.',
      icon: 'material-symbols:mail-rounded',
      status: 'pending',
      component: EmailStep
    }
  ])

  const currentIndex = ref(0)
  const currentStep = computed(() => steps.value[currentIndex.value])
  const isFirstStep = computed(() => currentIndex.value === 0)
  const isLastStep = computed(
    () => currentIndex.value === steps.value.length - 1
  )
  const allCompleted = computed(() =>
    isOnboardingComplete(steps.value.map((s) => s.status))
  )

  const completedCount = computed(
    () => steps.value.filter((s) => s.status === 'completed').length
  )
  const progress = computed(() =>
    Math.round((completedCount.value / steps.value.length) * 100)
  )

  // ── Hydration ──────────────────────────────────────────────────────────────

  watch(
    () => props.initialClient?.id ?? null,
    async (id) => {
      if (!id) {
        resetStepper()
        return
      }
      // Skip if we're already working on this client — subsequent client
      // updates are driven locally and must not overwrite in-stepper state.
      if (currentClient.value?.id === id) return
      if (props.initialClient) await hydrateFromClient(props.initialClient)
    },
    { immediate: true }
  )

  async function hydrateFromClient(client: Client) {
    isHydrating.value = true
    currentClient.value = client

    onboardingData.clientId = client.id
    onboardingData.clientName = client.name

    const statuses = deriveStepStatuses(client)
    steps.value.forEach((step, i) => {
      step.status = statuses[i] as StepStatus
    })

    const savedCurrent = client.onboarding_current_step ?? 0
    const firstIncomplete = statuses.findIndex((s) => s !== 'completed')
    const target =
      firstIncomplete === -1
        ? steps.value.length - 1
        : Math.max(
            firstIncomplete,
            Math.min(savedCurrent, steps.value.length - 1)
          )
    currentIndex.value = target
    const targetStep = steps.value[target]
    if (targetStep && targetStep.status === 'pending') {
      targetStep.status = 'active'
    }

    // Pre-fill session fields from client record (identifiers)
    if (client.jira_short_code) {
      onboardingData.jiraProjectKey = client.jira_short_code
      onboardingData.jiraProjectName = client.name
      onboardingData.jiraResult = {
        id: '',
        key: client.jira_short_code,
        name: client.name,
        self: ''
      }
    }
    if (client.bexio_contact_id) {
      onboardingData.bexioContactId = client.bexio_contact_id
      onboardingData.bexioCompany = client.name
    }
    if (client.clockodo_customer_id) {
      onboardingData.clockodoId = client.clockodo_customer_id
    }
    if (client.apiUrl) {
      const match = client.apiUrl.match(/api\.([^.]+)\.wepublish\.cloud/)
      if (match && match[1]) onboardingData.infraMediumName = match[1]
      onboardingData.infraResult = {
        config_pr: { pr_number: 0, pr_url: '', branch: '' },
        website_pr: { pr_number: 0, pr_url: '', branch: '' }
      }
    }
    if (Array.isArray(client.onboarding_manual_checklist)) {
      onboardingData.manualChecklist = [...client.onboarding_manual_checklist]
    }

    // Fetch live read-only data from services for completed steps
    const tasks: Promise<unknown>[] = []

    if (client.slack_channel_id) {
      tasks.push(fetchSlackChannel(client.slack_channel_id))
    }
    if (client.bexio_contact_id) {
      tasks.push(fetchBexioContact(client.bexio_contact_id))
    }

    await Promise.allSettled(tasks)
    isHydrating.value = false
  }

  async function fetchSlackChannel(channelId: string) {
    try {
      const res = await directusStore.getCustomEndpoint(
        `client-onboarding/slack-channel/${encodeURIComponent(channelId)}`,
        {}
      )
      const ch = res?.data?.channel
      if (ch) {
        onboardingData.slackResult = {
          channel: { id: ch.id, name: ch.name }
        }
        onboardingData.slackChannel = ch.name ?? ''
        onboardingData.slackDescription = ch.purpose ?? ''
      } else {
        onboardingData.slackResult = {
          channel: { id: channelId, name: '' }
        }
      }
    } catch {
      onboardingData.slackResult = {
        channel: { id: channelId, name: '' }
      }
    }
  }

  async function fetchBexioContact(contactId: number) {
    try {
      const res = await directusStore.getCustomEndpoint(
        `client-onboarding/bexio-contact/${contactId}`,
        {}
      )
      const c = res?.data?.contact
      if (c) {
        onboardingData.bexioCompany = c.name_1 ?? onboardingData.bexioCompany
        onboardingData.bexioEmail = c.mail ?? ''
        onboardingData.bexioStreet = c.address ?? ''
        onboardingData.bexioZip = c.postcode ?? ''
        onboardingData.bexioCity = c.city ?? ''
      }
    } catch {
      // Leave whatever the client already had
    }
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  async function advanceStep(
    patch: Partial<Client> = {},
    options: AdvanceStepOptions = {}
  ): Promise<void> {
    if (isSaving.value) return
    isSaving.value = true

    try {
      const bump = options.bumpStep !== false
      const clientId =
        currentClient.value?.id ?? onboardingData.clientId ?? null

      // First-step case: DirectusStep just created the client; fetch the new
      // record so subsequent updates carry the right id.
      const wasNewClient = !currentClient.value && !!clientId
      if (!currentClient.value && clientId) {
        const fetched = await onboardingProgress.fetchClient(clientId)
        if (fetched) currentClient.value = fetched
      }

      if (!clientId) return

      const body: Partial<Client> = { ...patch }
      if (bump) {
        const previous = currentClient.value?.onboarding_current_step ?? 0
        const target = options.targetStep ?? currentIndex.value
        body.onboarding_current_step = Math.max(previous, target)
      }

      const updated = await onboardingProgress.updateClientOnboarding(
        clientId,
        body
      )
      currentClient.value = updated
      if (wasNewClient) emit('client-created', updated)
      emit('client-updated', updated)
    } catch {
      // Persisting silently fails — onboarding continues regardless
    } finally {
      isSaving.value = false
    }
  }

  provide(ADVANCE_STEP_KEY, advanceStep)

  // ── Navigation ─────────────────────────────────────────────────────────────

  function navigateTo(index: number) {
    const target = steps.value[index]
    if (target?.status === 'completed' || index === currentIndex.value) {
      currentIndex.value = index
    }
  }

  async function completeCurrentStep() {
    const completedIndex = currentIndex.value
    const cur = steps.value[completedIndex]
    if (cur) cur.status = 'completed'
    const wasLast = isLastStep.value
    if (!wasLast) {
      currentIndex.value = completedIndex + 1
      const next = steps.value[currentIndex.value]
      if (next && next.status === 'pending') next.status = 'active'
    }
    // Save the step the user has now moved on to. For the final step there
    // is no further step, so record steps.length to mark the whole flow done.
    const targetStep = wasLast ? steps.value.length : completedIndex + 1
    await advanceStep({}, { targetStep })
    if (wasLast && currentClient.value) {
      emit('completed', currentClient.value)
    }
  }

  function goBack() {
    if (!isFirstStep.value) {
      const cur = steps.value[currentIndex.value]
      if (cur && cur.status === 'active') cur.status = 'pending'
      currentIndex.value--
    }
  }

  function retryStep() {
    const cur = steps.value[currentIndex.value]
    if (cur) cur.status = 'active'
  }

  function resetStepper() {
    currentIndex.value = 0
    currentClient.value = null
    steps.value.forEach((step, i) => {
      step.status = i === 0 ? 'active' : 'pending'
    })
    Object.assign(onboardingData, createEmptyOnboardingData())
  }

  function stepStatusColor(status: StepStatus) {
    switch (status) {
      case 'completed':
        return 'success'
      case 'active':
        return 'primary'
      case 'error':
        return 'error'
      default:
        return 'neutral'
    }
  }

  function stepStatusIcon(status: StepStatus) {
    switch (status) {
      case 'completed':
        return 'material-symbols:check-circle-rounded'
      case 'active':
        return 'material-symbols:radio-button-checked-rounded'
      case 'error':
        return 'material-symbols:error-rounded'
      default:
        return 'material-symbols:circle-outline'
    }
  }

  // Keep ONBOARDING_STEP_COUNT referenced so imports stay tidy
  void ONBOARDING_STEP_COUNT
</script>

<template>
  <div class="grid grid-cols-12 gap-6">
    <!-- Left sidebar -->
    <div class="col-span-4">
      <UPageCard>
        <template #header>
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <p
                class="text-xs font-semibold text-muted uppercase tracking-wider"
              >
                Fortschritt
              </p>
              <UIcon
                v-if="isSaving || isHydrating"
                name="material-symbols:sync-rounded"
                class="text-sm text-muted animate-spin"
              />
            </div>
            <div class="flex items-center gap-2">
              <UProgress :model-value="progress" size="sm" class="flex-1" />
              <span class="text-xs text-muted whitespace-nowrap">
                {{ completedCount }}/{{ steps.length }}
              </span>
            </div>
          </div>
        </template>

        <div class="flex flex-col gap-0.5">
          <button
            v-for="(step, index) in steps"
            :key="step.id"
            class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all w-full"
            :class="{
              'bg-primary/10 ring-1 ring-primary/20':
                index === currentIndex && step.status !== 'error',
              'bg-error/10 ring-1 ring-error/20':
                index === currentIndex && step.status === 'error',
              'cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800':
                step.status === 'completed' && index !== currentIndex,
              'cursor-not-allowed opacity-40':
                step.status === 'pending' && index !== currentIndex
            }"
            :disabled="step.status === 'pending' && index !== currentIndex"
            @click="navigateTo(index)"
          >
            <UIcon
              :name="stepStatusIcon(step.status)"
              class="text-xl shrink-0"
              :class="`text-${stepStatusColor(step.status)}`"
            />
            <p
              class="text-sm font-medium truncate"
              :class="{
                'text-primary':
                  index === currentIndex && step.status !== 'error',
                'text-error': step.status === 'error'
              }"
            >
              {{ index + 1 }}. {{ step.title }}
            </p>
          </button>
        </div>
      </UPageCard>
    </div>

    <!-- Right: step content -->
    <div class="col-span-8 flex flex-col gap-4">
      <!-- Completion banner — shown above step content, doesn't block navigation -->
      <UAlert
        v-if="allCompleted"
        color="success"
        variant="soft"
        icon="material-symbols:verified-rounded"
      >
        <template #title>Onboarding abgeschlossen</template>
        <template #description>
          Alle Schritte wurden erfolgreich durchgeführt. Du kannst jeden Schritt
          weiterhin auswählen, um die hinterlegten Informationen einzusehen.
        </template>
      </UAlert>

      <!-- Active step -->
      <template v-if="currentStep">
        <!-- Step header card -->
        <UPageCard>
          <template #header>
            <div class="flex items-center gap-3">
              <div
                class="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                :class="
                  currentStep.status === 'error'
                    ? 'bg-error/10'
                    : 'bg-primary/10'
                "
              >
                <UIcon
                  :name="currentStep.icon"
                  class="text-xl"
                  :class="
                    currentStep.status === 'error'
                      ? 'text-error'
                      : 'text-primary'
                  "
                />
              </div>
              <div class="flex-1">
                <p class="font-bold text-lg">
                  Schritt {{ currentIndex + 1 }}: {{ currentStep.title }}
                </p>
                <p class="text-sm text-muted">{{ currentStep.description }}</p>
              </div>
              <UBadge
                v-if="currentStep.status === 'error'"
                color="error"
                variant="soft"
                icon="material-symbols:warning-rounded"
              >
                Fehler
              </UBadge>
            </div>
          </template>

          <!-- Dynamic step component -->
          <component :is="currentStep.component" :key="currentStep.id" />
        </UPageCard>

        <!-- Navigation -->
        <div class="flex justify-between items-center">
          <UButton
            v-if="!isFirstStep"
            icon="material-symbols:arrow-back-ios-rounded"
            variant="outline"
            color="neutral"
            @click="goBack"
          >
            Zurück
          </UButton>
          <div v-else />

          <div class="flex items-center gap-2">
            <UButton
              v-if="currentStep.status === 'error'"
              color="warning"
              variant="outline"
              icon="material-symbols:refresh-rounded"
              @click="retryStep"
            >
              Erneut versuchen
            </UButton>

            <UButton
              :icon="
                isLastStep
                  ? 'material-symbols:check-circle-rounded'
                  : 'material-symbols:arrow-forward-ios-rounded'
              "
              :trailing="!isLastStep"
              :loading="isSaving"
              @click="completeCurrentStep"
            >
              {{
                isLastStep ? 'Onboarding abschliessen' : 'Schritt abschliessen'
              }}
            </UButton>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
