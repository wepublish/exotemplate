import { defineOperationApi } from '@directus/extensions-sdk'
import { readBillingEnv } from '../shared/billing/env'
import {
  CLOCKODO_TARGET_HOURS_CACHE_KEY,
  CLOCKODO_USERS_CACHE_KEY,
  clockodoAbsencesCacheKey,
  clockodoNonBusinessDaysCacheKey,
  clockodoUserDailyHoursCacheKey,
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
  composeDailyReminderMessage,
  computeUserMissingHours,
  yearsCoveringRange,
  type MissingUser,
  type UserMissingHoursRow
} from '../shared/capture-overview'
import {
  lookupSlackUserIdByEmail,
  postSlackMessage
} from '../shared/notifications/slack'

interface SettingsRow {
  slack_time_tracking_channel_id: string | null
}

interface CaptureIgnoredUserRow {
  users_id: number
}

interface ItemsServiceLike<T> {
  readSingleton(opts?: unknown): Promise<T>
  readByQuery(query: unknown): Promise<T[]>
}

const LOG_PREFIX = '[daily-capture-reminder]'

export default defineOperationApi({
  id: 'daily-capture-reminder',
  handler: async (_options, context: any) => {
    const { services, getSchema, env } = context

    let billingEnv
    try {
      billingEnv = readBillingEnv(env)
    } catch (error) {
      console.error(`${LOG_PREFIX} missing billing env`, error)
      return
    }

    const slackToken = env.SLACK_BOT_TOKEN as string | undefined
    if (!slackToken) {
      console.warn(`${LOG_PREFIX} SLACK_BOT_TOKEN not set, skipping`)
      return
    }

    const schema = await getSchema()

    let channelId: string | null = null
    if (!schema?.collections?.Settings) {
      console.error(
        `${LOG_PREFIX} Settings collection missing from schema — run \`npm run schema:load\`.`
      )
      return
    }
    try {
      const settingsService: ItemsServiceLike<SettingsRow> =
        new services.ItemsService('Settings', { schema })
      const settings = await settingsService.readSingleton({
        fields: ['slack_time_tracking_channel_id']
      })
      channelId = settings.slack_time_tracking_channel_id?.trim() || null
    } catch (error) {
      console.error(`${LOG_PREFIX} failed to read Settings singleton`, error)
      return
    }

    if (!channelId) {
      console.warn(
        `${LOG_PREFIX} Settings.slack_time_tracking_channel_id is empty, skipping`
      )
      return
    }

    const referenceDate = computeReferenceDate(new Date())
    const referenceIso = toIso(referenceDate)

    const dailyKey = clockodoUserDailyHoursCacheKey(referenceIso, referenceIso)
    const years = yearsCoveringRange(referenceIso, referenceIso)
    const [
      users,
      dailyHours,
      targetHours,
      absencesByYear,
      nonBusinessDaysByYear,
      ignoredRows
    ] = await Promise.all([
      getClockodoUsersCache().getOrCompute(CLOCKODO_USERS_CACHE_KEY, () =>
        getClockodoUsers(billingEnv)
      ),
      getClockodoUserDailyHoursCache().getOrCompute(dailyKey, () =>
        getClockodoUserDailyHours(billingEnv, referenceIso, referenceIso)
      ),
      getClockodoTargetHoursCache().getOrCompute(
        CLOCKODO_TARGET_HOURS_CACHE_KEY,
        () => getClockodoTargetHours(billingEnv)
      ),
      Promise.all(
        years.map((year) =>
          getClockodoAbsencesCache().getOrCompute(
            clockodoAbsencesCacheKey(year),
            () => getClockodoAbsences(billingEnv, year)
          )
        )
      ),
      Promise.all(
        years.map((year) =>
          getClockodoNonBusinessDaysCache().getOrCompute(
            clockodoNonBusinessDaysCacheKey(year),
            () => getClockodoNonBusinessDays(billingEnv, year)
          )
        )
      ),
      readIgnoredUsersSafely(services, schema)
    ])

    const absences = absencesByYear.flat()
    const nonBusinessDays = nonBusinessDaysByYear.flat()
    const ignoredIds = new Set(ignoredRows.map((r) => r.users_id))

    const rows = computeUserMissingHours({
      users,
      absences,
      dailyHours,
      targetHours,
      nonBusinessDays,
      from: referenceIso,
      to: referenceIso
    })

    // Filter out ignored users *before* checking who's missing — being on the
    // ignore list means we don't ping them at all.
    const missingRows = rows.filter(
      (r) => !ignoredIds.has(r.id) && userIsMissing(r)
    )
    if (missingRows.length === 0) {
      console.log(
        `${LOG_PREFIX} no missing users for ${referenceIso}, skipping post`
      )
      return
    }

    const missingUsers: MissingUser[] = await Promise.all(
      missingRows.map(async (r) => ({
        name: r.name,
        email: r.email,
        slackUserId: await lookupSlackUserIdByEmail(slackToken, r.email)
      }))
    )

    const message = composeDailyReminderMessage({
      missingUsers,
      referenceDate
    })

    const result = await postSlackMessage({
      token: slackToken,
      channel: channelId,
      message
    })

    if (!result.ok) {
      console.error(
        `${LOG_PREFIX} Slack rejected reminder: ${result.error ?? 'unknown'}`
      )
    }
  }
})

/**
 * On Tuesday–Friday the reminder is about "yesterday". On Mondays and weekend
 * test-runs it shifts back to Friday so the message always points at a real
 * workday. Public holidays still surface as `holiday` in the status grid;
 * the operation only filters by missing/partial.
 */
export function computeReferenceDate(now: Date): Date {
  const base = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
  base.setUTCDate(base.getUTCDate() - 1)
  while (base.getUTCDay() === 0 || base.getUTCDay() === 6) {
    base.setUTCDate(base.getUTCDate() - 1)
  }
  return base
}

function userIsMissing(row: UserMissingHoursRow): boolean {
  return row.days.some((d) => d.status === 'missing' || d.status === 'partial')
}

function toIso(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Mirror of the endpoint's helper: degrades gracefully when the
 * `CaptureIgnoredUsers` collection isn't part of the live schema yet so the
 * reminder still posts (with the previous "everyone is fair game" semantics)
 * instead of silently swallowing the run.
 */
async function readIgnoredUsersSafely(
  services: any,
  schema: any
): Promise<CaptureIgnoredUserRow[]> {
  if (!schema?.collections?.CaptureIgnoredUsers) {
    console.warn(
      `${LOG_PREFIX} CaptureIgnoredUsers collection missing from schema — run \`npm run schema:load\`. Treating no one as ignored.`
    )
    return []
  }
  try {
    const itemsService: ItemsServiceLike<CaptureIgnoredUserRow> =
      new services.ItemsService('CaptureIgnoredUsers', { schema })
    return await itemsService.readByQuery({
      fields: ['users_id'],
      limit: -1
    })
  } catch (error) {
    console.error(`${LOG_PREFIX} failed to read CaptureIgnoredUsers`, error)
    return []
  }
}
