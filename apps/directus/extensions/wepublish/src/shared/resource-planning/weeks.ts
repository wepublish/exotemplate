/**
 * UTC week helpers for resource planning. Weeks are keyed by their Monday's
 * date (YYYY-MM-DD) — unambiguous and avoids ISO week-number edge cases. UTC
 * throughout, matching the rest of the extension's date logic.
 */

function toUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** The Monday (UTC) of the week containing `dateISO`, as YYYY-MM-DD. */
export function weekMondayOf(dateISO: string): string {
  const d = toUtc(dateISO)
  const offset = (d.getUTCDay() + 6) % 7 // days since Monday (Mon=0 … Sun=6)
  d.setUTCDate(d.getUTCDate() - offset)
  return isoDate(d)
}

/** Every week Monday from the from-week through the to-week (inclusive). */
export function enumerateWeeks(fromISO: string, toISO: string): string[] {
  const start = toUtc(weekMondayOf(fromISO))
  const end = toUtc(weekMondayOf(toISO))
  const weeks: string[] = []
  for (
    const cur = start;
    cur.getTime() <= end.getTime();
    cur.setUTCDate(cur.getUTCDate() + 7)
  ) {
    weeks.push(isoDate(cur))
  }
  return weeks
}
