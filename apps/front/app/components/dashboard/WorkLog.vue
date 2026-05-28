<script lang="ts" setup>
  import type { BreadcrumbItem, TableColumn } from '@nuxt/ui'
  import type { DirectusUser } from '@directus/sdk'
  import type {
    EntryGroup,
    EntryGroupComputed
  } from '../../../types/ClockodoTypes'
  import type { JiraWarning, Schema } from '~~/types/DirectusTypes'
  import type { WarningAction } from '~/components/warnings/WarningActions.vue'

  const props = defineProps<{
    entryGroups: EntryGroupComputed | undefined
    haltedIssueKeys?: Set<string>
    warningsByIssueKey?: Map<string, JiraWarning>
    clientId?: string
    pendingActionFor?: (warning: JiraWarning) => WarningAction | null
    /**
     * When set, the Arbeitsprotokoll drills into the parent group that
     * contains this Jira issue and scrolls / highlights the row. Used to
     * deep-link from a Slack notification straight to the issue's billing
     * breakdown.
     */
    focusIssueKey?: string
  }>()

  const emit = defineEmits<{
    dispatchWarningAction: [warning: JiraWarning, action: WarningAction]
  }>()

  const { secondsToHours } = useHours()
  const { nextThresholdHours, lastNotifiedHours, isHalted } = useJiraWarnings()

  const dateFormatter = new Intl.DateTimeFormat('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

  function formatDate(value: string | null | undefined): string | null {
    if (!value) return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return dateFormatter.format(date)
  }

  function formatUser(
    user: string | DirectusUser<Schema> | null | undefined
  ): string | null {
    if (!user || typeof user === 'string') return null
    const name = [user.first_name, user.last_name]
      .filter((part): part is string => !!part)
      .join(' ')
      .trim()
    return name || user.email || null
  }

  /**
   * A warning is rendered as "resolved" once Jira flips the issue into the
   * `done` status category (Done, Cancelled, Resolved, Closed …). The flag
   * is purely derived from the live Jira data we already pull into each
   * row — when the issue is reopened, the row goes back to its previous
   * (orange) warning state on the next refresh, no DB write required.
   */
  function isIssueResolved(row: { jiraIssue?: { fields?: unknown } }): boolean {
    const fields = row.jiraIssue?.fields as
      | { status?: { statusCategory?: { key?: string } } }
      | undefined
    return fields?.status?.statusCategory?.key === 'done'
  }

  function warningStatusBadge(
    warning: JiraWarning,
    resolved: boolean
  ): {
    color: 'error' | 'neutral' | 'primary' | 'warning' | 'success'
    label: string
    icon?: string
  } {
    if (resolved)
      return {
        color: 'success',
        label: 'Erledigt',
        icon: 'material-symbols:check-circle-rounded'
      }
    if (isHalted(warning)) return { color: 'error', label: 'Arbeitsstopp' }
    if (warning.silenced_permanently)
      return { color: 'neutral', label: 'Stummgeschaltet' }
    return { color: 'warning', label: 'Warnung' }
  }

  function nextThresholdForRow(row: { name?: string | null }): number | null {
    const warning = warningForRow(row)
    return warning ? nextThresholdHours(warning) : null
  }

  function isHaltedName(name: string | undefined | null): boolean {
    if (!name || !props.haltedIssueKeys) return false
    return props.haltedIssueKeys.has(name)
  }

  function haltedIssueKeyForRow(row: {
    name?: string | null
    sub_groups?: { name?: string | null }[]
  }): string | null {
    if (isHaltedName(row.name)) return row.name ?? null
    const sub = row.sub_groups?.find((s) => isHaltedName(s.name))
    return sub?.name ?? null
  }

  /**
   * The Arbeitsprotokoll shows one row per work group; when a row represents a
   * Jira ticket the matching JiraWarning is surfaced here so the client can
   * request a halt or silence the ticket without leaving the dashboard.
   */
  function warningForRow(row: {
    name?: string | null
  }): JiraWarning | undefined {
    if (!row.name || !props.warningsByIssueKey) return undefined
    return props.warningsByIssueKey.get(row.name)
  }

  function pendingActionForRow(warning: JiraWarning): WarningAction | null {
    return props.pendingActionFor ? props.pendingActionFor(warning) : null
  }

  const haltedCount = computed<number>(() => props.haltedIssueKeys?.size ?? 0)

  type RowNode = {
    name?: string | null
    jiraIssue?: { fields?: { status?: { statusCategory?: { key?: string } } } }
    sub_groups?: RowNode[]
  }

  function isResolvedNode(node: RowNode): boolean {
    return node.jiraIssue?.fields?.status?.statusCategory?.key === 'done'
  }

  /**
   * Walks the row's tree and counts every Jira issue that has a matching
   * JiraWarning. The `predicate` decides whether each node should be
   * counted, which lets us split the total into "still open" (orange) and
   * "Erledigt" (green) without traversing twice.
   */
  function countWarningsInRow(
    row: RowNode,
    predicate: (node: RowNode) => boolean
  ): number {
    const map = props.warningsByIssueKey
    if (!map || map.size === 0) return 0
    let count = 0
    if (row.name && map.has(row.name) && predicate(row)) count += 1
    for (const sub of row.sub_groups ?? [])
      count += countWarningsInRow(sub, predicate)
    return count
  }

  function unresolvedWarningCountForRow(row: RowNode): number {
    return countWarningsInRow(row, (node) => !isResolvedNode(node))
  }

  function resolvedWarningCountForRow(row: RowNode): number {
    return countWarningsInRow(row, isResolvedNode)
  }

  const entryGroupNavigation = ref<EntryGroup[]>([])

  const columns: TableColumn<EntryGroup>[] = [
    {
      accessorKey: 'name',
      header: 'Arbeit',
      meta: {
        style: {
          td: 'max-width: 340px;'
        }
      }
    },
    {
      accessorKey: 'jiraIssue',
      header: 'Details Abrechenbarkeit'
    },
    {
      accessorKey: 'duration',
      header: 'Verrechenbare Zeit'
    },
    {
      id: 'expand',
      header: 'Details'
    }
  ]

  const selectedEntryGroup = computed<EntryGroup | undefined>(() =>
    entryGroupNavigation.value.at(-1)
  )

  const breadCrums = computed<BreadcrumbItem[]>(() =>
    entryGroupNavigation.value?.map((eg) => ({
      label: eg.name
    }))
  )

  function navigateEntryGroup(entryGroup: EntryGroup | undefined): void {
    if (!entryGroup || !entryGroup.sub_groups?.length) {
      // reset navigation
      entryGroupNavigation.value = []
    } else {
      entryGroupNavigation.value.push(entryGroup)
    }
  }

  /**
   * Find the parent group that contains a sub_group whose name matches the
   * given Jira issue key, so we can drill into it and scroll to the row.
   */
  function findParentGroupFor(
    issueKey: string,
    groups: EntryGroup[] | undefined
  ): EntryGroup | undefined {
    if (!groups) return undefined
    for (const group of groups) {
      if (group.name === issueKey) return undefined
      if (group.sub_groups?.some((s) => s.name === issueKey)) return group
    }
    return undefined
  }

  function scrollToIssueRow(issueKey: string): void {
    nextTick(() => {
      const el = document.querySelector(`[data-issue-key="${issueKey}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  /**
   * After we drill into a focused issue we briefly flash the matching row to
   * draw the eye there. The outline stays for `OUTLINE_DURATION_MS`, the
   * background fades out via the keyframes in the scoped style block.
   */
  const FLASH_DURATION_MS = 6000
  const flashedFocusKey = ref<string | undefined>(undefined)
  let flashTimer: ReturnType<typeof setTimeout> | undefined

  function flashFocus(issueKey: string): void {
    flashedFocusKey.value = issueKey
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      flashedFocusKey.value = undefined
    }, FLASH_DURATION_MS)
  }

  onBeforeUnmount(() => {
    if (flashTimer) clearTimeout(flashTimer)
  })

  watch(
    [() => props.focusIssueKey, () => props.entryGroups],
    ([issueKey, groups]) => {
      if (!issueKey || !groups) return
      const parent = findParentGroupFor(issueKey, groups.groups)
      if (parent && !entryGroupNavigation.value.includes(parent)) {
        entryGroupNavigation.value = [parent]
      }
      scrollToIssueRow(issueKey)
      flashFocus(issueKey)
    },
    { immediate: true }
  )
</script>

<template>
  <div class="flex-1 w-full">
    <UPageCard>
      <template #default>
        <div class="flex justify-between w-full font-bold">
          <div>Arbeitsprotokoll</div>
          <div class="font-bold text-4xl text-primary">
            {{ props.entryGroups?.sums?.billableHours || 0 }} h
          </div>
        </div>

        <UAlert
          v-if="haltedCount > 0"
          color="error"
          variant="solid"
          icon="material-symbols:stop-circle-rounded"
          class="my-3"
        >
          <template #title>
            {{ haltedCount }}
            {{ haltedCount === 1 ? 'Ticket ist' : 'Tickets sind' }} gestoppt
          </template>
          <template #description>
            An rot markierten Tickets darf aktuell nicht gearbeitet werden, bis
            der Stopp direkt am Ticket aufgehoben wird.
          </template>
        </UAlert>

        <div class="w-full">
          <UBreadcrumb :items="breadCrums" />
        </div>

        <UTable
          ref="table"
          :data="selectedEntryGroup?.sub_groups || entryGroups?.groups || []"
          :columns="columns"
          sticky
        >
          <template #name-cell="row">
            <div
              class="flex items-start gap-2"
              :data-issue-key="row.row.original.name"
              :data-focus-flash="
                flashedFocusKey && row.row.original.name === flashedFocusKey
                  ? 'true'
                  : undefined
              "
            >
              <UIcon
                v-if="haltedIssueKeyForRow(row.row.original)"
                name="material-symbols:stop-circle-rounded"
                class="text-error shrink-0 mt-0.5"
                :title="`Arbeitsstopp für ${haltedIssueKeyForRow(row.row.original)}`"
              />
              <div
                class="flex-1 min-w-0"
                :class="
                  haltedIssueKeyForRow(row.row.original)
                    ? 'text-error font-semibold'
                    : undefined
                "
              >
                <p
                  v-if="
                    (row.row.original.grouped_by as unknown as string) === 'day'
                  "
                >
                  {{
                    new Date(row.row.original.name).toLocaleDateString('de', {
                      dateStyle: 'medium'
                    })
                  }}
                </p>
                <p v-else class="whitespace-normal">
                  <LinkifiedText :text="row.row.original.name" />
                </p>
                <p
                  v-if="isHaltedName(row.row.original.name)"
                  class="text-xs text-error font-medium mt-1"
                >
                  Arbeitsstopp aktiv
                </p>
                <div
                  v-else-if="
                    unresolvedWarningCountForRow(row.row.original) > 0 ||
                    resolvedWarningCountForRow(row.row.original) > 0
                  "
                  class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1"
                >
                  <p
                    v-if="unresolvedWarningCountForRow(row.row.original) > 0"
                    class="text-xs text-warning font-medium flex items-center gap-1"
                  >
                    <UIcon
                      name="i-heroicons-exclamation-triangle"
                      class="shrink-0"
                    />
                    {{ unresolvedWarningCountForRow(row.row.original) }}
                    {{
                      unresolvedWarningCountForRow(row.row.original) === 1
                        ? 'Warnung'
                        : 'Warnungen'
                    }}
                  </p>
                  <p
                    v-if="resolvedWarningCountForRow(row.row.original) > 0"
                    class="text-xs text-success font-medium flex items-center gap-1"
                  >
                    <UIcon
                      name="material-symbols:check-circle-rounded"
                      class="shrink-0"
                    />
                    {{ resolvedWarningCountForRow(row.row.original) }} erledigt
                  </p>
                </div>
              </div>
            </div>
          </template>

          <template #jiraIssue-cell="{ row }">
            <div v-if="row.original.billability" class="grid grid-cols-2">
              <!-- if jira estimation available -->
              <div class="col-span-2 grid grid-cols-2">
                <div>Jira Schätzung</div>
                <div class="text-right">
                  {{ secondsToHours(row.original.billability.durationJira) }} h
                </div>

                <div>Vor Abrechnungsperiode gleistet</div>
                <div class="text-right">
                  -
                  {{ secondsToHours(row.original.billability.durationPast) }} h
                </div>

                <div class="border-t border-b">Verfügbare Jira-Stunden</div>
                <div class="border-t border-b text-right">
                  {{ secondsToHours(row.original.billability.jiraAvailable) }} h
                </div>

                <div class="mt-4">In Abrechnungsperiode gleistet</div>
                <div class="mt-4 text-right">
                  {{ secondsToHours(row.original.billability.durationCurrent) }}
                  h
                </div>

                <div class="pl-3">Davon voll verrechenbar</div>
                <div class="text-right font-bold">
                  +
                  {{ secondsToHours(row.original.billability.billableDirect) }}
                  h
                </div>

                <div class="pl-3">Davon hälftig verrechenbar</div>
                <div class="font-bold text-right">
                  +
                  {{ secondsToHours(row.original.billability.billablePart) }} h
                </div>

                <div class="border-b pl-3">
                  Davon hälftig nicht verrechenbar
                </div>
                <div class="border-b text-right">
                  {{ secondsToHours(row.original.billability.billablePart) }} h
                </div>
              </div>

              <div class="font-bold mt-2">Total verrechenbar</div>
              <div class="font-bold text-right mt-2">
                {{ secondsToHours(row.original.billability.billableTotal) }} h
              </div>
            </div>
          </template>

          <template #duration-cell="{ row }">
            <UBadge size="lg">
              {{
                secondsToHours(
                  row.original?.billability?.billableTotal ||
                    row.original.duration
                )
              }}
              h
            </UBadge>
          </template>

          <template #expand-cell="{ row }">
            <div class="max-w-96">
              <div class="flex justify-between">
                <UButton
                  v-if="!!entryGroupNavigation.length"
                  @click="entryGroupNavigation = []"
                  class="mr-2"
                  color="neutral"
                  variant="outline"
                  >Zurück</UButton
                >
                <UButton
                  v-if="entryGroupNavigation.length < 2"
                  @click="navigateEntryGroup(row.original)"
                  variant="subtle"
                  >Details anzeigen</UButton
                >
              </div>

              <div
                v-if="warningForRow(row.original) as JiraWarning"
                class="pt-3 mt-3 border-t text-xs space-y-1.5"
              >
                <!-- Status badge + threshold info on one line. The badge uses
                     `solid` for the states the team must read at a glance
                     (Erledigt / Arbeitsstopp / Warnung) and `soft` for the
                     passive "Stummgeschaltet" state, so the eye lands on
                     informative badges the same way it does on halts. -->
                <div class="flex items-center justify-between gap-2 flex-wrap">
                  <UBadge
                    size="xs"
                    :color="
                      warningStatusBadge(
                        warningForRow(row.original)!,
                        isIssueResolved(row.original)
                      ).color
                    "
                    :variant="
                      warningForRow(row.original)!.silenced_permanently
                        ? 'soft'
                        : 'solid'
                    "
                    :icon="
                      warningStatusBadge(
                        warningForRow(row.original)!,
                        isIssueResolved(row.original)
                      ).icon
                    "
                  >
                    {{
                      warningStatusBadge(
                        warningForRow(row.original)!,
                        isIssueResolved(row.original)
                      ).label
                    }}
                  </UBadge>
                  <NuxtLink
                    to="/info/thresholds"
                    class="text-muted underline hover:no-underline"
                  >
                    Mehr erfahren
                  </NuxtLink>
                </div>

                <p
                  v-if="!warningForRow(row.original)!.silenced_permanently"
                  class="text-muted"
                >
                  Zuletzt gemeldet bei
                  <span class="font-medium">
                    {{ lastNotifiedHours(warningForRow(row.original)!) ?? '–' }}
                    h
                  </span>
                  <template v-if="nextThresholdForRow(row.original) != null">
                    · Nächste Meldung bei
                    <span class="font-medium">
                      {{ nextThresholdForRow(row.original) }} h
                    </span>
                  </template>
                </p>

                <p
                  v-if="isHalted(warningForRow(row.original)!)"
                  class="flex items-center gap-1 font-medium text-error"
                >
                  <UIcon
                    name="material-symbols:stop-circle-rounded"
                    class="shrink-0"
                  />
                  <span>
                    Gestoppt
                    <template
                      v-if="
                        formatUser(
                          warningForRow(row.original)!.halt_requested_by
                        )
                      "
                    >
                      von
                      {{
                        formatUser(
                          warningForRow(row.original)!.halt_requested_by
                        )
                      }}
                    </template>
                    <template
                      v-if="
                        formatDate(
                          warningForRow(row.original)!.halt_requested_at
                        )
                      "
                    >
                      ·
                      {{
                        formatDate(
                          warningForRow(row.original)!.halt_requested_at
                        )
                      }}
                    </template>
                  </span>
                </p>
                <p
                  v-else-if="warningForRow(row.original)!.halt_resolved_at"
                  class="flex items-center gap-1 text-muted"
                >
                  <UIcon
                    name="material-symbols:play-circle-rounded"
                    class="text-success shrink-0"
                  />
                  <span>
                    Stopp aufgehoben
                    <template
                      v-if="
                        formatUser(
                          warningForRow(row.original)!.halt_resolved_by
                        )
                      "
                    >
                      von
                      {{
                        formatUser(
                          warningForRow(row.original)!.halt_resolved_by
                        )
                      }}
                    </template>
                    <template
                      v-if="
                        formatDate(
                          warningForRow(row.original)!.halt_resolved_at
                        )
                      "
                    >
                      ·
                      {{
                        formatDate(
                          warningForRow(row.original)!.halt_resolved_at
                        )
                      }}
                    </template>
                  </span>
                </p>
                <p
                  v-if="
                    warningForRow(row.original)!.silenced_permanently &&
                    warningForRow(row.original)!.silenced_at
                  "
                  class="flex items-center gap-1 text-muted"
                >
                  <UIcon name="i-heroicons-bell-slash" class="shrink-0" />
                  <span>
                    Stummgeschaltet
                    <template
                      v-if="
                        formatUser(warningForRow(row.original)!.silenced_by)
                      "
                    >
                      von
                      {{ formatUser(warningForRow(row.original)!.silenced_by) }}
                    </template>
                    <template
                      v-if="
                        formatDate(warningForRow(row.original)!.silenced_at)
                      "
                    >
                      ·
                      {{ formatDate(warningForRow(row.original)!.silenced_at) }}
                    </template>
                  </span>
                </p>

                <WarningsWarningActions
                  class="pt-1"
                  :warning="warningForRow(row.original)!"
                  :pending-action="
                    pendingActionForRow(warningForRow(row.original)!)
                  "
                  @request-halt="
                    (w: JiraWarning) =>
                      emit('dispatchWarningAction', w, 'requestHalt')
                  "
                  @resolve-halt="
                    (w: JiraWarning) =>
                      emit('dispatchWarningAction', w, 'resolveHalt')
                  "
                  @silence="
                    (w: JiraWarning) =>
                      emit('dispatchWarningAction', w, 'silence')
                  "
                  @unsilence="
                    (w: JiraWarning) =>
                      emit('dispatchWarningAction', w, 'unsilence')
                  "
                />
              </div>
            </div>
          </template>
        </UTable>
      </template>
    </UPageCard>
  </div>
</template>

<style scoped>
  /*
   * Highlight the table row that contains a focused Jira issue. We can only
   * tag the inner cell content from Vue (UTable owns the <tr>), so we use the
   * data-attribute + :has() selector to reach the row from the outside and
   * paint outline + background. The background fades out via the keyframes
   * while the outline stays for the full flash duration.
   */
  :deep(tr:has([data-focus-flash='true'])) {
    outline: 2px solid var(--ui-primary, rgb(59 130 246));
    outline-offset: -2px;
    border-radius: 0.5rem;
    animation: focused-row-flash 6s ease-out forwards;
  }

  @keyframes focused-row-flash {
    0% {
      background-color: color-mix(
        in srgb,
        var(--ui-primary, rgb(59 130 246)) 20%,
        transparent
      );
    }
    70% {
      background-color: color-mix(
        in srgb,
        var(--ui-primary, rgb(59 130 246)) 6%,
        transparent
      );
    }
    100% {
      background-color: transparent;
    }
  }
</style>
