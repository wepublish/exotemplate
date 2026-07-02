<script lang="ts" setup>
  import type { PlanEmployee } from '~/composables/useResourcePlanning'
  import type {
    CompanyClosure,
    ResourcePlanDefaultLoad
  } from '~~/types/DirectusTypes'

  const userStore = useUserStore()
  const { t } = useI18n()
  const toast = useToast()

  const isAdmin = userStore.amIAdministrator()

  // Capacity is year-specific; the employee roster + their settings are not.
  // We load the current year purely to get names + current excluded/other-work
  // values from the same source the overview chart uses.
  const currentYear = new Date().getUTCFullYear()
  const from = ref(`${currentYear}-01-01`)
  const to = ref(`${currentYear}-12-31`)

  const planning = isAdmin
    ? await useResourcePlanning(from, to, 'rp-employees')
    : null
  const admin = useResourcePlanningAdmin()
  const { saveEmployeeSettings } = admin

  // ── Betriebsferien (company closures) ──────────────────────────────────────
  const closures = ref<CompanyClosure[]>([])
  const newClosure = reactive({ name: '', from: '', to: '' })
  const savingClosure = ref(false)

  const isoToDe = (iso: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
    const [y, m, d] = iso.split('-')
    return `${d}.${m}.${y}`
  }

  async function loadClosures(): Promise<void> {
    if (!isAdmin) return
    try {
      closures.value = await admin.listClosures()
    } catch {
      /* ignore */
    }
  }
  onMounted(loadClosures)

  async function addClosure(): Promise<void> {
    const { from, to } = newClosure
    if (!from || !to || from > to) {
      toast.add({ title: t('resourcePlanning.closureInvalid'), color: 'error' })
      return
    }
    savingClosure.value = true
    try {
      await admin.createClosure({
        name: newClosure.name.trim() || null,
        from,
        to
      })
      newClosure.name = ''
      newClosure.from = ''
      newClosure.to = ''
      await loadClosures()
      await planning?.refresh()
      toast.add({ title: t('resourcePlanning.saved'), color: 'success' })
    } catch (err: any) {
      toast.add({
        title: t('resourcePlanning.saveError'),
        description: err?.message,
        color: 'error'
      })
    } finally {
      savingClosure.value = false
    }
  }

  async function removeClosure(c: CompanyClosure): Promise<void> {
    if (!confirm(t('resourcePlanning.confirmDeleteClosure'))) return
    try {
      await admin.deleteClosure(c.id)
      await loadClosures()
      await planning?.refresh()
    } catch (err: any) {
      toast.add({
        title: t('resourcePlanning.saveError'),
        description: err?.message,
        color: 'error'
      })
    }
  }

  const pending = computed<boolean>(() => !!planning?.pending.value)
  const error = computed<Error | null>(
    () => (planning?.error.value as Error | null) ?? null
  )
  const employees = computed<PlanEmployee[]>(
    () => planning?.overview.value?.employees ?? []
  )
  // Included first, excluded (deactivated) pinned to the bottom; alphabetical
  // within each group.
  const sortedEmployees = computed<PlanEmployee[]>(() =>
    [...employees.value].sort((a, b) => {
      if (a.excluded !== b.excluded) return a.excluded ? 1 : -1
      return a.name.localeCompare(b.name)
    })
  )

  // Local edit buffer for the project-% input, keyed by employee id, so typing
  // doesn't fight the async refresh.
  const pctDraft = reactive<Record<number, number>>({})
  const savingId = ref<number | null>(null)

  // ── Per-person default loads (recurring internal tasks) ────────────────────
  const defaultLoads = ref<ResourcePlanDefaultLoad[]>([])
  const expandedLoads = ref<number | null>(null)
  const newLoad = reactive<Record<number, { name: string; hours: number }>>({})
  const loadsByUser = computed(() => {
    const m = new Map<number, ResourcePlanDefaultLoad[]>()
    for (const dl of defaultLoads.value) {
      const uid = Number(dl.clockodo_user_id)
      const arr = m.get(uid) ?? []
      arr.push(dl)
      m.set(uid, arr)
    }
    return m
  })
  const loadTotal = (uid: number): number =>
    (loadsByUser.value.get(uid) ?? []).reduce(
      (s, d) => s + (d.weekly_hours || 0),
      0
    )

  async function loadDefaultLoads(): Promise<void> {
    if (!isAdmin) return
    try {
      defaultLoads.value = await admin.listDefaultLoads()
    } catch {
      /* ignore */
    }
  }
  onMounted(loadDefaultLoads)

  function toggleLoads(id: number): void {
    expandedLoads.value = expandedLoads.value === id ? null : id
    if (!newLoad[id]) newLoad[id] = { name: '', hours: 0 }
  }

  async function addDefaultLoad(e: PlanEmployee): Promise<void> {
    const draft = newLoad[e.id]
    if (!draft || !draft.name.trim() || draft.hours <= 0) return
    try {
      await admin.createDefaultLoad({
        clockodo_user_id: String(e.id),
        name: draft.name.trim(),
        weekly_hours: Number(draft.hours)
      })
      newLoad[e.id] = { name: '', hours: 0 }
      await loadDefaultLoads()
      await planning?.refresh()
      toast.add({ title: t('resourcePlanning.saved'), color: 'success' })
    } catch (err: any) {
      toast.add({
        title: t('resourcePlanning.saveError'),
        description: err?.message,
        color: 'error'
      })
    }
  }

  async function removeDefaultLoad(id: number): Promise<void> {
    try {
      await admin.deleteDefaultLoad(id)
      await loadDefaultLoads()
      await planning?.refresh()
    } catch (err: any) {
      toast.add({
        title: t('resourcePlanning.saveError'),
        description: err?.message,
        color: 'error'
      })
    }
  }

  watch(
    employees,
    (list) => {
      for (const e of list) {
        if (pctDraft[e.id] === undefined) pctDraft[e.id] = e.projectPct
      }
    },
    { immediate: true }
  )

  async function setIncluded(
    e: PlanEmployee,
    included: boolean
  ): Promise<void> {
    savingId.value = e.id
    // Deactivating a person zeroes their project %; reactivating restores the
    // 70% default.
    const project_hours_percentage = included ? 70 : 0
    pctDraft[e.id] = project_hours_percentage
    try {
      await saveEmployeeSettings(String(e.id), {
        excluded: !included,
        project_hours_percentage
      })
      await planning?.refresh()
      toast.add({ title: t('resourcePlanning.saved'), color: 'success' })
    } catch (err: any) {
      toast.add({
        title: t('resourcePlanning.saveError'),
        description: err?.message,
        color: 'error'
      })
    } finally {
      savingId.value = null
    }
  }

  async function savePct(e: PlanEmployee): Promise<void> {
    const pct = Math.min(100, Math.max(0, Number(pctDraft[e.id]) || 0))
    pctDraft[e.id] = pct
    savingId.value = e.id
    try {
      await saveEmployeeSettings(String(e.id), {
        project_hours_percentage: pct
      })
      await planning?.refresh()
      toast.add({ title: t('resourcePlanning.saved'), color: 'success' })
    } catch (err: any) {
      toast.add({
        title: t('resourcePlanning.saveError'),
        description: err?.message,
        color: 'error'
      })
    } finally {
      savingId.value = null
    }
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
      <div class="mb-4">
        <h1 class="text-2xl font-bold">{{ t('resourcePlanning.title') }}</h1>
        <p class="text-muted text-sm">
          {{ t('resourcePlanning.employeesIntro') }}
        </p>
      </div>

      <ResourcePlanningTabs active="employees" />

      <!-- Betriebsferien: company-wide closure weeks -->
      <UPageCard class="mb-4">
        <template #header>
          <span class="font-semibold">{{
            t('resourcePlanning.closures')
          }}</span>
        </template>
        <p class="text-xs text-muted mb-3">
          {{ t('resourcePlanning.closuresIntro') }}
        </p>
        <ul v-if="closures.length" class="divide-y mb-3">
          <li
            v-for="c in closures"
            :key="c.id"
            class="py-2 flex items-center justify-between gap-3"
          >
            <span class="text-sm">
              <span class="font-medium">{{
                c.name || t('resourcePlanning.closure')
              }}</span>
              <span class="text-muted">
                · {{ isoToDe(c.from) }} → {{ isoToDe(c.to) }}</span
              >
            </span>
            <UButton
              icon="lucide:trash-2"
              color="error"
              variant="ghost"
              size="xs"
              :aria-label="t('resourcePlanning.delete')"
              @click="removeClosure(c)"
            />
          </li>
        </ul>
        <div class="flex flex-wrap items-end gap-3">
          <UFormField :label="t('resourcePlanning.closureName')">
            <UInput
              v-model="newClosure.name"
              :placeholder="t('resourcePlanning.closureNamePlaceholder')"
              class="w-48"
            />
          </UFormField>
          <UFormField :label="t('resourcePlanning.dateRange')">
            <ResourcePlanningDateRange
              :from="newClosure.from"
              :to="newClosure.to"
              @update:from="(v: string) => (newClosure.from = v)"
              @update:to="(v: string) => (newClosure.to = v)"
            />
          </UFormField>
          <UButton
            icon="lucide:plus"
            :loading="savingClosure"
            @click="addClosure"
          >
            {{ t('resourcePlanning.add') }}
          </UButton>
        </div>
      </UPageCard>

      <USkeleton v-if="pending" class="h-72" />

      <UAlert
        v-else-if="error"
        color="error"
        variant="soft"
        icon="lucide:triangle-alert"
        :title="t('resourcePlanning.loadError')"
        :description="error.message"
      />

      <UPageCard v-else>
        <ul class="divide-y">
          <li
            v-for="e in sortedEmployees"
            :key="e.id"
            class="py-3 first:pt-0"
            :class="{ 'opacity-50': e.excluded }"
          >
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div class="min-w-0">
                <p class="font-medium truncate">{{ e.name }}</p>
                <p class="text-xs text-muted">
                  {{
                    e.excluded
                      ? t('resourcePlanning.excluded')
                      : t('resourcePlanning.included')
                  }}
                </p>
              </div>
              <div class="flex items-center gap-4 shrink-0">
                <UButton
                  :icon="
                    expandedLoads === e.id
                      ? 'lucide:chevron-up'
                      : 'lucide:list-todo'
                  "
                  color="neutral"
                  variant="soft"
                  size="xs"
                  @click="toggleLoads(e.id)"
                >
                  {{ t('resourcePlanning.defaultLoads') }}
                  <span v-if="loadTotal(e.id) > 0" class="tabular-nums">
                    ({{ Math.round(loadTotal(e.id) * 10) / 10 }} h)
                  </span>
                </UButton>
                <div class="flex items-center gap-1">
                  <UInput
                    v-model.number="pctDraft[e.id]"
                    type="number"
                    min="0"
                    max="100"
                    step="5"
                    class="w-20"
                    :disabled="savingId === e.id"
                    @blur="savePct(e)"
                    @keyup.enter="savePct(e)"
                  />
                  <span class="text-xs text-muted whitespace-nowrap">
                    {{ t('resourcePlanning.projectPctShort') }}
                  </span>
                </div>
                <USwitch
                  :model-value="!e.excluded"
                  :loading="savingId === e.id"
                  :label="t('resourcePlanning.includeInTotal')"
                  @update:model-value="(v: boolean) => setIncluded(e, v)"
                />
              </div>
            </div>

            <!-- Default loads (recurring internal tasks) -->
            <div v-if="expandedLoads === e.id" class="mt-3 ps-1">
              <p class="text-xs text-muted mb-2">
                {{ t('resourcePlanning.defaultLoadsIntro') }}
              </p>
              <ul
                v-if="(loadsByUser.get(e.id) ?? []).length"
                class="divide-y mb-2"
              >
                <li
                  v-for="dl in loadsByUser.get(e.id) ?? []"
                  :key="dl.id"
                  class="py-1.5 flex items-center justify-between gap-3 text-sm"
                >
                  <span class="truncate">
                    {{ dl.name || '—' }}
                    <span class="text-muted tabular-nums">
                      · {{ dl.weekly_hours }} h/{{
                        t('resourcePlanning.week')
                      }}</span
                    >
                  </span>
                  <UButton
                    icon="lucide:trash-2"
                    color="error"
                    variant="ghost"
                    size="xs"
                    :aria-label="t('resourcePlanning.delete')"
                    @click="removeDefaultLoad(dl.id)"
                  />
                </li>
              </ul>
              <div v-if="newLoad[e.id]" class="flex flex-wrap items-end gap-2">
                <UFormField :label="t('resourcePlanning.taskName')">
                  <UInput
                    v-model="newLoad[e.id]!.name"
                    :placeholder="t('resourcePlanning.taskNamePlaceholder')"
                    class="w-48"
                  />
                </UFormField>
                <UFormField :label="t('resourcePlanning.hoursPerWeek')">
                  <UInput
                    v-model.number="newLoad[e.id]!.hours"
                    type="number"
                    min="0"
                    step="0.5"
                    class="w-24"
                  />
                </UFormField>
                <UButton
                  icon="lucide:plus"
                  size="sm"
                  :disabled="
                    !newLoad[e.id]!.name.trim() || newLoad[e.id]!.hours <= 0
                  "
                  @click="addDefaultLoad(e)"
                >
                  {{ t('resourcePlanning.add') }}
                </UButton>
              </div>
            </div>
          </li>
        </ul>
      </UPageCard>
    </template>
  </div>
</template>
