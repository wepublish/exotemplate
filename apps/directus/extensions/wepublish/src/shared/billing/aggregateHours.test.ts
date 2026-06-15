import { describe, it, expect } from 'vitest'
import {
  AGGREGATED_HOURS_CLIENT_PERIOD_FIELDS,
  BILLABLE_PART_WEP,
  SECONDS_PER_HOUR,
  computeEntryGroups,
  computeTopUps,
  decorateBillability,
  findJiraEntryGroup,
  getBillableAndNonBillableHours,
  getClockodoDateFormat,
  getJiraIssue,
  mergeSameJiraIssues,
  roundToQuarter,
  type EntryGroup,
  type EntryGroups,
  type JiraIssue
} from './aggregateHours'
import type { ManualWorkEntry, TopUp } from '../../DirectusTypes'

function buildEntryGroup(overrides: Partial<EntryGroup> = {}): EntryGroup {
  return {
    group: 'group-id',
    grouped_by: [],
    name: '',
    revenue: 0,
    budget: 0,
    budget_is_hours: false,
    budget_is_strict: false,
    note: '',
    hourly_rate: 0,
    billable: 1,
    billable_amount: 0,
    duration: 0,
    restrictions: [],
    sub_groups: [],
    ...overrides
  }
}

function buildJiraIssue(hours: string): JiraIssue {
  return {
    expand: '',
    id: '1',
    self: '',
    key: 'ABC-1',
    fields: { customfield_10028: hours }
  }
}

function buildTopUp(overrides: Partial<TopUp> = {}): TopUp {
  return {
    amount: 0,
    clientPeriod: null,
    date_created: null,
    date_updated: null,
    hourlyRate: 100,
    id: 'topup-1',
    note: null,
    sort: null,
    status: 'published',
    user_created: null,
    user_updated: null,
    wepPercentage: 0,
    bexioInvoiceId: null,
    ...overrides
  }
}

describe('roundToQuarter', () => {
  it('rounds 0 to 0', () => {
    expect(roundToQuarter(0)).toBe(0)
  })
  it('rounds 0.12 down to 0 (nearest quarter)', () => {
    expect(roundToQuarter(0.12)).toBe(0)
  })
  it('rounds 0.13 up to 0.25 (nearest quarter)', () => {
    expect(roundToQuarter(0.13)).toBe(0.25)
  })
  it('rounds 0.125 up to 0.25 (banker boundary)', () => {
    expect(roundToQuarter(0.125)).toBe(0.25)
  })
  it('rounds 0.37 down to 0.25 (nearest quarter)', () => {
    expect(roundToQuarter(0.37)).toBe(0.25)
  })
  it('rounds 0.38 up to 0.5 (nearest quarter)', () => {
    expect(roundToQuarter(0.38)).toBe(0.5)
  })
  it('rounds 1.1 to 1.0', () => {
    expect(roundToQuarter(1.1)).toBe(1.0)
  })
  it('rounds 1.9 to 2.0', () => {
    expect(roundToQuarter(1.9)).toBe(2.0)
  })
})

describe('getJiraIssue', () => {
  it('extracts issue key from text with prefix', () => {
    expect(getJiraIssue('Fix bug ABC-123 in module', 'ABC')).toBe('ABC-123')
  })
  it('returns the first match only', () => {
    expect(getJiraIssue('ABC-1 and ABC-2', 'ABC')).toBe('ABC-1')
  })
  it('returns undefined when no match', () => {
    expect(getJiraIssue('no issue here', 'ABC')).toBeUndefined()
  })
  it('returns undefined for undefined input', () => {
    expect(getJiraIssue(undefined, 'ABC')).toBeUndefined()
  })
  it('respects prefix', () => {
    expect(getJiraIssue('XYZ-123 and ABC-456', 'ABC')).toBe('ABC-456')
  })
})

describe('getClockodoDateFormat', () => {
  it('formats a date string to yyyy-MM-ddT00:00:00Z', () => {
    expect(getClockodoDateFormat('2026-04-18')).toBe('2026-04-18T00:00:00Z')
  })
  it('formats a Date object', () => {
    expect(getClockodoDateFormat(new Date('2026-01-15T12:00:00Z'))).toBe(
      '2026-01-15T00:00:00Z'
    )
  })
})

describe('computeTopUps', () => {
  it('computes paidHours, clientHours, wepHours with no wep share', () => {
    const [result] = computeTopUps([
      buildTopUp({ amount: 1000, hourlyRate: 100, wepPercentage: 0 })
    ])
    expect(result).toBeDefined()
    expect(result!.paidHours).toBe(10)
    expect(result!.clientHours).toBe(10)
    expect(result!.wepHours).toBe(0)
  })

  it('splits hours by wepPercentage', () => {
    const [result] = computeTopUps([
      buildTopUp({ amount: 1000, hourlyRate: 100, wepPercentage: 20 })
    ])
    expect(result!.paidHours).toBe(10)
    expect(result!.clientHours).toBe(8)
    expect(result!.wepHours).toBe(2)
  })

  it('rounds paidHours to nearest half hour', () => {
    const [result] = computeTopUps([
      buildTopUp({ amount: 125, hourlyRate: 100, wepPercentage: 0 })
    ])
    expect(result!.paidHours).toBe(1.5)
  })

  it('rounds clientHours to nearest quarter', () => {
    const [result] = computeTopUps([
      buildTopUp({ amount: 1000, hourlyRate: 100, wepPercentage: 33 })
    ])
    expect(result!.paidHours).toBe(10)
    expect(result!.clientHours).toBe(6.75)
    expect(result!.wepHours).toBeCloseTo(3.25, 5)
  })

  it('handles null amount as 0', () => {
    const [result] = computeTopUps([
      buildTopUp({ amount: null, hourlyRate: 100 })
    ])
    expect(result!.paidHours).toBe(0)
    expect(result!.clientHours).toBe(0)
    expect(result!.wepHours).toBe(0)
  })
})

describe('getBillableAndNonBillableHours', () => {
  it('returns zeros for empty groups', () => {
    expect(getBillableAndNonBillableHours([])).toEqual({
      billableHours: 0,
      nonBillableHours: 0
    })
  })

  it('uses raw duration when billability is absent', () => {
    const groups = [
      buildEntryGroup({ duration: 2 * SECONDS_PER_HOUR }),
      buildEntryGroup({ duration: 3 * SECONDS_PER_HOUR })
    ]
    expect(getBillableAndNonBillableHours(groups)).toEqual({
      billableHours: 5,
      nonBillableHours: 0
    })
  })

  it('uses billability.billableTotal and billablePart when present', () => {
    const groups = [
      buildEntryGroup({
        duration: 99999,
        billability: {
          durationJira: 0,
          durationPast: 0,
          jiraAvailable: 0,
          durationCurrent: 0,
          billableDirect: 0,
          billablePart: 1 * SECONDS_PER_HOUR,
          billableTotal: 4 * SECONDS_PER_HOUR
        }
      })
    ]
    expect(getBillableAndNonBillableHours(groups)).toEqual({
      billableHours: 4,
      nonBillableHours: 1
    })
  })

  it('rounds to quarters', () => {
    const groups = [buildEntryGroup({ duration: 0.3 * SECONDS_PER_HOUR })]
    expect(getBillableAndNonBillableHours(groups)).toEqual({
      billableHours: 0.25,
      nonBillableHours: 0
    })
  })
})

describe('decorateBillability', () => {
  it('no estimation -> all duration is billableDirect', () => {
    const jiraGroup = buildEntryGroup({
      sub_groups: [buildEntryGroup({ duration: 3 * SECONDS_PER_HOUR })]
    })
    decorateBillability(jiraGroup)

    const issue = jiraGroup.sub_groups[0]!
    expect(issue.billability).toEqual({
      durationJira: 0,
      durationPast: 0,
      jiraAvailable: 0,
      durationCurrent: 3 * SECONDS_PER_HOUR,
      billableDirect: 3 * SECONDS_PER_HOUR,
      billablePart: 0,
      billableTotal: 3 * SECONDS_PER_HOUR
    })
  })

  it('estimation, current below available -> all billableDirect', () => {
    const jiraGroup = buildEntryGroup({
      sub_groups: [
        buildEntryGroup({
          duration: 2 * SECONDS_PER_HOUR,
          jiraIssue: buildJiraIssue('5')
        })
      ]
    })
    decorateBillability(jiraGroup)

    const billability = jiraGroup.sub_groups[0]!.billability!
    expect(billability.durationJira).toBe(5 * SECONDS_PER_HOUR)
    expect(billability.jiraAvailable).toBe(5 * SECONDS_PER_HOUR)
    expect(billability.billableDirect).toBe(2 * SECONDS_PER_HOUR)
    expect(billability.billablePart).toBe(0)
    expect(billability.billableTotal).toBe(2 * SECONDS_PER_HOUR)
  })

  it('estimation, current above available, no past -> split', () => {
    const jiraGroup = buildEntryGroup({
      sub_groups: [
        buildEntryGroup({
          duration: 10 * SECONDS_PER_HOUR,
          jiraIssue: buildJiraIssue('5')
        })
      ]
    })
    decorateBillability(jiraGroup)

    const billability = jiraGroup.sub_groups[0]!.billability!
    expect(billability.jiraAvailable).toBe(5 * SECONDS_PER_HOUR)
    expect(billability.billableDirect).toBe(5 * SECONDS_PER_HOUR)
    expect(billability.billablePart).toBe(
      5 * SECONDS_PER_HOUR * BILLABLE_PART_WEP
    )
    expect(billability.billableTotal).toBe(
      5 * SECONDS_PER_HOUR + 5 * SECONDS_PER_HOUR * BILLABLE_PART_WEP
    )
  })

  it('estimation, past already exceeds jira -> jiraAvailable negative -> all current is partial', () => {
    const jiraGroup = buildEntryGroup({
      sub_groups: [
        buildEntryGroup({
          duration: 4 * SECONDS_PER_HOUR,
          jiraIssue: buildJiraIssue('5'),
          pastEntryGroup: buildEntryGroup({
            duration: 8 * SECONDS_PER_HOUR
          })
        })
      ]
    })
    decorateBillability(jiraGroup)

    const billability = jiraGroup.sub_groups[0]!.billability!
    expect(billability.durationPast).toBe(8 * SECONDS_PER_HOUR)
    expect(billability.jiraAvailable).toBe(-3 * SECONDS_PER_HOUR)
    expect(billability.billableDirect).toBe(0)
    expect(billability.billablePart).toBe(
      4 * SECONDS_PER_HOUR * BILLABLE_PART_WEP
    )
  })

  it('aggregates totals across sub_groups', () => {
    const jiraGroup = buildEntryGroup({
      sub_groups: [
        buildEntryGroup({
          duration: 2 * SECONDS_PER_HOUR,
          jiraIssue: buildJiraIssue('5')
        }),
        buildEntryGroup({
          duration: 10 * SECONDS_PER_HOUR,
          jiraIssue: buildJiraIssue('5')
        })
      ]
    })
    decorateBillability(jiraGroup)

    expect(jiraGroup.billability!.durationJira).toBe(10 * SECONDS_PER_HOUR)
    expect(jiraGroup.billability!.durationCurrent).toBe(12 * SECONDS_PER_HOUR)
    expect(jiraGroup.billability!.billableDirect).toBe(7 * SECONDS_PER_HOUR)
    expect(jiraGroup.billability!.billablePart).toBe(
      5 * SECONDS_PER_HOUR * BILLABLE_PART_WEP
    )
  })
})

describe('mergeSameJiraIssues', () => {
  it('merges two sub groups with the same key and renames them', () => {
    const jiraGroup = buildEntryGroup({
      sub_groups: [
        buildEntryGroup({
          name: 'ABC-1 some description',
          duration: 100,
          revenue: 50,
          sub_groups: [buildEntryGroup({ name: 'entry-a' })]
        }),
        buildEntryGroup({
          name: 'ABC-1 different description',
          duration: 200,
          revenue: 75,
          sub_groups: [buildEntryGroup({ name: 'entry-b' })]
        })
      ]
    })
    mergeSameJiraIssues(jiraGroup, 'ABC')

    expect(jiraGroup.sub_groups).toHaveLength(1)
    const merged = jiraGroup.sub_groups[0]!
    expect(merged.name).toBe('ABC-1')
    expect(merged.duration).toBe(300)
    expect(merged.revenue).toBe(125)
    expect(merged.sub_groups).toHaveLength(2)
  })

  it('keeps distinct keys separate', () => {
    const jiraGroup = buildEntryGroup({
      sub_groups: [
        buildEntryGroup({ name: 'ABC-1 first', duration: 100 }),
        buildEntryGroup({ name: 'ABC-2 second', duration: 200 })
      ]
    })
    mergeSameJiraIssues(jiraGroup, 'ABC')

    expect(jiraGroup.sub_groups).toHaveLength(2)
    expect(jiraGroup.sub_groups.map((g) => g.name)).toEqual(['ABC-1', 'ABC-2'])
  })

  it('keeps sub groups without a jira key, leaving their name intact', () => {
    const jiraGroup = buildEntryGroup({
      sub_groups: [
        buildEntryGroup({ name: 'no-key-here', duration: 42 }),
        buildEntryGroup({ name: 'ABC-1 real', duration: 100 })
      ]
    })
    mergeSameJiraIssues(jiraGroup, 'ABC')

    expect(jiraGroup.sub_groups).toHaveLength(2)
    expect(jiraGroup.sub_groups[0]!.name).toBe('no-key-here')
    expect(jiraGroup.sub_groups[1]!.name).toBe('ABC-1')
  })
})

describe('findJiraEntryGroup', () => {
  it('finds the group with the jira issue group id', () => {
    const entries: EntryGroups = {
      groups: [
        buildEntryGroup({ group: '999' }),
        buildEntryGroup({ group: '1100301', name: 'jira' })
      ]
    }
    expect(findJiraEntryGroup(entries)?.name).toBe('jira')
  })

  it('returns undefined when not found', () => {
    const entries: EntryGroups = { groups: [buildEntryGroup({ group: '1' })] }
    expect(findJiraEntryGroup(entries)).toBeUndefined()
  })
})

describe('computeEntryGroups', () => {
  const manualWorkEntry = (hours: number | null): ManualWorkEntry => ({
    clientPeriod: null,
    date: null,
    date_created: null,
    date_updated: null,
    description: null,
    hours,
    id: 'mw-1',
    sort: null,
    status: 'published',
    title: null,
    user_created: null,
    user_updated: null
  })

  it('sums up billable, manual, topUps and percentages', () => {
    const groups: EntryGroups = {
      groups: [buildEntryGroup({ duration: 4 * SECONDS_PER_HOUR })]
    }
    const topUps = [
      buildTopUp({ amount: 1000, hourlyRate: 100, wepPercentage: 0 })
    ]
    const manual = [manualWorkEntry(1)]

    const result = computeEntryGroups(groups, topUps, manual)

    expect(result.sums.billableHours).toBe(4)
    expect(result.sums.totalManualWorkHours).toBe(1)
    expect(result.sums.totalTopUps).toBe(10)
    expect(result.sums.totalUsedHours).toBe(5)
    expect(result.sums.totalAvailableHours).toBe(5)
    expect(result.sums.totalUsedPercentage).toBe(50)
  })

  it('returns percentage 0 when totalTopUps is zero (divide-by-zero fallback)', () => {
    const groups: EntryGroups = { groups: [] }
    const result = computeEntryGroups(groups, [], [])
    expect(result.sums.totalTopUps).toBe(0)
    expect(result.sums.totalUsedPercentage).toBe(0)
  })

  it('returns percentage 0 (not Infinity) when used hours > 0 but topUps is zero (monthly-billing)', () => {
    const groups: EntryGroups = {
      groups: [buildEntryGroup({ duration: 4 * SECONDS_PER_HOUR })]
    }
    // No top-ups — classic monthly-billing setup where the client gets billed
    // for whatever was logged. The percentage is undefined as a real number;
    // we report 0 so the typed snapshot column stays integer-clean.
    const result = computeEntryGroups(groups, [], [])
    expect(result.sums.totalTopUps).toBe(0)
    expect(result.sums.totalUsedHours).toBe(4)
    expect(result.sums.totalUsedPercentage).toBe(0)
    expect(Number.isFinite(result.sums.totalUsedPercentage)).toBe(true)
  })

  it('passes manual entries with string hours through parseFloat', () => {
    const groups: EntryGroups = { groups: [] }
    const manual = [manualWorkEntry('2.5' as unknown as number)]
    const result = computeEntryGroups(groups, [], manual)
    expect(result.sums.totalManualWorkHours).toBe(2.5)
  })

  it('ignores nullish manual hours', () => {
    const groups: EntryGroups = { groups: [] }
    const manual = [manualWorkEntry(null)]
    const result = computeEntryGroups(groups, [], manual)
    expect(result.sums.totalManualWorkHours).toBe(0)
  })
})

describe('hosting invoices never affect available hours (regression guard)', () => {
  it('does not pull the order-backed Invoices collection into the hours fetch', () => {
    // Hosting / order-backed invoices live in the separate `Invoices`
    // collection and must NEVER be summed into available hours. The available-
    // hours endpoint fetches only these relations of a client period.
    expect(
      AGGREGATED_HOURS_CLIENT_PERIOD_FIELDS.some((field) =>
        /invoice/i.test(field)
      )
    ).toBe(false)
    // …and it still pulls the hour-counting top-ups it depends on.
    expect(AGGREGATED_HOURS_CLIENT_PERIOD_FIELDS).toContain('topUps.*')
  })

  it('computes top-ups purely from amount/hourlyRate/wepPercentage, ignoring any hosting-style fields', () => {
    // A row carrying hosting-only fields (unitPrice/billedUnits/type) must not
    // be treated specially — only amount/hourlyRate/wepPercentage drive hours.
    const hostingShaped = buildTopUp({
      amount: 1000,
      hourlyRate: 100,
      wepPercentage: 0
    }) as TopUp & { unitPrice: number; billedUnits: number; type: string }
    hostingShaped.unitPrice = 390
    hostingShaped.billedUnits = 7
    hostingShaped.type = 'hosting'

    const [result] = computeTopUps([hostingShaped])
    // 1000 / 100 = 10 paid hours, 0% wep → 10 client hours. Extra fields ignored.
    expect(result.paidHours).toBe(10)
    expect(result.clientHours).toBe(10)
  })
})
