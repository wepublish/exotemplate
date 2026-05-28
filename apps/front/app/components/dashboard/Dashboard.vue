<script lang="ts" setup>
  import type {
    Client,
    ClientPeriod,
    JiraWarning,
    Period
  } from '~~/types/DirectusTypes'
  import type { EntryGroup } from '../../../types/ClockodoTypes'
  import SummaryCard from './SummaryCard.vue'

  const userStore = useUserStore()
  const route = useRoute()
  const router = useRouter()
  const { compute, statusColor, statusHeadline, statusBody, statusIcon } =
    useWeeklyReportProgress()

  const selectedClientId = ref<string | undefined>(
    (route.query.clientId as string) || undefined
  )
  const selectedClientPeriodId = ref<number | undefined>(
    route.query.clientPeriodId ? Number(route.query.clientPeriodId) : undefined
  )

  // sync selections to URL query params — preserve any query params we
  // don't own (e.g. `issue` for deep-linking into the Arbeitsprotokoll).
  watch(
    [selectedClientId, selectedClientPeriodId],
    ([clientId, clientPeriodId]) => {
      const { clientId: _a, clientPeriodId: _b, ...rest } = route.query
      router.replace({
        query: {
          ...rest,
          ...(clientId ? { clientId } : {}),
          ...(clientPeriodId ? { clientPeriodId: String(clientPeriodId) } : {})
        }
      })
    }
  )

  const clients = computed<Client[]>(() => userStore.clients)
  const selectedClient = computed<Client | undefined>(() =>
    clients.value?.find((client) => client.id === selectedClientId.value)
  )

  const clientPeriods = computed<
    {
      id: number
      periodName: string | null
      from: string
      to: string
    }[]
  >(() => {
    return ((selectedClient.value?.periods || []) as ClientPeriod[]).map(
      (clientPeriod) => {
        const period = clientPeriod.Periods_id as Period
        return {
          id: clientPeriod.id,
          periodName: period.name,
          from: period.from,
          to: period.to
        }
      }
    )
  })

  const selectedPeriod = computed(() => {
    if (!selectedClientPeriodId.value) return undefined
    return clientPeriods.value.find(
      (period) => period.id === selectedClientPeriodId.value
    )
  })

  // auto select period with the most recent 'from' date when none is pre-selected via URL
  watch(
    clientPeriods,
    (periods) => {
      if (!selectedClientPeriodId.value && periods.length) {
        const newest = periods.reduce((a, b) => (a.from >= b.from ? a : b))
        selectedClientPeriodId.value = newest.id
      }
    },
    { immediate: true }
  )

  // auto select first client only when no clientId is in the URL
  watch(
    clients,
    () => {
      if (!selectedClientId.value && clients.value.length) {
        selectedClientId.value = clients.value[0]?.id
      }
    },
    { immediate: true }
  )

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
        icon: 'material-symbols:stop-circle-rounded',
        title: `${halts} ${halts === 1 ? 'Ticket ist' : 'Tickets sind'} gestoppt`,
        description:
          'An den betroffenen Tickets darf aktuell nicht gearbeitet werden, bis der Stopp aufgehoben wird.'
      }
    }
    const warnings = activeWarningsForSelectedCount.value
    if (warnings > 0) {
      return {
        color: 'warning',
        icon: 'i-heroicons-exclamation-triangle',
        title: `${warnings} ${warnings === 1 ? 'offene Warnung' : 'offene Warnungen'}`,
        description:
          'Bei einigen Tickets ist die Jira-Schätzung aufgebraucht oder überschritten.'
      }
    }
    const resolved = resolvedWarningsForSelectedCount.value
    if (resolved > 0) {
      return {
        color: 'success',
        icon: 'material-symbols:check-circle-rounded',
        title: `${resolved} ${resolved === 1 ? 'Warnung' : 'Warnungen'} erledigt`,
        description:
          'Die zugehörigen Jira-Tickets sind als Done oder Cancelled markiert — kein Handlungsbedarf.'
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

  const availableHoursSummary = computed(() => {
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
    <div class="col-span-12">
      <UPageCard>
        <template #title> Projekt und Abrechnungsperiode wählen </template>
        <template #body>
          <div class="flex flex-wrap items-center gap-4">
            <USelectMenu
              v-model="selectedClientId"
              size="xl"
              :items="clients"
              value-key="id"
              label-key="name"
              placeholder="Projekt wählen"
              class="min-w-60"
              @change="() => (selectedClientPeriodId = undefined)"
            />

            <USelectMenu
              v-model="selectedClientPeriodId"
              :disabled="!selectedClientId"
              size="xl"
              :items="clientPeriods"
              value-key="id"
              label-key="periodName"
              placeholder="Zeitraum wählen"
              class="min-w-60"
            />

            <DashboardCacheStatus
              :cache-info="cacheInfo"
              :client-period-id="selectedClientPeriodId"
              :pending="pending"
              :refresh="refresh"
            />
          </div>
        </template>
      </UPageCard>
    </div>

    <USkeleton v-if="pending" class="h-16 col-span-12" />

    <UAlert
      v-if="error"
      title="Beim Abrufen der Daten ist ein Fehler aufgetreten."
      :description="error.message"
      color="error"
      variant="soft"
      class="col-span-12"
      icon="i-heroicons-exclamation-triangle"
    />

    <!-- Half-width summary cards. Each links to a dedicated detail page. -->
    <template v-if="selectedClientPeriodId && !pending && !error">
      <div class="col-span-12 md:col-span-6">
        <SummaryCard
          title="Zahlungen / Top-Ups"
          icon="material-symbols:payments-outline-rounded"
          :hours="sums?.totalTopUps"
          :to="detailLink('top-ups')"
        />
      </div>

      <div class="col-span-12 md:col-span-6">
        <SummaryCard
          title="Verfügbare Arbeitsstunden"
          icon="material-symbols:hourglass-top-rounded"
          :hours="sums?.totalAvailableHours"
          :to="detailLink('available-hours')"
          :color="budgetColor"
        >
          <UAlert
            v-if="availableHoursSummary"
            :color="availableHoursSummary.color"
            variant="soft"
            :icon="availableHoursSummary.icon"
            :title="availableHoursSummary.title"
            :description="availableHoursSummary.description"
          />
        </SummaryCard>
      </div>

      <div class="col-span-12 md:col-span-6">
        <SummaryCard
          title="Arbeitsprotokoll"
          icon="material-symbols:list-alt-rounded"
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
      </div>

      <div class="col-span-12 md:col-span-6">
        <SummaryCard
          title="Manuelle Korrekturen"
          icon="material-symbols:edit-note-rounded"
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
