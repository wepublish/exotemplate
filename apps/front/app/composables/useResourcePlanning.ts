import type { Ref } from 'vue'

export interface PlanBaseItem {
  name: string
  hours: number
}
export interface PlanIntensiveItem {
  name: string
  phase: string | null
  hours: number
}
export interface PlanWeek {
  week: string
  capacity: number
  planned: number
  /** Evenly-spread (non-phase) general load. */
  base: number
  /** General intensive-phase load, stacked on top of base. */
  intensive: number
  /** Direct (person-assigned) work — phases/minimums tied to a person. */
  direct: number
  /** Project-equivalent hours lost to vacation this week. */
  vacation: number
  /** Number of included employees fully on vacation this week. */
  vacationCount: number
  /** Project-equivalent hours lost to public holidays this week. */
  holiday: number
  /** Public-holiday names reducing capacity this week. */
  holidays: string[]
  /** Company closure (Betriebsferien): nobody works this week. */
  closed: boolean
  /** Name of the closure covering this week, if any. */
  closureName: string | null
  ratio: number | null
  overloaded: boolean
  breakdown: {
    base: PlanBaseItem[]
    intensive: PlanIntensiveItem[]
    direct: PlanBaseItem[]
    /** Employees with absence this week + their hours. */
    vacation: PlanBaseItem[]
  }
}
export interface PlanEmployee {
  id: number
  name: string
  excluded: boolean
  /** Share of capacity spent on client-project work (0–100). */
  projectPct: number
  /** Net capacity available for general (unassigned) project work. */
  weekly: number[]
  /** Gross project capacity before direct commitments (weekly + directWeekly). */
  grossWeekly: number[]
  /** Would-be capacity on Betriebsferien weeks (0 on open weeks) — for sizing the black block. */
  closedCapacityWeekly: number[]
  /** Hours dedicated directly to this person (person phases + assigned minimums). */
  directWeekly: number[]
  /** This person's proportional share of the general project load. */
  generalWeekly: number[]
  /** Project-equivalent hours lost to vacation, per week. */
  vacationWeekly: number[]
  /** Project-equivalent hours lost to public holidays, per week. */
  holidayHoursWeekly: number[]
  /** True on weeks the person is fully off (vacation/holiday). */
  offWeekly: boolean[]
  /** Public-holiday names per week affecting this person. */
  holidayWeekly: string[][]
  /** Recurring default-load tasks (name + weekly hours) reserving capacity. */
  defaultLoadItems: PlanBaseItem[]
}
export interface PlanProject {
  clientId: string | null
  clientName: string
  annualBudget: number
  derived: boolean
  weekly: number[]
  baseWeekly: number[]
  intensiveWeekly: number[]
  /** Person-assigned phase load for this project (direct commitments). */
  directWeekly: number[]
  /** Current billing remaining (active/future periods) or null if none. */
  availableHours: number | null
}
export interface PlanOverview {
  weeks: string[]
  team: PlanWeek[]
  employees: PlanEmployee[]
  projects: PlanProject[]
}

/**
 * Loads the weekly resource-planning overview (admin). Lazy — the page renders
 * immediately and fills in. Reuses the backend's cached Clockodo capacity.
 */
export async function useResourcePlanning(
  from: Ref<string>,
  to: Ref<string>,
  key = 'resource-planning'
) {
  const { getCustomEndpoint } = useDirectus()
  const { $i18n } = useNuxtApp()

  const { data, pending, error, refresh } = await useAsyncData(
    key,
    async () => {
      try {
        const res = await getCustomEndpoint('resource-planning/overview', {
          from: from.value,
          to: to.value
        })
        return res.data as { data: PlanOverview; excludedCount: number }
      } catch (err: any) {
        const first = err.response?.data?.errors?.[0]
        throw new Error(
          first?.message || err?.message || $i18n.t('common.unexpectedError')
        )
      }
    },
    { lazy: true, watch: [from, to] }
  )

  const overview = computed<PlanOverview | undefined>(() => data.value?.data)
  const excludedCount = computed<number>(() => data.value?.excludedCount ?? 0)
  return { overview, excludedCount, pending, error, refresh }
}
