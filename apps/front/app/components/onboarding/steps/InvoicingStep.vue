<script lang="ts" setup>
  import { readItems } from '@directus/sdk'
  import { ONBOARDING_DATA_KEY } from '~~/types/OnboardingTypes'
  import type { ClientPeriod, Period } from '~~/types/DirectusTypes'

  const { t } = useI18n()

  const data = inject(ONBOARDING_DATA_KEY)!

  const userStore = useUserStore()
  const selection = useClientSelection()
  const periodsComp = useUseClientPeriods()
  const invoicesComp = useInvoices()
  const { directus } = useDirectus()
  const { formatDate } = useFormatters()
  const toast = useToast()

  // The onboarded client (read from the store, refreshed on mount so a
  // just-created client and its periods appear).
  const onboardedClient = computed(() =>
    selection.clients.find((c) => c.id === data.clientId)
  )
  const clientPeriods = computed<ClientPeriod[]>(
    () => (onboardedClient.value?.periods ?? []) as ClientPeriod[]
  )

  function periodLabel(cp: ClientPeriod): string {
    const p = cp.Periods_id as Period | null
    if (p?.name) return p.name
    if (p?.from && p?.to) return `${formatDate(p.from)} – ${formatDate(p.to)}`
    return `#${cp.id}`
  }

  const clientPeriodOptions = computed(() =>
    clientPeriods.value.map((cp) => ({ id: cp.id, label: periodLabel(cp) }))
  )

  // Which billing period the invoices are created against. The invoice tool is
  // client-period scoped (URL `/:clientPeriodId/…`), so the per-type links below
  // both open the page AND select this client in the top-left selector.
  const selectedPeriodId = ref<number | undefined>(undefined)

  // Default to the newest existing period whenever the list (re)loads and the
  // current choice is no longer valid.
  watch(
    clientPeriodOptions,
    (options) => {
      if (
        selectedPeriodId.value &&
        options.some((o) => o.id === selectedPeriodId.value)
      ) {
        return
      }
      selectedPeriodId.value = data.clientId
        ? selection.newestPeriodIdForClient(data.clientId)
        : undefined
    },
    { immediate: true }
  )

  function invoiceLinkFor(tab: 'hosting' | 'prePaid'): string | undefined {
    return selectedPeriodId.value
      ? `/${selectedPeriodId.value}/create-bexio-invoice?tab=${tab}`
      : undefined
  }

  // --- Automatic detection: has each invoice been created for the period? ---
  // Hosting → an `Invoices` row of type 'hosting' exists. Onboarding → the
  // period has at least one `TopUp` (the onboarding invoice is billed via the
  // amount-based / Pre-Paid flow, which creates a TopUp). Re-runs when the
  // period changes and whenever the user returns to this tab (e.g. after
  // creating an invoice in the tool, which opens in a new tab).
  const hostingDone = ref(false)
  const onboardingDone = ref(false)
  const detecting = ref(false)

  async function detect() {
    const periodId = selectedPeriodId.value
    if (!periodId) {
      hostingDone.value = false
      onboardingDone.value = false
      return
    }
    detecting.value = true
    try {
      const [invoices, topUps] = await Promise.all([
        invoicesComp.loadInvoices(periodId),
        directus.request(
          readItems('TopUps', {
            filter: { clientPeriod: { _eq: periodId } } as any,
            fields: ['id'],
            limit: 1
          })
        )
      ])
      hostingDone.value = invoices.some((inv) => inv.type === 'hosting')
      onboardingDone.value = Array.isArray(topUps) && topUps.length > 0
    } catch {
      // Leave the last known state on a transient error.
    } finally {
      detecting.value = false
    }
  }

  watch(selectedPeriodId, () => {
    void detect()
  })

  const invoiceTypes = computed(() => [
    {
      id: 'hosting' as const,
      title: t('onboarding.steps.invoicing.tasks.hostingInvoice.title'),
      description: t(
        'onboarding.steps.invoicing.tasks.hostingInvoice.description'
      ),
      icon: 'lucide:refresh-cw',
      tab: 'hosting' as const,
      done: hostingDone.value
    },
    {
      id: 'onboarding' as const,
      title: t('onboarding.steps.invoicing.tasks.onboardingInvoice.title'),
      description: t(
        'onboarding.steps.invoicing.tasks.onboardingInvoice.description'
      ),
      icon: 'lucide:receipt',
      tab: 'prePaid' as const,
      done: onboardingDone.value
    }
  ])

  const completedCount = computed(
    () => invoiceTypes.value.filter((it) => it.done).length
  )
  const allDone = computed(
    () => completedCount.value === invoiceTypes.value.length
  )

  // --- Add a billing period: link a shared `Periods` definition to the client.
  const periodDefinitions = ref<Period[]>([])
  const periodDefToAdd = ref<string | undefined>(undefined)
  const creatingPeriod = ref(false)

  const addablePeriodDefs = computed(() =>
    periodDefinitions.value.filter(
      (def) =>
        !clientPeriods.value.some(
          (cp) => (cp.Periods_id as Period | null)?.id === def.id
        )
    )
  )

  async function addPeriod() {
    if (!data.clientId || !periodDefToAdd.value) return
    creatingPeriod.value = true
    try {
      const created = await periodsComp.createClientPeriod(
        data.clientId,
        periodDefToAdd.value
      )
      await userStore.loadUserData()
      selectedPeriodId.value = created.id
      periodDefToAdd.value = undefined
      toast.add({
        color: 'success',
        title: t('onboarding.steps.invoicing.period.added')
      })
    } catch (e: any) {
      toast.add({
        color: 'error',
        title: t('onboarding.steps.invoicing.period.addError'),
        description: e?.message
      })
    } finally {
      creatingPeriod.value = false
    }
  }

  onMounted(async () => {
    await userStore.loadUserData()
    try {
      periodDefinitions.value = await periodsComp.fetchPeriodDefinitions()
    } catch {
      periodDefinitions.value = []
    }
    void detect()
    window.addEventListener('focus', detect)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('focus', detect)
  })
</script>

<template>
  <div class="flex flex-col gap-4">
    <UAlert color="info" variant="soft" icon="lucide:info">
      <template #description>
        {{ t('onboarding.steps.invoicing.intro') }}
      </template>
    </UAlert>

    <!-- Billing period: select an existing one or add one for this client. -->
    <div
      class="rounded-lg border border-primary/30 bg-primary/5 p-3 flex flex-col gap-3"
    >
      <div class="min-w-0">
        <p class="text-sm font-medium">
          {{ t('onboarding.steps.invoicing.period.label') }}
        </p>
        <p class="text-xs text-muted">
          {{ t('onboarding.steps.invoicing.period.hint') }}
        </p>
      </div>

      <!-- Select an existing billing period -->
      <USelectMenu
        v-if="clientPeriodOptions.length"
        v-model="selectedPeriodId"
        :items="clientPeriodOptions"
        value-key="id"
        label-key="label"
        icon="lucide:calendar"
        class="w-full"
      />
      <p v-else class="text-xs text-muted">
        {{ t('onboarding.steps.invoicing.period.none') }}
      </p>

      <!-- Add a billing period for this client -->
      <div class="flex items-end gap-2">
        <UFormField
          :label="t('onboarding.steps.invoicing.period.addLabel')"
          class="flex-1"
        >
          <USelectMenu
            v-model="periodDefToAdd"
            :items="addablePeriodDefs"
            value-key="id"
            label-key="name"
            :placeholder="t('onboarding.steps.invoicing.period.addPlaceholder')"
            :disabled="!addablePeriodDefs.length"
            icon="lucide:calendar-plus"
            class="w-full"
          />
        </UFormField>
        <UButton
          icon="lucide:plus"
          color="neutral"
          variant="outline"
          :loading="creatingPeriod"
          :disabled="!periodDefToAdd"
          @click="addPeriod"
        >
          {{ t('onboarding.steps.invoicing.period.add') }}
        </UButton>
      </div>
      <p v-if="!periodDefinitions.length" class="text-xs text-warning">
        {{ t('onboarding.steps.invoicing.period.noDefinitions') }}
      </p>
    </div>

    <!-- Progress -->
    <div class="flex items-center gap-3">
      <UProgress
        :model-value="Math.round((completedCount / invoiceTypes.length) * 100)"
        size="sm"
        :color="allDone ? 'success' : 'primary'"
        class="flex-1"
      />
      <span class="text-xs text-muted whitespace-nowrap">
        {{
          t('onboarding.steps.invoicing.doneCount', {
            completed: completedCount,
            total: invoiceTypes.length
          })
        }}
      </span>
    </div>

    <!-- Invoice types: each creates its invoice and auto-detects completion -->
    <div class="flex flex-col gap-2">
      <div
        v-for="type in invoiceTypes"
        :key="type.id"
        class="flex items-center gap-3 p-3 rounded-lg border transition-all"
        :class="
          type.done
            ? 'border-success/40 bg-success/5'
            : 'border-neutral-200 dark:border-neutral-700'
        "
      >
        <UIcon
          :name="type.done ? 'lucide:circle-check' : type.icon"
          class="text-lg shrink-0"
          :class="type.done ? 'text-success' : 'text-muted'"
        />

        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium" :class="type.done ? 'text-muted' : ''">
            {{ type.title }}
          </p>
          <p class="text-xs text-muted mt-0.5">
            {{ type.description }}
          </p>
        </div>

        <UBadge
          v-if="type.done"
          color="success"
          variant="subtle"
          icon="lucide:check"
          class="shrink-0"
        >
          {{ t('onboarding.steps.invoicing.created') }}
        </UBadge>
        <UButton
          v-else-if="invoiceLinkFor(type.tab)"
          :to="invoiceLinkFor(type.tab)"
          target="_blank"
          icon="lucide:receipt"
          trailing-icon="lucide:external-link"
          size="sm"
          class="shrink-0"
        >
          {{ t('onboarding.steps.invoicing.createInvoice') }}
        </UButton>
        <UButton
          v-else
          disabled
          icon="lucide:receipt"
          color="neutral"
          variant="outline"
          size="sm"
          class="shrink-0"
        >
          {{ t('onboarding.steps.invoicing.createInvoice') }}
        </UButton>
      </div>
    </div>

    <!-- All done hint -->
    <UAlert
      v-if="allDone"
      color="success"
      variant="soft"
      icon="lucide:circle-check"
    >
      <template #description>
        {{ t('onboarding.steps.invoicing.allDone') }}
      </template>
    </UAlert>
  </div>
</template>
