import { defineEndpoint } from '@directus/extensions-sdk'
import {
  ForbiddenError,
  InvalidPayloadError,
  createError
} from '@directus/errors'
import { readBillingEnv } from '../shared/billing/env'
import {
  CLOCKODO_TARGET_HOURS_CACHE_KEY,
  CLOCKODO_USERS_CACHE_KEY,
  clockodoAbsencesCacheKey,
  clockodoNonBusinessDaysCacheKey,
  clockodoUserDailyHoursCacheKey,
  CLOCKODO_USER_DAILY_HOURS_TTL_MS,
  getClockodoAbsencesCache,
  getClockodoNonBusinessDaysCache,
  getClockodoTargetHoursCache,
  getClockodoUserDailyHoursCache,
  getClockodoUsersCache
} from '../shared/cache'
import {
  getClockodoAbsences,
  getClockodoNonBusinessDays,
  getClockodoTargetHours,
  getClockodoUserDailyHours,
  getClockodoUsers
} from '../shared/clockodo'
import {
  computeUserMissingHours,
  yearsCoveringRange,
  type UserMissingHoursRow
} from '../shared/capture-overview'

const MissingEnvError = createError('500', 'Missing env variables.')

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface CaptureIgnoredUserRow {
  id: string
  users_id: number
  reason: string | null
}

interface ItemsServiceLike<T> {
  readByQuery(query: unknown): Promise<T[]>
}

export default defineEndpoint((router, context) => {
  router.get('/missing-hours', async (req: any, res, next) => {
    try {
      const accountability = req.accountability
      if (!accountability?.user) return next(new ForbiddenError())
      if (!accountability.admin) return next(new ForbiddenError())

      let env
      try {
        env = readBillingEnv(context.env)
      } catch {
        return next(new MissingEnvError())
      }

      const range = parseRange(req.query)
      if ('error' in range) return next(range.error)

      const usersCache = getClockodoUsersCache()
      const absencesCache = getClockodoAbsencesCache()
      const dailyCache = getClockodoUserDailyHoursCache()
      const targetHoursCache = getClockodoTargetHoursCache()
      const nonBusinessDaysCache = getClockodoNonBusinessDaysCache()

      const dailyKey = clockodoUserDailyHoursCacheKey(range.from, range.to)
      const hadDailyHit = dailyCache.has(dailyKey)
      const years = yearsCoveringRange(range.from, range.to)

      const schema = await context.getSchema()
      const ignoredRowsPromise = readIgnoredUsersSafely(
        context.services,
        schema
      )

      const [
        users,
        dailyHours,
        targetHours,
        absencesByYear,
        nonBusinessDaysByYear,
        ignoredRows
      ] = await Promise.all([
        usersCache.getOrCompute(CLOCKODO_USERS_CACHE_KEY, () =>
          getClockodoUsers(env)
        ),
        dailyCache.getOrCompute(dailyKey, () =>
          getClockodoUserDailyHours(env, range.from, range.to)
        ),
        targetHoursCache.getOrCompute(CLOCKODO_TARGET_HOURS_CACHE_KEY, () =>
          getClockodoTargetHours(env)
        ),
        Promise.all(
          years.map((year) =>
            absencesCache.getOrCompute(clockodoAbsencesCacheKey(year), () =>
              getClockodoAbsences(env, year)
            )
          )
        ),
        Promise.all(
          years.map((year) =>
            nonBusinessDaysCache.getOrCompute(
              clockodoNonBusinessDaysCacheKey(year),
              () => getClockodoNonBusinessDays(env, year)
            )
          )
        ),
        ignoredRowsPromise
      ])

      const absences = absencesByYear.flat()
      const nonBusinessDays = nonBusinessDaysByYear.flat()
      const ignoredByUser = indexIgnoredByUser(ignoredRows)

      const baseRows = computeUserMissingHours({
        users,
        absences,
        dailyHours,
        targetHours,
        nonBusinessDays,
        from: range.from,
        to: range.to
      })

      const rows: AnnotatedRow[] = baseRows.map((r) => {
        const ignored = ignoredByUser.get(r.id) ?? null
        return {
          ...r,
          ignored: !!ignored,
          ignoredRecordId: ignored?.id ?? null,
          ignoredReason: ignored?.reason ?? null
        }
      })

      const dailyEntry = dailyCache.getEntry(dailyKey)
      const expiresAt =
        dailyEntry?.expiresAt ?? Date.now() + CLOCKODO_USER_DAILY_HOURS_TTL_MS

      return res.send({
        data: rows,
        range: { from: range.from, to: range.to },
        cache: {
          hit: hadDailyHit,
          cachedAt: expiresAt - CLOCKODO_USER_DAILY_HOURS_TTL_MS,
          expiresAt,
          ttlMs: CLOCKODO_USER_DAILY_HOURS_TTL_MS
        }
      })
    } catch (e) {
      return next(e)
    }
  })

  /**
   * Invalidates the user-daily-hours cache entry for one specific range so
   * the dashboard's refresh button can force-pull fresh Clockodo data. Users
   * + absences + target-hours + non-business-days caches are left alone —
   * they're cheap to keep and change seldom enough that an extra hour of
   * staleness is fine for the BI surface.
   */
  router.delete('/missing-hours/cache', async (req: any, res, next) => {
    try {
      const accountability = req.accountability
      if (!accountability?.user) return next(new ForbiddenError())
      if (!accountability.admin) return next(new ForbiddenError())

      const range = parseRange(req.query)
      if ('error' in range) return next(range.error)

      const invalidated = getClockodoUserDailyHoursCache().invalidate(
        clockodoUserDailyHoursCacheKey(range.from, range.to)
      )

      return res.send({ invalidated })
    } catch (e) {
      return next(e)
    }
  })
})

interface AnnotatedRow extends UserMissingHoursRow {
  ignored: boolean
  ignoredRecordId: string | null
  ignoredReason: string | null
}

function indexIgnoredByUser(
  rows: CaptureIgnoredUserRow[]
): Map<number, CaptureIgnoredUserRow> {
  const out = new Map<number, CaptureIgnoredUserRow>()
  for (const row of rows) out.set(row.users_id, row)
  return out
}

/**
 * Reads the `CaptureIgnoredUsers` collection but degrades to an empty list
 * if the collection isn't part of the live schema yet — which happens before
 * the operator has run `npm run schema:load` to apply the new snapshot. The
 * dashboard then renders without ignore flags rather than 500-ing the whole
 * endpoint with Directus' opaque `Cannot read properties of undefined
 * (reading 'primary')`.
 */
async function readIgnoredUsersSafely(
  services: any,
  schema: any
): Promise<CaptureIgnoredUserRow[]> {
  if (!schema?.collections?.CaptureIgnoredUsers) {
    console.warn(
      '[time-tracking] CaptureIgnoredUsers collection missing from schema — run `npm run schema:load`. Returning empty ignored list.'
    )
    return []
  }
  try {
    const itemsService: ItemsServiceLike<CaptureIgnoredUserRow> =
      new services.ItemsService('CaptureIgnoredUsers', { schema })
    return await itemsService.readByQuery({
      fields: ['id', 'users_id', 'reason'],
      limit: -1
    })
  } catch (error) {
    console.error('[time-tracking] failed to read CaptureIgnoredUsers', error)
    return []
  }
}

interface ParsedRange {
  from: string
  to: string
}

interface ParseError {
  error: Error
}

/**
 * Validates and defaults the `from`/`to` query parameters to ISO date strings
 * (YYYY-MM-DD). Default range is the last 7 ending yesterday — the dashboard
 * defaults to this; explicit values from the picker win.
 */
function parseRange(
  query: Record<string, string | undefined>
): ParsedRange | ParseError {
  const defaults = defaultRange()
  const from = query.from ?? defaults.from
  const to = query.to ?? defaults.to

  if (!ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to)) {
    return {
      error: new InvalidPayloadError({
        reason: 'from/to must be YYYY-MM-DD ISO date strings'
      })
    }
  }
  if (from > to) {
    return {
      error: new InvalidPayloadError({
        reason: 'from must be <= to'
      })
    }
  }
  return { from, to }
}

function defaultRange(): ParsedRange {
  const now = new Date()
  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
  to.setUTCDate(to.getUTCDate() - 1)
  const from = new Date(to.getTime())
  from.setUTCDate(from.getUTCDate() - 6)
  return { from: toIso(from), to: toIso(to) }
}

function toIso(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
