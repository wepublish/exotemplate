import { readItems, updateItem } from '@directus/sdk'
import type { BillingMode, Client, JiraWarning } from '~~/types/DirectusTypes'

export function useJiraWarnings() {
  const { directus } = useDirectus()
  const userStore = useUserStore()

  function currentUserId(): string {
    const id = userStore.user?.id
    if (!id) throw new Error('Nicht angemeldet.')
    return id
  }

  async function listForClients(clientIds: string[]): Promise<JiraWarning[]> {
    if (!clientIds.length) return []
    return directus.request<JiraWarning[]>(
      readItems('JiraWarnings', {
        filter: { client: { _in: clientIds } },
        sort: ['-date_updated'],
        fields: [
          '*',
          {
            halt_requested_by: ['id', 'first_name', 'last_name', 'email'],
            halt_resolved_by: ['id', 'first_name', 'last_name', 'email'],
            silenced_by: ['id', 'first_name', 'last_name', 'email']
          }
        ],
        limit: -1
      })
    )
  }

  function isHalted(warning: JiraWarning): boolean {
    return !!warning.halt_requested
  }

  /**
   * Returns the next-threshold hour value as a finite number, or null when
   * it is missing or non-numeric (e.g. Postgres / Directus occasionally
   * round-trips `decimal` columns as strings or stale NaN values). Keeps the
   * UI from rendering "NaN h" in templates.
   */
  function nextThresholdHours(warning: JiraWarning): number | null {
    const raw = warning.next_threshold_hours
    if (raw == null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }

  function lastNotifiedHours(warning: JiraWarning): number | null {
    const raw = warning.last_notified_hours
    if (raw == null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }

  /**
   * Request a halt on the Jira ticket. The frontend only sends the boolean —
   * the Directus `jira-halt-notifier` hook fills in who/when on the server
   * and posts the Slack "STOP WORK" message to the client's channel.
   */
  async function requestHalt(warning: JiraWarning): Promise<void> {
    await directus.request(
      updateItem('JiraWarnings', warning.id, {
        halt_requested: true
      } as Partial<JiraWarning>)
    )
  }

  async function resolveHalt(warning: JiraWarning): Promise<void> {
    await directus.request(
      updateItem('JiraWarnings', warning.id, {
        halt_requested: false
      } as Partial<JiraWarning>)
    )
  }

  async function silence(warning: JiraWarning): Promise<void> {
    await directus.request(
      updateItem('JiraWarnings', warning.id, {
        silenced_permanently: true,
        silenced_by: currentUserId(),
        silenced_at: new Date().toISOString()
      } as Partial<JiraWarning>)
    )
  }

  async function unsilence(warning: JiraWarning): Promise<void> {
    await directus.request(
      updateItem('JiraWarnings', warning.id, {
        silenced_permanently: false,
        silenced_by: null,
        silenced_at: null
      } as Partial<JiraWarning>)
    )
  }

  async function setPause(clientId: string, paused: boolean): Promise<void> {
    await directus.request(
      updateItem('Clients', clientId, {
        notifications_paused: paused
      } as Partial<Client>)
    )
  }

  /**
   * Toggle the per-client weekly-report mute. The flag is read by the
   * `weekly-report` operation on every cron tick — no front-end side effects
   * beyond persisting the value.
   */
  async function setWeeklyReportPause(
    clientId: string,
    paused: boolean
  ): Promise<void> {
    await directus.request(
      updateItem('Clients', clientId, {
        weekly_report_paused: paused
      } as Partial<Client>)
    )
  }

  async function setBillingMode(
    clientId: string,
    mode: BillingMode
  ): Promise<void> {
    await directus.request(
      updateItem('Clients', clientId, {
        billing_mode: mode
      } as Partial<Client>)
    )
  }

  return {
    listForClients,
    isHalted,
    nextThresholdHours,
    lastNotifiedHours,
    requestHalt,
    resolveHalt,
    silence,
    unsilence,
    setPause,
    setWeeklyReportPause,
    setBillingMode
  }
}
