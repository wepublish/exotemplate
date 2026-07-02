import { createItem, deleteItem, readItems, updateItem } from '@directus/sdk'
import type {
  CompanyClosure,
  IntensivePhase,
  ProjectBudget,
  ResourcePlanDefaultLoad,
  ResourcePlanEmployee
} from '~~/types/DirectusTypes'

/**
 * Admin CRUD for the resource-planning assistant's editable inputs: per-employee
 * include/exclude + other-work settings (`ResourcePlanEmployees`), annual project
 * budgets (`ProjectBudgets`), and their intensive phases (`IntensivePhases`).
 * All writes go through the Directus SDK, gated by admin_access.
 */
export function useResourcePlanningAdmin() {
  const { directus } = useDirectus()

  // ── Per-employee settings ────────────────────────────────────────────────

  async function listEmployeeSettings(): Promise<ResourcePlanEmployee[]> {
    return directus.request<ResourcePlanEmployee[]>(
      readItems('ResourcePlanEmployees', { limit: -1 })
    )
  }

  /**
   * Upsert the settings row for one Clockodo user. Rows are keyed by
   * `clockodo_user_id`; there is at most one per user.
   */
  async function saveEmployeeSettings(
    clockodoUserId: string,
    patch: { excluded?: boolean; project_hours_percentage?: number }
  ): Promise<void> {
    const existing = await directus.request<ResourcePlanEmployee[]>(
      readItems('ResourcePlanEmployees', {
        filter: { clockodo_user_id: { _eq: clockodoUserId } },
        limit: 1
      })
    )
    if (existing[0]) {
      await directus.request(
        updateItem('ResourcePlanEmployees', existing[0].id, patch)
      )
    } else {
      await directus.request(
        createItem('ResourcePlanEmployees', {
          clockodo_user_id: clockodoUserId,
          excluded: false,
          project_hours_percentage: 70,
          ...patch
        })
      )
    }
  }

  // ── Project budgets + intensive phases ─────────────────────────────────────

  async function listBudgets(year: number): Promise<ProjectBudget[]> {
    return directus.request<ProjectBudget[]>(
      readItems('ProjectBudgets', {
        filter: { year: { _eq: year } },
        fields: [
          'id',
          'year',
          'annual_budget_hours',
          'min_weekly_hours',
          'min_weekly_clockodo_user_id',
          'min_assignees.id',
          'min_assignees.clockodo_user_id',
          'min_assignees.share',
          'client',
          'phases.id',
          'phases.name',
          'phases.from',
          'phases.to',
          'phases.hours',
          'phases.clockodo_user_id',
          'phases.assignees.id',
          'phases.assignees.clockodo_user_id',
          'phases.assignees.share'
        ] as any,
        limit: -1
      })
    )
  }

  async function createBudget(input: {
    client: string
    year: number
    annual_budget_hours: number
  }): Promise<ProjectBudget> {
    return directus.request<ProjectBudget>(
      createItem('ProjectBudgets', input as any)
    )
  }

  async function updateBudget(
    id: number,
    patch: Partial<
      Pick<
        ProjectBudget,
        | 'annual_budget_hours'
        | 'min_weekly_hours'
        | 'min_weekly_clockodo_user_id'
      >
    >
  ): Promise<void> {
    await directus.request(updateItem('ProjectBudgets', id, patch as any))
  }

  async function deleteBudget(id: number): Promise<void> {
    await directus.request(deleteItem('ProjectBudgets', id))
  }

  async function createPhase(input: {
    project_budget: number
    name?: string | null
    from: string
    to: string
    hours: number
    clockodo_user_id?: string | null
  }): Promise<IntensivePhase> {
    return directus.request<IntensivePhase>(
      createItem('IntensivePhases', input as any)
    )
  }

  async function updatePhase(
    id: number,
    patch: Partial<
      Pick<
        IntensivePhase,
        'name' | 'from' | 'to' | 'hours' | 'clockodo_user_id'
      >
    >
  ): Promise<void> {
    await directus.request(updateItem('IntensivePhases', id, patch as any))
  }

  async function deletePhase(id: number): Promise<void> {
    await directus.request(deleteItem('IntensivePhases', id))
  }

  // ── Company closures (Betriebsferien) ──────────────────────────────────────

  async function listClosures(): Promise<CompanyClosure[]> {
    return directus.request<CompanyClosure[]>(
      readItems('CompanyClosures', { sort: ['from'], limit: -1 })
    )
  }

  async function createClosure(input: {
    name?: string | null
    from: string
    to: string
  }): Promise<CompanyClosure> {
    return directus.request<CompanyClosure>(
      createItem('CompanyClosures', input as any)
    )
  }

  async function deleteClosure(id: number): Promise<void> {
    await directus.request(deleteItem('CompanyClosures', id))
  }

  // ── Per-person default loads (recurring internal tasks) ────────────────────

  async function listDefaultLoads(): Promise<ResourcePlanDefaultLoad[]> {
    return directus.request<ResourcePlanDefaultLoad[]>(
      readItems('ResourcePlanDefaultLoads', { limit: -1 })
    )
  }

  async function createDefaultLoad(input: {
    clockodo_user_id: string
    name: string
    weekly_hours: number
  }): Promise<ResourcePlanDefaultLoad> {
    return directus.request<ResourcePlanDefaultLoad>(
      createItem('ResourcePlanDefaultLoads', input as any)
    )
  }

  async function deleteDefaultLoad(id: number): Promise<void> {
    await directus.request(deleteItem('ResourcePlanDefaultLoads', id))
  }

  // ── Weighted assignees (phase + minimum) ───────────────────────────────────
  // Reconcile: replace the child rows with the given list.
  async function setAssignees(
    collection: 'IntensivePhaseAssignees' | 'MinLoadAssignees',
    parentField: 'phase' | 'project_budget',
    parentId: number,
    list: { clockodo_user_id: string; share: number }[]
  ): Promise<void> {
    const existing = await directus.request<{ id: number }[]>(
      readItems(collection as any, {
        filter: { [parentField]: { _eq: parentId } } as any,
        fields: ['id'],
        limit: -1
      })
    )
    for (const e of existing) {
      await directus.request(deleteItem(collection as any, e.id))
    }
    for (const a of list) {
      if (!a.clockodo_user_id) continue
      await directus.request(
        createItem(
          collection as any,
          {
            [parentField]: parentId,
            clockodo_user_id: a.clockodo_user_id,
            share: Math.max(0, a.share) || 0
          } as any
        )
      )
    }
  }

  const setPhaseAssignees = (
    phaseId: number,
    list: { clockodo_user_id: string; share: number }[]
  ) => setAssignees('IntensivePhaseAssignees', 'phase', phaseId, list)

  const setMinAssignees = (
    budgetId: number,
    list: { clockodo_user_id: string; share: number }[]
  ) => setAssignees('MinLoadAssignees', 'project_budget', budgetId, list)

  return {
    listEmployeeSettings,
    saveEmployeeSettings,
    listBudgets,
    createBudget,
    updateBudget,
    deleteBudget,
    createPhase,
    updatePhase,
    deletePhase,
    listClosures,
    createClosure,
    deleteClosure,
    listDefaultLoads,
    createDefaultLoad,
    deleteDefaultLoad,
    setPhaseAssignees,
    setMinAssignees
  }
}
