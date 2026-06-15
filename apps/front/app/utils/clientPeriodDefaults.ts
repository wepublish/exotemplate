import type { Client, ClientPeriod, Period } from '~~/types/DirectusTypes'

/** A client's billing periods (empty array when it has none). */
export function periodsOf(client: Client | undefined): ClientPeriod[] {
  return (client?.periods || []) as ClientPeriod[]
}

/** Newest (latest `Periods_id.from`) period id of a client, or undefined when
 *  the client has no periods. */
export function newestPeriodId(client: Client | undefined): number | undefined {
  const list = periodsOf(client)
  if (!list.length) return undefined
  return list.reduce((a, b) =>
    ((a.Periods_id as Period)?.from ?? '') >=
    ((b.Periods_id as Period)?.from ?? '')
      ? a
      : b
  ).id
}

/**
 * Default period for the bare `/` root: the newest period of the **first
 * client that actually has one**.
 *
 * Clients with no periods are skipped on purpose. The root page can only
 * redirect to a *period* (`/:clientPeriodId/dashboard`), so if the very first
 * client has none (e.g. a not-yet-onboarded client), choosing it would yield
 * `undefined` and strand the user on a blank root with no selection and dead
 * nav links. Returns undefined only when **no** client has any period.
 */
export function selectDefaultPeriodId(clients: Client[]): number | undefined {
  const firstWithPeriod = clients.find((c) => periodsOf(c).length > 0)
  return newestPeriodId(firstWithPeriod)
}
