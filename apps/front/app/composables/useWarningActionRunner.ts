import type { DirectusUser } from '@directus/sdk'
import type { JiraWarning, Schema } from '~~/types/DirectusTypes'
import type { WarningAction } from '~/components/warnings/WarningActions.vue'

export interface WarningActionRunnerOptions {
  /**
   * Called after a successful action with the optimistic next state. The
   * consumer is responsible for persisting this into whatever ref or store
   * holds the warnings so the UI reflects the change without a full reload.
   */
  onUpdate: (updated: JiraWarning) => void
}

const ACTION_TOAST_KEYS: Record<
  WarningAction,
  { success: string; error: string }
> = {
  requestHalt: {
    success: 'workLog.toast.requestHaltSuccess',
    error: 'workLog.toast.requestHaltError'
  },
  resolveHalt: {
    success: 'workLog.toast.resolveHaltSuccess',
    error: 'workLog.toast.resolveHaltError'
  },
  silence: {
    success: 'workLog.toast.silenceSuccess',
    error: 'workLog.toast.silenceError'
  },
  unsilence: {
    success: 'workLog.toast.unsilenceSuccess',
    error: 'workLog.toast.unsilenceError'
  }
}

/**
 * Shared logic for the warning action buttons — toast feedback, per-warning
 * loading state, optimistic local updates, and the halt-confirmation dialog
 * wiring. Used by the Arbeitsprotokoll inside the main dashboard so clients
 * can halt or silence a ticket directly on the affected Jira-task row.
 */
export function useWarningActionRunner(options: WarningActionRunnerOptions) {
  const { requestHalt, resolveHalt, silence, unsilence } = useJiraWarnings()
  const userStore = useUserStore()
  const toast = useToast()
  const { $i18n } = useNuxtApp()

  const pendingWarningActions = ref<Map<string, WarningAction>>(new Map())
  const haltConfirmWarning = ref<JiraWarning | null>(null)

  function pendingActionFor(warning: JiraWarning): WarningAction | null {
    return pendingWarningActions.value.get(warning.id) ?? null
  }

  function currentUserPreview(): DirectusUser<Schema> {
    const u = userStore.user
    return {
      id: u?.id,
      first_name: (u as unknown as { first_name?: string })?.first_name ?? null,
      last_name: (u as unknown as { last_name?: string })?.last_name ?? null,
      email: (u as unknown as { email?: string })?.email ?? null
    } as unknown as DirectusUser<Schema>
  }

  async function executeAction(
    warning: JiraWarning,
    action: WarningAction
  ): Promise<void> {
    pendingWarningActions.value.set(warning.id, action)
    const nowIso = new Date().toISOString()
    const actor = currentUserPreview()
    try {
      if (action === 'requestHalt') {
        await requestHalt(warning)
        options.onUpdate({
          ...warning,
          halt_requested: true,
          halt_requested_by: actor,
          halt_requested_at: nowIso,
          halt_resolved_by: null,
          halt_resolved_at: null
        })
      } else if (action === 'resolveHalt') {
        await resolveHalt(warning)
        options.onUpdate({
          ...warning,
          halt_requested: false,
          halt_resolved_by: actor,
          halt_resolved_at: nowIso
        })
      } else if (action === 'silence') {
        await silence(warning)
        options.onUpdate({
          ...warning,
          silenced_permanently: true,
          silenced_by: actor,
          silenced_at: nowIso
        })
      } else {
        await unsilence(warning)
        options.onUpdate({
          ...warning,
          silenced_permanently: false,
          silenced_by: null,
          silenced_at: null
        })
      }
      toast.add({
        title: $i18n.t(ACTION_TOAST_KEYS[action].success, {
          key: warning.jira_issue_key
        }),
        color: 'success'
      })
    } catch (err) {
      toast.add({
        title: $i18n.t(ACTION_TOAST_KEYS[action].error),
        description: err instanceof Error ? err.message : undefined,
        color: 'error'
      })
    } finally {
      pendingWarningActions.value.delete(warning.id)
    }
  }

  /**
   * Entry point for UI components. Silence / resolve run immediately; halt
   * opens the confirmation dialog so the client explicitly consents to the
   * Slack side-effect.
   */
  function dispatchAction(
    warning: JiraWarning,
    action: WarningAction
  ): Promise<void> | void {
    if (action === 'requestHalt') {
      haltConfirmWarning.value = warning
      return
    }
    return executeAction(warning, action)
  }

  async function confirmHalt(): Promise<void> {
    const warning = haltConfirmWarning.value
    haltConfirmWarning.value = null
    if (!warning) return
    await executeAction(warning, 'requestHalt')
  }

  function cancelHaltConfirmation(): void {
    haltConfirmWarning.value = null
  }

  return {
    pendingActionFor,
    dispatchAction,
    haltConfirmWarning,
    confirmHalt,
    cancelHaltConfirmation
  }
}
