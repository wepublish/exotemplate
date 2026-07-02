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
  getClockodoAbsencesCache,
  getClockodoNonBusinessDaysCache,
  getClockodoTargetHoursCache,
  getClockodoUsersCache
} from '../shared/cache'
import {
  getClockodoAbsences,
  getClockodoNonBusinessDays,
  getClockodoTargetHours,
  getClockodoUsers
} from '../shared/clockodo'
import {
  computeUserMissingHours,
  yearsCoveringRange
} from '../shared/capture-overview'
import { enumerateWeeks, weekMondayOf } from '../shared/resource-planning/weeks'
import {
  employeeWeeklyCapacity,
  phaseWeekIndices
} from '../shared/resource-planning/capacity'
import {
  distributeAnnualBudgetSplit,
  weeklyUtilization
} from '../shared/resource-planning/planning'

const MissingEnvError = createError('500', 'Missing env variables.')
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface ItemsServiceLike<T> {
  readByQuery(query: unknown): Promise<T[]>
}

async function readSafely<T>(
  services: any,
  schema: any,
  collection: string,
  query: unknown
): Promise<T[]> {
  if (!schema?.collections?.[collection]) return []
  try {
    const svc: ItemsServiceLike<T> = new services.ItemsService(collection, {
      schema
    })
    return await svc.readByQuery(query)
  } catch {
    return []
  }
}

export default defineEndpoint((router, context) => {
  /**
   * Weekly team utilization: capacity (Clockodo target hours − absences −
   * holidays − per-employee "other work") vs planned project load (annual
   * budget spread over the year with intensive-phase redistribution). Reuses
   * the shared Clockodo caches — no per-week API calls.
   */
  router.get('/overview', async (req: any, res, next) => {
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

      const weeks = enumerateWeeks(range.from, range.to)
      // Expand the day/holiday computation to the FULL boundary weeks (a
      // Monday-aligned first/last week can spill into the neighbouring year),
      // so year-edge weeks (e.g. the New Year week) have complete capacity and
      // their holidays (Neujahr) are captured instead of showing an empty bar.
      const addDaysIso = (iso: string, n: number): string => {
        const d = new Date(`${iso}T00:00:00Z`)
        d.setUTCDate(d.getUTCDate() + n)
        return d.toISOString().slice(0, 10)
      }
      const spanFrom = weeks[0] ?? range.from
      const spanTo = weeks.length
        ? addDaysIso(weeks[weeks.length - 1]!, 6)
        : range.to
      const years = yearsCoveringRange(spanFrom, spanTo)

      const usersCache = getClockodoUsersCache()
      const absencesCache = getClockodoAbsencesCache()
      const targetHoursCache = getClockodoTargetHoursCache()
      const nonBusinessDaysCache = getClockodoNonBusinessDaysCache()

      const [users, targetHours, absencesByYear, nonBusinessByYear] =
        await Promise.all([
          usersCache.getOrCompute(CLOCKODO_USERS_CACHE_KEY, () =>
            getClockodoUsers(env)
          ),
          targetHoursCache.getOrCompute(CLOCKODO_TARGET_HOURS_CACHE_KEY, () =>
            getClockodoTargetHours(env)
          ),
          Promise.all(
            years.map((y) =>
              absencesCache.getOrCompute(clockodoAbsencesCacheKey(y), () =>
                getClockodoAbsences(env, y)
              )
            )
          ),
          Promise.all(
            years.map((y) =>
              nonBusinessDaysCache.getOrCompute(
                clockodoNonBusinessDaysCacheKey(y),
                () => getClockodoNonBusinessDays(env, y)
              )
            )
          )
        ])

      // Per-user per-day available hours (captured is irrelevant for capacity,
      // so daily hours are empty — expectedHours already nets out
      // weekends/absences/holidays).
      const rows = computeUserMissingHours({
        users,
        absences: absencesByYear.flat(),
        dailyHours: [],
        targetHours,
        nonBusinessDays: nonBusinessByYear.flat(),
        from: spanFrom,
        to: spanTo
      })

      // Same computation WITHOUT absences → the "full potential" per day. The
      // difference from `rows` is the hours lost to vacation/absence (holidays
      // are excluded in both, so they don't count as vacation).
      const rowsFull = computeUserMissingHours({
        users,
        absences: [],
        dailyHours: [],
        targetHours,
        nonBusinessDays: nonBusinessByYear.flat(),
        from: spanFrom,
        to: spanTo
      })

      // And WITHOUT absences AND holidays → pure contract target. The difference
      // from `rowsFull` is the hours lost to public holidays, so we can fill a
      // distinct "holiday" segment on the bars.
      const rowsBase = computeUserMissingHours({
        users,
        absences: [],
        dailyHours: [],
        targetHours,
        nonBusinessDays: [],
        from: spanFrom,
        to: spanTo
      })

      const schema = await context.getSchema()
      const [
        selectedRows,
        budgets,
        clientPeriods,
        snapshots,
        closures,
        defaultLoads
      ] = await Promise.all([
        readSafely<{
          clockodo_user_id: string
          excluded: boolean
          project_hours_percentage: number | null
        }>(context.services, schema, 'ResourcePlanEmployees', {
          fields: ['clockodo_user_id', 'excluded', 'project_hours_percentage'],
          limit: -1
        }),
        readSafely<any>(context.services, schema, 'ProjectBudgets', {
          fields: [
            'id',
            'annual_budget_hours',
            'year',
            'min_weekly_hours',
            'min_weekly_clockodo_user_id',
            'min_assignees.clockodo_user_id',
            'min_assignees.share',
            'client.id',
            'client.name',
            'phases.name',
            'phases.from',
            'phases.to',
            'phases.hours',
            'phases.clockodo_user_id',
            'phases.assignees.clockodo_user_id',
            'phases.assignees.share'
          ],
          filter: { year: { _in: years } },
          limit: -1
        }),
        // For deriving planned load from Top-Ups when no explicit budget exists.
        readSafely<any>(context.services, schema, 'Clients_Periods', {
          fields: [
            'id',
            'Clients_id.id',
            'Clients_id.name',
            'Periods_id.from',
            'Periods_id.to'
          ],
          limit: -1
        }),
        readSafely<any>(context.services, schema, 'BillingSnapshots', {
          // Remaining (unused) hours, not total purchased — see derivation below.
          fields: ['clientPeriodId', 'totalAvailableHours'],
          limit: -1
        }),
        readSafely<{
          from: string | null
          to: string | null
          name: string | null
        }>(context.services, schema, 'CompanyClosures', {
          fields: ['from', 'to', 'name'],
          limit: -1
        }),
        readSafely<{
          clockodo_user_id: string
          name: string | null
          weekly_hours: number | null
        }>(context.services, schema, 'ResourcePlanDefaultLoads', {
          fields: ['clockodo_user_id', 'name', 'weekly_hours'],
          limit: -1
        })
      ])

      // Per-person recurring default load (internal/standing tasks). These
      // reserve weekly capacity — they reduce the person's hours available for
      // general project work and show as direct load with the task name.
      const defaultLoadByUser = new Map<
        number,
        { total: number; items: { name: string; hours: number }[] }
      >()
      for (const dl of defaultLoads) {
        const uid = Number(dl.clockodo_user_id)
        const hours = Math.max(0, dl.weekly_hours || 0)
        if (!uid || hours <= 0) continue
        const entry = defaultLoadByUser.get(uid) ?? { total: 0, items: [] }
        entry.total += hours
        entry.items.push({ name: dl.name?.trim() || '—', hours })
        defaultLoadByUser.set(uid, entry)
      }

      // Betriebsferien: a week is "closed" when all its weekdays (Mon–Fri) fall
      // within a company closure range. Closed weeks get zero capacity and no
      // planned load — the load redistributes to the open weeks.
      const closureRanges = closures.filter((c) => c.from && c.to)
      const isClosedDay = (day: string): boolean =>
        closureRanges.some(
          (c) => day >= (c.from as string) && day <= (c.to as string)
        )
      const closedWeeks = weeks.map((mon) => {
        for (let dd = 0; dd < 5; dd++) {
          if (!isClosedDay(addDaysIso(mon, dd))) return false
        }
        return true
      })
      const closureNameForWeek = (i: number): string | null => {
        if (!closedWeeks[i]) return null
        const mon = weeks[i]!
        const hit = closureRanges.find(
          (c) => mon >= (c.from as string) && mon <= (c.to as string)
        )
        return hit?.name ?? null
      }

      // Everyone is in the total by default; per-employee settings carry the
      // weekly "other work" budget and an `excluded` flag (toggle out of total).
      const settingsByUser = new Map<
        number,
        { excluded: boolean; projectPct: number }
      >()
      for (const r of selectedRows) {
        settingsByUser.set(Number(r.clockodo_user_id), {
          excluded: !!r.excluded,
          projectPct:
            r.project_hours_percentage == null
              ? 70
              : Math.min(100, Math.max(0, r.project_hours_percentage))
        })
      }

      // Direct commitments → per-user weekly hours dedicated to a specific
      // person, which reduce that person's capacity available for general work:
      //  (a) person-assigned intensive phases (concentrated in their weeks), and
      //  (b) a project's minimum weekly load when it's assigned to a person
      //      (a steady weekly commitment across the whole year).
      // Per-user weekly availability (raw expected hours). 0 means the person is
      // off that whole week (vacation/holiday) — a minimum load assigned to them
      // is then handed to the rest of the team for those weeks.
      const weeklyHours = (rowList: typeof rows): Map<number, number[]> => {
        const m = new Map<number, number[]>()
        for (const r of rowList) {
          const arr = new Array<number>(weeks.length).fill(0)
          for (const d of r.days) {
            const wi = weeks.indexOf(weekMondayOf(d.date))
            if (wi >= 0) arr[wi] += d.expectedHours || 0
          }
          m.set(r.id, arr)
        }
        return m
      }
      const availByUser = weeklyHours(rows)
      const fullAvailByUser = weeklyHours(rowsFull) // ignoring absences
      const baseAvailByUser = weeklyHours(rowsBase) // ignoring absences + holidays

      // Public-holiday names per (user, week) — so the tooltip can name the
      // holiday(s) that reduced capacity. Half-day holidays carry a name too.
      const holidayWeeklyByUser = new Map<number, string[][]>()
      for (const r of rows) {
        const perWeek: string[][] = weeks.map(() => [])
        for (const d of r.days) {
          if (!d.holidayName) continue
          const wi = weeks.indexOf(weekMondayOf(d.date))
          if (wi >= 0 && !perWeek[wi].includes(d.holidayName)) {
            perWeek[wi].push(d.holidayName)
          }
        }
        holidayWeeklyByUser.set(r.id, perWeek)
      }

      const committedByUser = new Map<number, number[]>()
      const commit = (uid: number, i: number, hours: number): void => {
        const arr = committedByUser.get(uid) ?? new Array(weeks.length).fill(0)
        arr[i] += hours
        committedByUser.set(uid, arr)
      }
      // Resolve a weighted assignee list: prefer the `assignees` child rows
      // (each {clockodo_user_id, share}); fall back to the legacy single field.
      // Shares with no positive weight are treated as equal.
      type Assignee = { uid: number; w: number }
      const resolveAssignees = (
        list: any[] | undefined,
        legacyUid: string | null | undefined
      ): Assignee[] => {
        const a = (list ?? [])
          .filter((x) => x.clockodo_user_id)
          .map((x) => ({
            uid: Number(x.clockodo_user_id),
            w: Math.max(0, x.share ?? 0)
          }))
        if (a.length) {
          const withW = a.filter((x) => x.w > 0)
          return withW.length ? withW : a.map((x) => ({ uid: x.uid, w: 1 }))
        }
        return legacyUid ? [{ uid: Number(legacyUid), w: 1 }] : []
      }

      // Per-budget person-assigned minimum, split per week into the part the
      // assignees actually carry (available weeks) and the part handed to the
      // team because they're on vacation that week.
      const minDirectByBudget = new Map<number, number[]>()
      const minGeneralByBudget = new Map<number, number[]>()
      for (const b of budgets) {
        for (const p of b.phases ?? []) {
          const as = resolveAssignees(p.assignees, p.clockodo_user_id)
          if (!as.length) continue
          const idxs = phaseWeekIndices(p.from, p.to, weeks)
          if (!idxs.length) continue
          const perWeek = Math.max(0, p.hours || 0) / idxs.length
          const totalW = as.reduce((s, x) => s + x.w, 0) || 1
          for (const i of idxs) {
            if (closedWeeks[i]) continue
            for (const a of as) commit(a.uid, i, (perWeek * a.w) / totalW)
          }
        }
        const minH = Math.max(0, b.min_weekly_hours || 0)
        const minAs = resolveAssignees(
          b.min_assignees,
          b.min_weekly_clockodo_user_id
        )
        if (minH > 0 && minAs.length) {
          const totalW = minAs.reduce((s, x) => s + x.w, 0) || 1
          const direct = new Array<number>(weeks.length).fill(0)
          const general = new Array<number>(weeks.length).fill(0)
          for (let i = 0; i < weeks.length; i++) {
            if (closedWeeks[i]) continue // Betriebsferien → fixed load is 0
            for (const a of minAs) {
              const share = (minH * a.w) / totalW
              if ((availByUser.get(a.uid)?.[i] ?? 0) > 0) {
                commit(a.uid, i, share)
                direct[i] += share
              } else {
                // This assignee is off → their share goes to the rest of the team.
                general[i] += share
              }
            }
          }
          minDirectByBudget.set(b.id, direct)
          minGeneralByBudget.set(b.id, general)
        }
      }
      // Per-person recurring default load → committed on open weeks, scaled by
      // how available the person actually is that week AND capped at their
      // project capacity that week. So on vacation weeks they don't do these
      // tasks (0 load) and the fixed load never pushes them over capacity.
      for (const [uid, dl] of defaultLoadByUser) {
        const avail = availByUser.get(uid)
        const full = fullAvailByUser.get(uid)
        const pct = (settingsByUser.get(uid)?.projectPct ?? 70) / 100
        for (let i = 0; i < weeks.length; i++) {
          if (closedWeeks[i]) continue
          const fullH = full?.[i] ?? 0
          const availH = avail?.[i] ?? 0
          const factor = fullH > 0 ? Math.min(1, availH / fullH) : 0
          const capacityH = availH * pct // project capacity this week
          const load = Math.min(dl.total * factor, capacityH)
          if (load > 0) commit(uid, i, load)
        }
      }

      const employees = rows.map((r) => {
        const s = settingsByUser.get(r.id)
        const excluded = s?.excluded ?? false
        const projectPct = s?.projectPct ?? 70
        const days = r.days.map((d) => ({
          date: d.date,
          expectedHours: d.expectedHours
        }))
        // Project capacity = available hours scaled by the project-hours %.
        // Company closures (Betriebsferien) force capacity to 0 — nobody works.
        // We keep the would-be capacity for closed weeks so the black block on
        // the per-person graph can be drawn only as tall as that capacity.
        const grossRaw = employeeWeeklyCapacity(days, 0, weeks, projectPct)
        const gross = grossRaw.map((h, i) => (closedWeeks[i] ? 0 : h))
        const closedCapacityWeekly = grossRaw.map((h, i) =>
          closedWeeks[i] ? h : 0
        )
        const committed = committedByUser.get(r.id)
        const directWeekly = (
          committed
            ? committed.slice()
            : new Array<number>(weeks.length).fill(0)
        ).map((h, i) => (closedWeeks[i] ? 0 : h))
        // Capacity still available for general (unassigned) project work.
        const weekly = gross.map((h, i) => Math.max(0, h - directWeekly[i]))
        // Vacation: hours lost to absence per week, expressed as project-
        // capacity-equivalent (× projectPct) so it stacks coherently on top of
        // `grossWeekly` (gross + vacation = the person's full project capacity
        // had they not been away). `offWeekly` flags a full week off.
        const avail = availByUser.get(r.id)
        const full = fullAvailByUser.get(r.id)
        const base = baseAvailByUser.get(r.id)
        const factor = Math.min(100, Math.max(0, projectPct)) / 100
        // Closed weeks are shown as Betriebsferien (black), not vacation/holiday.
        const vacationWeekly = weeks.map((_, i) =>
          closedWeeks[i]
            ? 0
            : Math.max(0, (full?.[i] ?? 0) - (avail?.[i] ?? 0)) * factor
        )
        // Project-equivalent hours lost to public holidays this week.
        const holidayHoursWeekly = weeks.map((_, i) =>
          closedWeeks[i]
            ? 0
            : Math.max(0, (base?.[i] ?? 0) - (full?.[i] ?? 0)) * factor
        )
        const anyCap = avail ? avail.some((v) => v > 0) : false
        const offWeekly = weeks.map(
          (_, i) => !closedWeeks[i] && anyCap && (avail?.[i] ?? 0) === 0
        )
        return {
          id: r.id,
          name: r.name,
          excluded,
          projectPct,
          weekly,
          grossWeekly: gross,
          closedCapacityWeekly,
          directWeekly,
          vacationWeekly,
          holidayHoursWeekly,
          offWeekly,
          holidayWeekly: holidayWeeklyByUser.get(r.id) ?? weeks.map(() => []),
          defaultLoadItems: defaultLoadByUser.get(r.id)?.items ?? [],
          generalWeekly: new Array<number>(weeks.length).fill(0) // filled below
        }
      })

      // Billing remaining, needed both to derive budgets below and for the
      // year-end saldo. The REMAINING hours (totalAvailableHours) of the CURRENT
      // (or future) billing periods; ended periods are ignored (their leftover
      // budget is expired and not plannable — e.g. a closed H1 on top of H2).
      const availableByPeriod = new Map<number, number>()
      for (const s of snapshots) {
        availableByPeriod.set(
          Number(s.clientPeriodId),
          Number(s.totalAvailableHours) || 0
        )
      }
      const todayISO = new Date().toISOString().slice(0, 10)
      const todayWeek = weekMondayOf(todayISO)
      const remainingByClient = new Map<string, number>()
      for (const cp of clientPeriods) {
        const clientId = cp.Clients_id?.id
        const pTo = cp.Periods_id?.to
        const pFrom = cp.Periods_id?.from
        if (!clientId || !pFrom || !pTo) continue
        if (pTo < range.from || pFrom > range.to) continue
        if (pTo < todayISO) continue // ended period — expired
        const hrs = availableByPeriod.get(cp.id) ?? 0
        remainingByClient.set(
          clientId,
          (remainingByClient.get(clientId) ?? 0) + hrs
        )
      }
      // Forward weeks that are also OPEN (not Betriebsferien) — derived billing
      // load spreads only over these, redistributing away from closed weeks.
      const fallbackRemainingIdx = weeks
        .map((w, i) => ({ w, i }))
        .filter((x) => x.w >= todayWeek && !closedWeeks[x.i])
        .map((x) => x.i)
      // Base load is planned forward-only: block past + closed weeks so the
      // remaining budget spreads over the weeks still ahead (consistent with the
      // derived projects, so the year-end saldo isn't skewed by the past half).
      const forwardOpenBlocked = weeks.map(
        (w, i) => closedWeeks[i] === true || w < todayWeek
      )

      // Explicit budgets: only project-level phases (no person) shape the demand
      // curve — person-assigned phases are capacity commitments, handled above.
      // Each project's weekly load is split into base (evenly-spread) and
      // intensive (phase-concentrated) so the chart can stack them; per-phase
      // per-week hours are kept for the hover breakdown.
      interface PhaseMeta {
        name: string | null
        weeks: number[]
        perWeek: number
      }
      interface PlanProjectOut {
        clientId: string | null
        clientName: string
        annualBudget: number
        derived: boolean
        weekly: number[]
        baseWeekly: number[]
        intensiveWeekly: number[]
        // Person-assigned phase load for THIS project (direct commitments),
        // distributed over their weeks. Consumes the budget like intensive work.
        directWeekly: number[]
        phaseMeta: PhaseMeta[]
        // Current billing remaining (sum of active/future periods) or null when
        // the client has no active billing period. Used for the year-end saldo.
        availableHours: number | null
      }
      const explicitClientIds = new Set<string>()
      const projects: PlanProjectOut[] = budgets.map((b: any) => {
        if (b.client?.id) explicitClientIds.add(b.client.id)
        const allPhases = b.phases ?? []
        const isAssigned = (p: any): boolean =>
          resolveAssignees(p.assignees, p.clockodo_user_id).length > 0
        // General (unassigned) phases shape the demand curve.
        const projPhases = allPhases.filter((p: any) => !isAssigned(p))
        const phaseInputs = projPhases.map((p: any) => ({
          weeks: phaseWeekIndices(p.from, p.to, weeks),
          hours: Math.max(0, p.hours || 0)
        }))
        // Assigned phases → per-project direct load (full hours; the per-person
        // split lives in committedByUser). Carved out of the general budget below.
        const directWeekly = new Array<number>(weeks.length).fill(0)
        for (const p of allPhases) {
          if (!isAssigned(p)) continue
          const idxs = phaseWeekIndices(p.from, p.to, weeks)
          if (!idxs.length) continue
          const perWeek = Math.max(0, p.hours || 0) / idxs.length
          for (const i of idxs) directWeekly[i] += perWeek
        }
        const directTotal = directWeekly.reduce((s, h) => s + h, 0)
        // The project's budget always derives from the client's REMAINING
        // billing hours (no manual annual budget). Explicit ProjectBudget rows
        // only carry phases + a minimum weekly load.
        const annual = Math.max(0, remainingByClient.get(b.client?.id) ?? 0)
        // General distribution gets what's left after the person-assigned share.
        const generalAnnual = Math.max(0, annual - directTotal)
        const phaseTotal = phaseInputs.reduce(
          (s: number, p: any) => s + p.hours,
          0
        )
        const scale =
          phaseTotal > generalAnnual && phaseTotal > 0
            ? generalAnnual / phaseTotal
            : 1
        const phaseMeta: PhaseMeta[] = projPhases.map((p: any, idx: number) => {
          const wk = phaseInputs[idx].weeks
          return {
            name: p.name ?? null,
            weeks: wk,
            perWeek: wk.length
              ? (phaseInputs[idx].hours * scale) / wk.length
              : 0
          }
        })
        // A project's minimum weekly load only shapes general demand when it's
        // NOT assigned to anyone (an assigned minimum is a direct capacity
        // commitment, already added to committedByUser above).
        const minWeekly = resolveAssignees(
          b.min_assignees,
          b.min_weekly_clockodo_user_id
        ).length
          ? 0
          : Math.max(0, b.min_weekly_hours || 0)
        const split = distributeAnnualBudgetSplit(
          generalAnnual,
          weeks.length,
          phaseInputs,
          minWeekly,
          forwardOpenBlocked
        )
        // Person-assigned minimum: the assignee carries it on available weeks
        // (added to their direct load); on vacation weeks it becomes general
        // load so the rest of the team picks it up.
        const baseWeekly = split.base.slice()
        const minDir = minDirectByBudget.get(b.id)
        const minGen = minGeneralByBudget.get(b.id)
        for (let i = 0; i < weeks.length; i++) {
          if (minDir) directWeekly[i] += minDir[i]
          if (minGen) baseWeekly[i] += minGen[i]
        }
        return {
          clientId: b.client?.id ?? null,
          clientName: b.client?.name ?? '—',
          annualBudget: annual,
          derived: false,
          weekly: baseWeekly.map((x, i) => x + split.intensive[i]),
          baseWeekly,
          intensiveWeekly: split.intensive,
          directWeekly,
          phaseMeta,
          availableHours: null // filled in after remainingByClient is built
        }
      })

      const derivedWeeklyByClient = new Map<
        string,
        { name: string; weekly: number[] }
      >()
      for (const cp of clientPeriods) {
        const clientId = cp.Clients_id?.id
        const pFrom = cp.Periods_id?.from
        const pTo = cp.Periods_id?.to
        if (!clientId || explicitClientIds.has(clientId) || !pFrom || !pTo) {
          continue
        }
        if (pTo < range.from || pFrom > range.to) continue // outside the year
        if (pTo < todayISO) continue // period already ended → not plannable

        // Register the client even when there's nothing left to plan, so media
        // that are at/over budget still appear (with zero future load and a
        // negative year-end saldo) instead of vanishing from the views.
        const entry = derivedWeeklyByClient.get(clientId) ?? {
          name: cp.Clients_id?.name ?? '—',
          weekly: new Array<number>(weeks.length).fill(0)
        }
        derivedWeeklyByClient.set(clientId, entry)

        const hrs = availableByPeriod.get(cp.id) ?? 0
        if (hrs <= 0) continue // over/at budget → no positive load to spread

        // Spread this period's remaining hours over the weeks that fall within
        // the period, are still ahead, and are OPEN (not Betriebsferien).
        const idx = phaseWeekIndices(pFrom, pTo, weeks).filter(
          (i) => weeks[i]! >= todayWeek && !closedWeeks[i]
        )
        const spread = idx.length ? idx : fallbackRemainingIdx
        if (!spread.length) continue
        const perWeek = hrs / spread.length
        for (const i of spread) entry.weekly[i] += perWeek
      }

      for (const [clientId, { name, weekly }] of derivedWeeklyByClient) {
        // Derived load has no intensive phases — it's all base.
        projects.push({
          clientId,
          clientName: name,
          annualBudget: weekly.reduce((a, b) => a + b, 0),
          derived: true,
          weekly,
          baseWeekly: weekly.slice(),
          intensiveWeekly: new Array<number>(weeks.length).fill(0),
          directWeekly: new Array<number>(weeks.length).fill(0),
          phaseMeta: [],
          availableHours: null // filled in below
        })
      }

      // Attach current billing remaining to every project (for the year-end
      // saldo on the project-balance view). Null when the client has no active
      // billing period.
      for (const p of projects) {
        p.availableHours = p.clientId
          ? (remainingByClient.get(p.clientId) ?? null)
          : null
      }

      // Team roll-up per week — only employees NOT excluded count toward the
      // total. Capacity is GROSS (before direct commitments); planned load is
      // stacked as base + general intensive phases + direct (person-assigned)
      // work, so intensive phases are visible in the team overview. A per-week
      // breakdown of who/what contributes feeds the hover tooltip.
      const included = employees.filter((e) => !e.excluded)
      const team = weeks.map((wk, i) => {
        const capacity = included.reduce(
          (s, e) => s + (e.grossWeekly[i] ?? 0),
          0
        )
        let base = 0
        let intensive = 0
        const baseItems: { name: string; hours: number }[] = []
        const intensiveItems: {
          name: string
          phase: string | null
          hours: number
        }[] = []
        for (const p of projects) {
          const b = p.baseWeekly[i] ?? 0
          if (b > 0.001) {
            base += b
            baseItems.push({ name: p.clientName, hours: b })
          }
          intensive += p.intensiveWeekly[i] ?? 0
          for (const ph of p.phaseMeta) {
            if (ph.weeks.includes(i) && ph.perWeek > 0.001) {
              intensiveItems.push({
                name: p.clientName,
                phase: ph.name,
                hours: ph.perWeek
              })
            }
          }
        }
        // Direct (person-assigned) work — intensive phases + minimums tied to a
        // specific person. Shown as its own stacked segment.
        let direct = 0
        const directItems: { name: string; hours: number }[] = []
        for (const e of included) {
          const d = e.directWeekly[i] ?? 0
          if (d > 0.001) {
            direct += d
            directItems.push({ name: e.name, hours: d })
          }
        }
        // Vacation this week: everyone with absence hours (partial or full),
        // with their project-equivalent hours — so the tooltip names who's away.
        const vacationItems = included
          .filter((e) => (e.vacationWeekly[i] ?? 0) > 0.05)
          .map((e) => ({ name: e.name, hours: e.vacationWeekly[i] ?? 0 }))
        const vacation = vacationItems.reduce((s, v) => s + v.hours, 0)
        // Public holidays this week (union of names + project-equiv hours lost).
        const holidays: string[] = []
        let holiday = 0
        for (const e of included) {
          holiday += e.holidayHoursWeekly[i] ?? 0
          for (const name of e.holidayWeekly[i] ?? []) {
            if (!holidays.includes(name)) holidays.push(name)
          }
        }
        const planned = base + intensive + direct
        const u = weeklyUtilization(planned, capacity)
        return {
          week: wk,
          capacity,
          planned,
          base,
          intensive,
          direct,
          vacation,
          vacationCount: vacationItems.length,
          holiday,
          holidays,
          closed: closedWeeks[i] === true,
          closureName: closureNameForWeek(i),
          ratio: Number.isFinite(u.ratio) ? u.ratio : null,
          overloaded: u.overloaded,
          breakdown: {
            base: baseItems,
            intensive: intensiveItems,
            direct: directItems,
            vacation: vacationItems
          }
        }
      })

      // Per-employee general project load: the GENERAL (unassigned) team load
      // each week — base + general intensive, NOT direct — split across included
      // employees in proportion to the capacity they still have free after their
      // own direct commitments. Lets the per-person graph stack "assigned
      // directly to me" vs "general project load".
      for (let i = 0; i < weeks.length; i++) {
        const generalLoad = team[i].base + team[i].intensive
        const netAvail = included.reduce((s, e) => s + (e.weekly[i] ?? 0), 0)
        if (generalLoad <= 0 || netAvail <= 0) continue
        for (const e of included) {
          e.generalWeekly[i] = generalLoad * ((e.weekly[i] ?? 0) / netAvail)
        }
      }

      return res.send({
        data: { weeks, team, employees, projects },
        range,
        excludedCount: employees.length - included.length
      })
    } catch (e) {
      return next(e)
    }
  })
})

interface ParsedRange {
  from: string
  to: string
}

function parseRange(
  query: Record<string, string | undefined>
): ParsedRange | { error: Error } {
  const now = new Date()
  const year = now.getUTCFullYear()
  const from = query.from ?? `${year}-01-01`
  const to = query.to ?? `${year}-12-31`
  if (!ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to)) {
    return {
      error: new InvalidPayloadError({
        reason: 'from/to must be YYYY-MM-DD ISO date strings'
      })
    }
  }
  if (from > to) {
    return { error: new InvalidPayloadError({ reason: 'from must be <= to' }) }
  }
  return { from, to }
}
