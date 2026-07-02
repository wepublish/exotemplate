<script lang="ts" setup>
  import type {
    ProjectBudget,
    IntensivePhase,
    Client
  } from '~~/types/DirectusTypes'
  import type {
    PlanEmployee,
    PlanProject,
    PlanOverview
  } from '~/composables/useResourcePlanning'

  const userStore = useUserStore()
  const { t } = useI18n()
  const toast = useToast()
  const { getCustomEndpoint } = useDirectus()

  const isAdmin = userStore.amIAdministrator()

  const currentYear = new Date().getUTCFullYear()
  const year = ref<number>(currentYear)
  const yearOptions = computed(() =>
    [currentYear - 1, currentYear, currentYear + 1].map((v) => ({
      value: v,
      label: String(v)
    }))
  )

  const admin = useResourcePlanningAdmin()

  // Full media list — every client the admin can see is a project row; no need
  // to add them manually. `search` filters the list by name.
  const search = ref('')
  const clients = computed<Client[]>(() => {
    const q = search.value.trim().toLowerCase()
    return [...userStore.clients]
      .filter((c) => c.status !== 'archived')
      .filter((c) => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  // Overview (employees for assignment + derived budget/remaining per client).
  // Fetched directly here — the shared lazy composable didn't reliably deliver
  // the roster to this page, and the assignee dropdowns need it.
  const overview = ref<PlanOverview | null>(null)
  async function loadOverview(): Promise<void> {
    if (!isAdmin) return
    try {
      const res = await getCustomEndpoint('resource-planning/overview', {
        from: `${year.value}-01-01`,
        to: `${year.value}-12-31`
      })
      overview.value = (res.data?.data as PlanOverview) ?? null
    } catch {
      overview.value = null
    }
  }
  const employees = computed<PlanEmployee[]>(
    () => overview.value?.employees ?? []
  )
  const employeeName = (uid: string | null) =>
    uid
      ? (employees.value.find((e) => String(e.id) === String(uid))?.name ?? uid)
      : null
  // Only active (non-excluded) people can be assigned.
  const activeEmployees = computed(() =>
    employees.value.filter((e) => !e.excluded)
  )
  const assigneeOptions = computed(() => [
    { value: '', label: t('resourcePlanning.wholeTeam') },
    ...activeEmployees.value.map((e) => ({
      value: String(e.id),
      label: e.name
    }))
  ])
  // Person picker (weighted assignees) — blank placeholder + active people.
  const personOptions = computed(() => [
    { value: '', label: '—' },
    ...activeEmployees.value.map((e) => ({
      value: String(e.id),
      label: e.name
    }))
  ])
  const overviewByClient = computed(() => {
    const m = new Map<string, PlanProject>()
    for (const p of overview.value?.projects ?? []) {
      if (p.clientId) m.set(p.clientId, p)
    }
    return m
  })
  const remainingFor = (clientId: string): number | null =>
    overviewByClient.value.get(clientId)?.availableHours ?? null

  // ── Budgets (existing rows, keyed by client) ────────────────────────────────
  const budgets = ref<ProjectBudget[]>([])
  const loading = ref(false)
  const budgetByClient = computed(() => {
    const m = new Map<string, ProjectBudget>()
    for (const b of budgets.value) {
      const cid = typeof b.client === 'string' ? b.client : b.client?.id
      if (cid) m.set(cid, b)
    }
    return m
  })

  // Drafts keyed by client id so typing doesn't fight the async refresh.
  const minHoursDraft = reactive<Record<string, number>>({})
  // Weighted min assignees per client: list of { clockodo_user_id, share }.
  type Share = { clockodo_user_id: string; share: number }
  const minAssigneesDraft = reactive<Record<string, Share[]>>({})

  function seedDrafts(): void {
    for (const c of clients.value) {
      const b = budgetByClient.value.get(c.id)
      minHoursDraft[c.id] = b?.min_weekly_hours ?? 0
      minAssigneesDraft[c.id] = (b?.min_assignees ?? []).map((a) => ({
        clockodo_user_id: a.clockodo_user_id,
        share: a.share
      }))
      // Migrate a legacy single assignee into the list view.
      if (!minAssigneesDraft[c.id]!.length && b?.min_weekly_clockodo_user_id) {
        minAssigneesDraft[c.id] = [
          { clockodo_user_id: b.min_weekly_clockodo_user_id, share: 100 }
        ]
      }
    }
  }

  // Seed defaults immediately (before budgets load) so no input ever receives
  // an `undefined` model.
  watch(
    clients,
    (list) => {
      for (const c of list) {
        if (minHoursDraft[c.id] === undefined) minHoursDraft[c.id] = 0
        if (minAssigneesDraft[c.id] === undefined) minAssigneesDraft[c.id] = []
      }
    },
    { immediate: true }
  )

  async function loadBudgets(): Promise<void> {
    if (!isAdmin) return
    loading.value = true
    try {
      budgets.value = await admin.listBudgets(year.value)
      seedDrafts()
    } catch (err: any) {
      toast.add({
        title: t('resourcePlanning.loadError'),
        description: err?.message,
        color: 'error'
      })
    } finally {
      loading.value = false
    }
  }
  watch(year, () => {
    loadBudgets()
    loadOverview()
  })
  onMounted(() => {
    loadBudgets()
    loadOverview()
  })

  function notifyError(err: any): void {
    toast.add({
      title: t('resourcePlanning.saveError'),
      description: err?.message,
      color: 'error'
    })
  }

  // Create the ProjectBudget row lazily on first edit (budget 0 = derived from
  // remaining), returning its id.
  async function ensureBudget(clientId: string): Promise<number> {
    const existing = budgetByClient.value.get(clientId)
    if (existing) return existing.id
    const created = await admin.createBudget({
      client: clientId,
      year: year.value,
      annual_budget_hours: 0
    })
    await loadBudgets()
    return created.id
  }

  async function saveMin(clientId: string): Promise<void> {
    const hours = Math.max(0, Number(minHoursDraft[clientId]) || 0)
    minHoursDraft[clientId] = hours
    const list = (minAssigneesDraft[clientId] ?? []).filter(
      (a) => a.clockodo_user_id
    )
    try {
      const budgetId = await ensureBudget(clientId)
      await admin.updateBudget(budgetId, {
        min_weekly_hours: hours,
        // The legacy single field is superseded by the weighted list.
        min_weekly_clockodo_user_id: null
      })
      await admin.setMinAssignees(
        budgetId,
        list.map((a) => ({
          clockodo_user_id: a.clockodo_user_id,
          share: Math.max(0, Number(a.share) || 0)
        }))
      )
      await loadBudgets()
      toast.add({ title: t('resourcePlanning.saved'), color: 'success' })
    } catch (err: any) {
      notifyError(err)
    }
  }
  function addMinAssignee(clientId: string): void {
    const list = (minAssigneesDraft[clientId] ??= [])
    list.push({ clockodo_user_id: '', share: 0 })
    evenShares(list)
  }
  function removeMinAssignee(clientId: string, idx: number): void {
    const list = minAssigneesDraft[clientId]
    if (!list) return
    list.splice(idx, 1)
    evenShares(list)
    saveMin(clientId)
  }
  function rebalanceMin(clientId: string, idx: number): void {
    const list = minAssigneesDraft[clientId]
    if (!list) return
    rebalanceShares(list, idx)
    saveMin(clientId)
  }

  async function removeBudgetPlan(clientId: string): Promise<void> {
    const b = budgetByClient.value.get(clientId)
    if (!b) return
    if (!confirm(t('resourcePlanning.confirmDeleteBudget'))) return
    try {
      for (const p of b.phases ?? []) await admin.deletePhase(p.id)
      await admin.deleteBudget(b.id)
      await loadBudgets()
    } catch (err: any) {
      notifyError(err)
    }
  }

  // ── Phase modal (add / edit) ────────────────────────────────────────────────
  // Entered as an hourly budget per week over a date range; stored total = per
  // week × spanned weeks.
  const phaseModalOpen = ref(false)
  const phaseClientId = ref<string | null>(null)
  const editingPhaseId = ref<number | null>(null)
  const phaseForm = reactive<{
    name: string
    from: string
    to: string
    perWeek: number
    assignees: Share[]
  }>({ name: '', from: '', to: '', perWeek: 0, assignees: [] })
  const savingPhase = ref(false)
  function addPhaseAssignee(): void {
    phaseForm.assignees.push({ clockodo_user_id: '', share: 0 })
    evenShares(phaseForm.assignees)
  }
  function removePhaseAssignee(idx: number): void {
    phaseForm.assignees.splice(idx, 1)
    evenShares(phaseForm.assignees)
  }

  function mondayOf(iso: string): number {
    const d = new Date(`${iso}T00:00:00Z`)
    const dow = (d.getUTCDay() + 6) % 7
    d.setUTCDate(d.getUTCDate() - dow)
    return d.getTime()
  }
  function weekSpan(fromIso: string, toIso: string): number {
    if (!fromIso || !toIso || fromIso > toIso) return 0
    return Math.round((mondayOf(toIso) - mondayOf(fromIso)) / 604800000) + 1
  }
  const phaseWeeks = computed(() => weekSpan(phaseForm.from, phaseForm.to))
  const phaseTotal = computed(
    () => (Number(phaseForm.perWeek) || 0) * phaseWeeks.value
  )

  // Swiss date display (dd.mm.yyyy) over ISO storage, plus date helpers.
  const pad2 = (n: number) => String(n).padStart(2, '0')
  function isoToDe(iso: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
    const [y, m, d] = iso.split('-')
    return `${d}.${m}.${y}`
  }
  function addDaysIso(iso: string, days: number): string {
    const d = new Date(`${iso}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }
  function firstOfNextMonthIso(): string {
    const now = new Date()
    let y = now.getUTCFullYear()
    let m = now.getUTCMonth() + 1 // next month (0-based → +1 lands on next)
    if (m > 11) {
      m = 0
      y += 1
    }
    return `${y}-${pad2(m + 1)}-01`
  }
  function openAddPhase(clientId: string): void {
    phaseClientId.value = clientId
    editingPhaseId.value = null
    phaseForm.name = ''
    // Default: start at the beginning of next month, 6-day duration.
    phaseForm.from = firstOfNextMonthIso()
    phaseForm.to = addDaysIso(phaseForm.from, 5)
    phaseForm.perWeek = 0
    phaseForm.assignees = []
    phaseModalOpen.value = true
  }

  function openEditPhase(clientId: string, p: IntensivePhase): void {
    phaseClientId.value = clientId
    editingPhaseId.value = p.id
    phaseForm.name = p.name ?? ''
    phaseForm.from = p.from
    phaseForm.to = p.to
    const span = weekSpan(p.from, p.to)
    phaseForm.perWeek =
      span > 0 ? Math.round((p.hours / span) * 100) / 100 : p.hours
    phaseForm.assignees = (p.assignees ?? []).map((a) => ({
      clockodo_user_id: a.clockodo_user_id,
      share: a.share
    }))
    if (!phaseForm.assignees.length && p.clockodo_user_id) {
      phaseForm.assignees = [
        { clockodo_user_id: p.clockodo_user_id, share: 100 }
      ]
    }
    phaseModalOpen.value = true
  }

  const phaseValid = computed(
    () =>
      !!phaseForm.from &&
      !!phaseForm.to &&
      phaseForm.from <= phaseForm.to &&
      Number(phaseForm.perWeek) > 0
  )

  async function savePhase(): Promise<void> {
    if (!phaseValid.value || !phaseClientId.value) return
    savingPhase.value = true
    const payload = {
      name: phaseForm.name.trim() || null,
      from: phaseForm.from,
      to: phaseForm.to,
      hours: Math.round(phaseTotal.value * 100) / 100,
      // Legacy single field superseded by the weighted assignees list.
      clockodo_user_id: null
    }
    const assignees = phaseForm.assignees
      .filter((a) => a.clockodo_user_id)
      .map((a) => ({
        clockodo_user_id: a.clockodo_user_id,
        share: Math.max(0, Number(a.share) || 0)
      }))
    try {
      let phaseId = editingPhaseId.value
      if (phaseId != null) {
        await admin.updatePhase(phaseId, payload)
      } else {
        const budgetId = await ensureBudget(phaseClientId.value)
        const created = await admin.createPhase({
          project_budget: budgetId,
          ...payload
        })
        phaseId = created.id
      }
      await admin.setPhaseAssignees(phaseId, assignees)
      phaseModalOpen.value = false
      await loadBudgets()
      toast.add({ title: t('resourcePlanning.saved'), color: 'success' })
    } catch (err: any) {
      notifyError(err)
    } finally {
      savingPhase.value = false
    }
  }

  async function removePhase(p: IntensivePhase): Promise<void> {
    if (!confirm(t('resourcePlanning.confirmDeletePhase'))) return
    try {
      await admin.deletePhase(p.id)
      await loadBudgets()
    } catch (err: any) {
      notifyError(err)
    }
  }

  const round = (v: number) => Math.round(v * 10) / 10

  // Shares always total 100. Even split with the remainder on the last entry
  // (2 → 50/50, 3 → 33/33/34).
  function evenShares(list: Share[]): void {
    const n = list.length
    if (!n) return
    const base = Math.floor(100 / n)
    list.forEach((a) => (a.share = base))
    list[n - 1]!.share = 100 - base * (n - 1)
  }
  // Keep the edited entry, split the rest of 100 evenly among the others.
  function rebalanceShares(list: Share[], idx: number): void {
    const n = list.length
    if (n <= 1) {
      if (n === 1) list[0]!.share = 100
      return
    }
    const v = Math.min(100, Math.max(0, Number(list[idx]!.share) || 0))
    list[idx]!.share = v
    const others = list.filter((_, i) => i !== idx)
    const base = Math.floor((100 - v) / others.length)
    others.forEach((a) => (a.share = base))
    others[others.length - 1]!.share = 100 - v - base * (others.length - 1)
  }

  // "Name 60% · Name 40%" for a weighted assignee list (or a legacy single id).
  function assigneesLabel(
    list: { clockodo_user_id: string; share: number }[] | undefined,
    legacyUid?: string | null
  ): string {
    const arr = list ?? []
    if (arr.length) {
      const total = arr.reduce((s, a) => s + (a.share || 0), 0) || 1
      return arr
        .map(
          (a) =>
            `${employeeName(a.clockodo_user_id)} ${Math.round(((a.share || 0) / total) * 100)}%`
        )
        .join(' · ')
    }
    return legacyUid ? (employeeName(legacyUid) ?? '') : ''
  }
</script>

<template>
  <div class="p-4 sm:p-6">
    <div v-if="!isAdmin" class="flex justify-center pt-16">
      <UPageCard class="max-w-md w-full">
        <template #header>
          <div class="flex items-center gap-3">
            <UIcon name="lucide:lock" class="text-3xl text-error" />
            <p class="font-bold text-lg">
              {{ t('common.accessDenied.title') }}
            </p>
          </div>
        </template>
        <UAlert
          color="error"
          variant="soft"
          icon="lucide:user-x"
          :title="t('common.accessDenied.title')"
          :description="t('common.accessDenied.body')"
        />
      </UPageCard>
    </div>

    <template v-else>
      <div class="flex flex-wrap items-end justify-between gap-4 mb-4">
        <div>
          <h1 class="text-2xl font-bold">{{ t('resourcePlanning.title') }}</h1>
          <p class="text-muted text-sm">
            {{ t('resourcePlanning.projectsIntro') }}
          </p>
        </div>
        <USelect
          v-model="year"
          :items="yearOptions"
          value-key="value"
          label-key="label"
          class="w-32"
        />
      </div>

      <ResourcePlanningTabs active="projects" />

      <UInput
        v-model="search"
        icon="lucide:search"
        :placeholder="t('resourcePlanning.searchProjects')"
        class="w-full sm:w-72 mb-4"
      />

      <USkeleton v-if="loading" class="h-40" />

      <UAlert
        v-else-if="!clients.length"
        color="info"
        variant="soft"
        icon="lucide:info"
        :title="t('resourcePlanning.noProjectsMatch')"
      />

      <div v-else class="space-y-4">
        <UPageCard v-for="c in clients" :key="c.id">
          <template #header>
            <div
              class="flex flex-wrap items-center justify-between gap-3 w-full"
            >
              <div class="min-w-0">
                <span class="font-semibold">{{ c.name }}</span>
                <span
                  v-if="remainingFor(c.id) != null"
                  class="text-xs text-muted ms-2"
                  :class="{ 'text-error': (remainingFor(c.id) ?? 0) < 0 }"
                >
                  · {{ t('resourcePlanning.remaining') }}:
                  {{ round(remainingFor(c.id) as number) }}
                  {{ t('resourcePlanning.hours') }}
                </span>
              </div>
              <UButton
                v-if="budgetByClient.get(c.id)"
                icon="lucide:rotate-ccw"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="t('resourcePlanning.reset')"
                :title="t('resourcePlanning.reset')"
                @click="removeBudgetPlan(c.id)"
              />
            </div>
          </template>

          <!-- Minimum weekly load (lower border), optionally assigned to a person -->
          <div
            class="flex flex-wrap items-end gap-3 mb-4 pb-3 border-b border-default/60"
          >
            <UFormField
              :label="t('resourcePlanning.minWeekly')"
              :help="t('resourcePlanning.minWeeklyHelp')"
            >
              <UInput
                v-model.number="minHoursDraft[c.id]"
                type="number"
                min="0"
                step="0.5"
                class="w-28"
                @blur="saveMin(c.id)"
                @keyup.enter="saveMin(c.id)"
              />
            </UFormField>
            <UFormField :label="t('resourcePlanning.minWeeklyAssignee')">
              <div class="space-y-1.5">
                <!-- Weighted assignees (native selects avoid the Popper crash). -->
                <div
                  v-for="(a, idx) in minAssigneesDraft[c.id] ?? []"
                  :key="idx"
                  class="flex items-center gap-1.5"
                >
                  <select
                    v-model="a.clockodo_user_id"
                    class="w-40 rounded-md border border-default bg-default text-default px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    @change="saveMin(c.id)"
                  >
                    <option
                      v-for="o in personOptions"
                      :key="o.value"
                      :value="o.value"
                    >
                      {{ o.label }}
                    </option>
                  </select>
                  <template v-if="(minAssigneesDraft[c.id]?.length ?? 0) > 1">
                    <UInput
                      v-model.number="a.share"
                      type="number"
                      min="0"
                      max="100"
                      step="5"
                      class="w-20"
                      :aria-label="t('resourcePlanning.share')"
                      @blur="rebalanceMin(c.id, idx)"
                      @keyup.enter="rebalanceMin(c.id, idx)"
                    />
                    <span class="text-xs text-muted">%</span>
                  </template>
                  <UButton
                    icon="lucide:x"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    @click="removeMinAssignee(c.id, idx)"
                  />
                </div>
                <UButton
                  icon="lucide:plus"
                  variant="soft"
                  size="xs"
                  @click="addMinAssignee(c.id)"
                >
                  {{ t('resourcePlanning.addPerson') }}
                </UButton>
              </div>
            </UFormField>
          </div>

          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium">{{
              t('resourcePlanning.phases')
            }}</span>
            <UButton
              icon="lucide:plus"
              variant="soft"
              size="xs"
              @click="openAddPhase(c.id)"
            >
              {{ t('resourcePlanning.addPhase') }}
            </UButton>
          </div>

          <p
            v-if="!budgetByClient.get(c.id)?.phases?.length"
            class="text-xs text-muted"
          >
            {{ t('resourcePlanning.noPhases') }}
          </p>
          <ul v-else class="divide-y">
            <li
              v-for="p in budgetByClient.get(c.id)?.phases ?? []"
              :key="p.id"
              class="py-2 flex items-center justify-between gap-3"
            >
              <div class="min-w-0">
                <p class="text-sm truncate">
                  {{ p.name || t('resourcePlanning.unnamedPhase') }}
                  <span class="text-muted">
                    ·
                    {{
                      weekSpan(p.from, p.to) > 0
                        ? Math.round((p.hours / weekSpan(p.from, p.to)) * 10) /
                          10
                        : p.hours
                    }}
                    {{ t('resourcePlanning.hoursPerWeekShort') }} ·
                    {{ p.hours }} h
                  </span>
                </p>
                <p class="text-xs text-muted">
                  {{ isoToDe(p.from) }} → {{ isoToDe(p.to) }}
                  <template
                    v-if="assigneesLabel(p.assignees, p.clockodo_user_id)"
                  >
                    ·
                    <UIcon
                      name="lucide:users"
                      class="inline align-text-bottom"
                    />
                    {{ assigneesLabel(p.assignees, p.clockodo_user_id) }}
                  </template>
                </p>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <UButton
                  icon="lucide:pencil"
                  variant="ghost"
                  size="xs"
                  :aria-label="t('resourcePlanning.edit')"
                  @click="openEditPhase(c.id, p)"
                />
                <UButton
                  icon="lucide:trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  :aria-label="t('resourcePlanning.delete')"
                  @click="removePhase(p)"
                />
              </div>
            </li>
          </ul>
        </UPageCard>
      </div>

      <!-- Add / edit phase modal -->
      <UModal
        v-model:open="phaseModalOpen"
        :title="t('resourcePlanning.phase')"
      >
        <template #body>
          <div class="space-y-4">
            <UFormField :label="t('resourcePlanning.phaseName')">
              <UInput
                v-model="phaseForm.name"
                :placeholder="t('resourcePlanning.phaseNamePlaceholder')"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="t('resourcePlanning.dateRange')">
              <ResourcePlanningDateRange
                :from="phaseForm.from"
                :to="phaseForm.to"
                @update:from="(v: string) => (phaseForm.from = v)"
                @update:to="(v: string) => (phaseForm.to = v)"
              />
            </UFormField>
            <UFormField
              :label="t('resourcePlanning.hoursPerWeek')"
              :help="
                phaseWeeks > 0
                  ? t('resourcePlanning.phaseTotalHint', {
                      weeks: phaseWeeks,
                      total: Math.round(phaseTotal * 10) / 10
                    })
                  : undefined
              "
            >
              <UInput
                v-model.number="phaseForm.perWeek"
                type="number"
                min="0"
                step="0.5"
                class="w-full"
              />
            </UFormField>
            <UFormField
              :label="t('resourcePlanning.assignees')"
              :help="t('resourcePlanning.assigneesHelp')"
            >
              <div class="space-y-1.5">
                <div
                  v-for="(a, idx) in phaseForm.assignees"
                  :key="idx"
                  class="flex items-center gap-1.5"
                >
                  <select
                    v-model="a.clockodo_user_id"
                    class="flex-1 rounded-md border border-default bg-default text-default px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option
                      v-for="o in personOptions"
                      :key="o.value"
                      :value="o.value"
                    >
                      {{ o.label }}
                    </option>
                  </select>
                  <template v-if="phaseForm.assignees.length > 1">
                    <UInput
                      v-model.number="a.share"
                      type="number"
                      min="0"
                      max="100"
                      step="5"
                      class="w-20"
                      :aria-label="t('resourcePlanning.share')"
                      @blur="rebalanceShares(phaseForm.assignees, idx)"
                      @keyup.enter="rebalanceShares(phaseForm.assignees, idx)"
                    />
                    <span class="text-xs text-muted">%</span>
                  </template>
                  <UButton
                    icon="lucide:x"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    @click="removePhaseAssignee(idx)"
                  />
                </div>
                <UButton
                  icon="lucide:plus"
                  variant="soft"
                  size="xs"
                  @click="addPhaseAssignee"
                >
                  {{ t('resourcePlanning.addPerson') }}
                </UButton>
                <p class="text-xs text-muted">
                  {{ t('resourcePlanning.assigneesHint') }}
                </p>
              </div>
            </UFormField>
          </div>
        </template>
        <template #footer>
          <div class="flex justify-end gap-2 w-full">
            <UButton
              color="neutral"
              variant="ghost"
              @click="phaseModalOpen = false"
            >
              {{ t('common.cancel') }}
            </UButton>
            <UButton
              :loading="savingPhase"
              :disabled="!phaseValid"
              @click="savePhase"
            >
              {{ t('common.save') }}
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </div>
</template>
