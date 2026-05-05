<script lang="ts" setup>
  import type {
    Client,
    ClientPeriod,
    JiraWarning,
    Period
  } from '~~/types/DirectusTypes'
  import type { WarningAction } from '~/components/warnings/WarningActions.vue'
  import WorkLog from '~/components/dashboard/WorkLog.vue'

  const route = useRoute()
  const userStore = useUserStore()
  const { listForClients, isHalted } = useJiraWarnings()

  const clientPeriodId = computed<number | undefined>(() => {
    const raw = route.params?.clientPeriodId
    if (!raw) return
    return Number(raw)
  })

  const {
    data: entryGroups,
    pending,
    error
  } = await useAggregatedHours(clientPeriodId)

  const resolved = computed<{ client: Client; period: Period } | undefined>(
    () => {
      const id = clientPeriodId.value
      if (!id) return undefined
      for (const client of userStore.clients) {
        const periods = (client.periods || []) as ClientPeriod[]
        const match = periods.find((cp) => cp.id === id)
        if (match) return { client, period: match.Periods_id as Period }
      }
      return undefined
    }
  )

  const dashboardLink = computed(() => ({
    path: '/',
    query: {
      ...(resolved.value?.client?.id
        ? { clientId: resolved.value.client.id }
        : {}),
      ...(clientPeriodId.value
        ? { clientPeriodId: String(clientPeriodId.value) }
        : {})
    }
  }))

  const allWarnings = ref<JiraWarning[]>([])

  const {
    pendingActionFor,
    dispatchAction,
    haltConfirmWarning,
    confirmHalt,
    cancelHaltConfirmation
  } = useWarningActionRunner({
    onUpdate: (updated) => {
      const index = allWarnings.value.findIndex((w) => w.id === updated.id)
      if (index !== -1) allWarnings.value[index] = updated
    }
  })

  watch(
    () => resolved.value?.client?.id,
    async (clientId) => {
      if (!clientId) {
        allWarnings.value = []
        return
      }
      try {
        allWarnings.value = await listForClients([clientId])
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

  const haltedIssueKeys = computed<Set<string>>(
    () =>
      new Set(
        allWarnings.value
          .filter(
            (w) =>
              isHalted(w) && warningClientId(w) === resolved.value?.client?.id
          )
          .map((w) => w.jira_issue_key)
      )
  )

  const warningsByIssueKey = computed<Map<string, JiraWarning>>(() => {
    const map = new Map<string, JiraWarning>()
    if (!resolved.value?.client?.id) return map
    for (const warning of allWarnings.value) {
      if (warningClientId(warning) !== resolved.value.client.id) continue
      map.set(warning.jira_issue_key, warning)
    }
    return map
  })

  const focusIssueKey = computed<string | undefined>(() =>
    typeof route.query.issue === 'string' ? route.query.issue : undefined
  )
</script>

<template>
  <div>
    <UButton
      :to="dashboardLink"
      icon="material-symbols:arrow-back-ios"
      variant="ghost"
      size="sm"
      class="mb-4"
    >
      Zurück zum Dashboard
    </UButton>

    <USkeleton v-if="pending" class="h-32" />

    <UAlert
      v-else-if="error"
      color="error"
      variant="soft"
      icon="i-heroicons-exclamation-triangle"
      title="Beim Abrufen der Daten ist ein Fehler aufgetreten."
      :description="error.message"
    />

    <WorkLog
      v-else
      :entry-groups="entryGroups"
      :halted-issue-keys="haltedIssueKeys"
      :warnings-by-issue-key="warningsByIssueKey"
      :client-id="resolved?.client?.id"
      :focus-issue-key="focusIssueKey"
      :pending-action-for="pendingActionFor"
      @dispatch-warning-action="
        (w: JiraWarning, a: WarningAction) => dispatchAction(w, a)
      "
    />

    <WarningsHaltConfirmDialog
      :warning="haltConfirmWarning"
      @confirm="confirmHalt"
      @cancel="cancelHaltConfirmation"
    />
  </div>
</template>
