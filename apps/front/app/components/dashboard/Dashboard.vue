<script lang="ts" setup>
  import type { JiraWarning } from '~~/types/DirectusTypes'
  import type { EntryGroup } from '../../../types/ClockodoTypes'
  import SummaryCard from './SummaryCard.vue'

  const userStore = useUserStore()
  const { t } = useI18n()
  const { compute, statusColor, statusHeadline, statusBody, statusIcon } =
    useWeeklyReportProgress()

  // The client/period selection lives in the URL path (`/:clientPeriodId/…`);
  // useClientSelection derives it from the route. The dashboard just reads it.
  const selection = useClientSelection()
  const {
    selectedClientId,
    selectedClientPeriodId,
    clients,
    selectedClient,
    selectedPeriod
  } = storeToRefs(selection)
  const link = useClientPeriodLink()

  // Fetch all of the user's warnings once. Same source feeds the
  // cross-client halt banner above the cards AND the per-client halt /
  // warning summary surfaced inside the Arbeitsprotokoll card below.
  const { listForClients, isHalted } = useJiraWarnings()
  const allWarnings = ref<JiraWarning[]>([])

  watch(
    () => clients.value.map((c) => c.id).join(','),
    async () => {
      const ids = clients.value.map((c) => c.id)
      if (!ids.length) {
        allWarnings.value = []
        return
      }
      try {
        allWarnings.value = await listForClients(ids)
      } catch {
        allWarnings.value = []
      }
    },
    { immediate: true }
  )

  function warningClientId(warning: JiraWarning): string | null {
    const ref = warning.client
    if (!ref) return null
    return typeof ref === 'string' ? ref : (ref.id ?? null)
  }

  // Contract state for the selected client — drives the top warning banner.
  // Shows ONLY when a contract exists but its current version isn't signed;
  // never when the client has no contract at all. Defaults to no-warning until
  // the check resolves or fails, so a transient error never flashes a banner.
  const { listForClient } = useContracts()
  const selectedContractNeedsSignature = ref(false)
  watch(
    selectedClientId,
    async (id) => {
      if (!id) {
        selectedContractNeedsSignature.value = false
        return
      }
      try {
        const contracts = await listForClient(id)
        selectedContractNeedsSignature.value = contractNeedsSignature(contracts)
      } catch {
        selectedContractNeedsSignature.value = false
      }
    },
    { immediate: true }
  )

  // Per-client breakdown surfaced inside the Arbeitsprotokoll card.
  const haltsForSelectedCount = computed<number>(
    () =>
      allWarnings.value.filter(
        (w) => isHalted(w) && warningClientId(w) === selectedClientId.value
      ).length
  )

  /**
   * Set of Jira issue keys whose live status sits in Jira's `done` category
   * (Done, Cancelled, Resolved, Closed …). Derived from the EntryGroups tree
   * so the dashboard can mark warnings on those tickets as "Erledigt" without
   * persisting any extra state — flipping the issue back to an active status
   * in Jira removes the key from the set on the next refresh.
   */
  const resolvedIssueKeys = computed<Set<string>>(() => {
    const keys = new Set<string>()
    function walk(groups: EntryGroup[] | undefined): void {
      if (!groups) return
      for (const g of groups) {
        if (
          g.name &&
          g.jiraIssue?.fields?.status?.statusCategory?.key === 'done'
        ) {
          keys.add(g.name)
        }
        walk(g.sub_groups)
      }
    }
    walk(computedEntryGroups.value?.groups)
    return keys
  })

  const activeWarningsForSelectedCount = computed<number>(
    () =>
      allWarnings.value.filter(
        (w) =>
          warningClientId(w) === selectedClientId.value &&
          !isHalted(w) &&
          !w.silenced_permanently &&
          !resolvedIssueKeys.value.has(w.jira_issue_key)
      ).length
  )

  const resolvedWarningsForSelectedCount = computed<number>(
    () =>
      allWarnings.value.filter(
        (w) =>
          warningClientId(w) === selectedClientId.value &&
          !isHalted(w) &&
          resolvedIssueKeys.value.has(w.jira_issue_key)
      ).length
  )

  // Card-level alert: halts take priority over open warnings, since a halt
  // is the action item the team must resolve first. When neither demands
  // attention but warnings have been resolved by Jira flipping the issue
  // into the `done` category, surface that as a green success note so the
  // user sees that previously-warned tickets are now finished. Wording
  // mirrors the banner inside WorkLog.vue so the dashboard and detail page
  // agree.
  const workLogAlert = computed<{
    color: 'error' | 'warning' | 'success'
    icon: string
    title: string
    description: string
  } | null>(() => {
    const halts = haltsForSelectedCount.value
    if (halts > 0) {
      return {
        color: 'error',
        icon: 'lucide:circle-stop',
        title: t('dashboard.workLogAlert.haltedTitle', { count: halts }, halts),
        description: t('dashboard.workLogAlert.haltedDescription')
      }
    }
    const warnings = activeWarningsForSelectedCount.value
    if (warnings > 0) {
      return {
        color: 'warning',
        icon: 'i-heroicons-exclamation-triangle',
        title: t(
          'dashboard.workLogAlert.openWarningsTitle',
          { count: warnings },
          warnings
        ),
        description: t('dashboard.workLogAlert.openWarningsDescription')
      }
    }
    const resolved = resolvedWarningsForSelectedCount.value
    if (resolved > 0) {
      return {
        color: 'success',
        icon: 'lucide:circle-check',
        title: t(
          'dashboard.workLogAlert.resolvedTitle',
          { count: resolved },
          resolved
        ),
        description: t('dashboard.workLogAlert.resolvedDescription')
      }
    }
    return null
  })

  const clientPeriodId = computed(() => selectedClientPeriodId.value)

  const {
    data: computedEntryGroups,
    pending,
    error,
    refresh,
    cacheInfo
  } = await useAggregatedHours(clientPeriodId)

  const sums = computed(() => computedEntryGroups.value?.sums)

  // Mirror the colouring rules from the Verfügbare Arbeitsstunden detail page
  // so the dashboard tile signals the same severity at a glance.
  const budgetColor = computed<
    'primary' | 'success' | 'warning' | 'error' | 'info'
  >(() => {
    const used = sums.value?.totalUsedPercentage || 0
    if (used >= 90) return 'error'
    if (used >= 75) return 'warning'
    return 'primary'
  })

  const availableHoursProgress = computed(() =>
    compute({
      totalUsedHours: sums.value?.totalUsedHours,
      totalTopUps: sums.value?.totalTopUps,
      periodFrom: selectedPeriod.value?.from,
      periodTo: selectedPeriod.value?.to
    })
  )

  const isMonthlyBilling = computed(
    () => (selectedClient.value?.billing_mode ?? 'prepaid') === 'monthly'
  )

  // Monthly clients are invoiced after the fact: there's no budget to warn
  // about, so the dashboard tile drops the alert and relabels the figure to
  // "Aktuell zu verrechnen" with the positive amount that still needs to
  // land on the next invoice (= -totalAvailableHours, floored at 0).
  const availableHoursTitle = computed(() =>
    isMonthlyBilling.value
      ? t('dashboard.cards.toBill')
      : t('dashboard.cards.availableHours')
  )

  const availableHoursValue = computed<number | undefined>(() => {
    const available = sums.value?.totalAvailableHours
    if (available == null) return undefined
    return isMonthlyBilling.value ? Math.max(0, -available) : available
  })

  const availableHoursSummary = computed(() => {
    if (isMonthlyBilling.value) return null
    const p = availableHoursProgress.value
    if (!p) return null
    const color = statusColor(p.status)
    // Surface the alert on the dashboard only when something demands attention.
    // `primary` (on_track) and `success` (ahead_of_schedule) stay off the
    // dashboard; the detail page still shows the full alert in every state.
    if (color !== 'warning' && color !== 'error') return null
    return {
      color,
      icon: statusIcon(p.status),
      title: statusHeadline(p.status),
      description: statusBody(p)
    }
  })

  function detailLink(slug: string): string {
    return selectedClientPeriodId.value
      ? `/${selectedClientPeriodId.value}/${slug}`
      : '/'
  }
</script>

<template>
  <div class="grid grid-cols-12 gap-4">
    <!-- Header: the selected client/period (chosen in the sidebar selector)
         plus the cache freshness badge for this dashboard's data. -->
    <div class="col-span-12 flex flex-wrap items-center justify-between gap-3">
      <div v-if="selectedClient" class="min-w-0">
        <h1 class="text-2xl font-bold truncate">{{ selectedClient.name }}</h1>
        <p v-if="selectedPeriod?.periodName" class="text-sm text-muted">
          {{ selectedPeriod.periodName }}
        </p>
      </div>
      <DashboardCacheStatus
        :cache-info="cacheInfo"
        :client-period-id="selectedClientPeriodId"
        :pending="pending"
        :refresh="refresh"
      />
    </div>

    <!-- No client assigned at all: nothing to show. -->
    <UAlert
      v-if="!clients.length"
      :title="t('dashboard.noClientAccess.title')"
      :description="t('dashboard.noClientAccess.description')"
      color="info"
      variant="soft"
      class="col-span-12"
      icon="lucide:info"
    />

    <!-- Contract exists but its current version isn't signed: prompt to upload. -->
    <UAlert
      v-if="selectedClient && selectedContractNeedsSignature"
      :title="t('dashboard.contractWarning.title')"
      :description="t('dashboard.contractWarning.description')"
      color="warning"
      variant="soft"
      class="col-span-12"
      icon="lucide:triangle-alert"
    >
      <template #actions>
        <UButton
          :to="link(`/settings/contracts/${selectedClient.id}`)"
          color="warning"
          variant="solid"
          size="sm"
          icon="lucide:file-text"
        >
          {{ t('dashboard.contractWarning.action') }}
        </UButton>
      </template>
    </UAlert>

    <USkeleton v-if="pending" class="h-16 col-span-12" />

    <UAlert
      v-if="error"
      :title="t('dashboard.loadError')"
      :description="error.message"
      color="error"
      variant="soft"
      class="col-span-12"
      icon="i-heroicons-exclamation-triangle"
    />

    <!--
      Half-width summary cards, each linking to a dedicated detail page.
      Nested in their own grid so `auto-rows-fr` sizes every row to the
      tallest card — all four tiles share one height regardless of which
      ones render an inline alert. (Kept separate from the outer 12-col grid
      so the full-width selector/network cards above and below aren't
      stretched to match.)
    -->
    <template v-if="selectedClientPeriodId && !pending && !error">
      <div
        class="col-span-12 grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-fr"
      >
        <SummaryCard
          :title="t('dashboard.cards.topUps')"
          icon="lucide:credit-card"
          :hours="sums?.totalTopUps"
          :to="detailLink('top-ups')"
        />

        <SummaryCard
          :title="availableHoursTitle"
          icon="lucide:hourglass"
          :hours="availableHoursValue"
          :to="detailLink('available-hours')"
          :color="isMonthlyBilling ? 'primary' : budgetColor"
        >
          <UAlert
            v-if="availableHoursSummary"
            :color="availableHoursSummary.color"
            variant="soft"
            :icon="availableHoursSummary.icon"
            :title="availableHoursSummary.title"
            :description="availableHoursSummary.description"
          />
          <BillingBudgetProgressBars
            v-if="!isMonthlyBilling && sums"
            :class="availableHoursSummary ? 'mt-3' : ''"
            :sums="sums"
            :progress="availableHoursProgress"
            :budget-color="budgetColor"
          />
        </SummaryCard>

        <SummaryCard
          :title="t('dashboard.cards.workLog')"
          icon="lucide:list"
          :hours="sums?.billableHours"
          :to="detailLink('work-log')"
        >
          <UAlert
            v-if="workLogAlert"
            :color="workLogAlert.color"
            variant="soft"
            :icon="workLogAlert.icon"
            :title="workLogAlert.title"
            :description="workLogAlert.description"
          />
        </SummaryCard>

        <SummaryCard
          :title="t('dashboard.cards.manualCorrections')"
          icon="lucide:square-pen"
          :hours="sums?.totalManualWorkHours"
          :to="detailLink('manual-corrections')"
        />
      </div>
    </template>

    <!-- Network contribution: always full width, expandable. No detail page. -->
    <div
      v-if="selectedClientPeriodId && !pending && !error"
      class="col-span-12"
    >
      <DashboardNetworkContribution
        :client-period-id="selectedClientPeriodId"
        :period-from="selectedPeriod?.from"
        :period-to="selectedPeriod?.to"
        :sums="sums"
      />
    </div>
  </div>
</template>
