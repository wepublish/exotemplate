import { describe, expect, it } from 'vitest'
import type { JiraWarning, NotificationThreshold } from '../../DirectusTypes'
import {
  computePendingWarnings,
  highestCrossedThreshold,
  isClientPaused,
  percentUsed,
  selectThresholdForHours,
  shouldNotify,
  type ThresholdSchedule
} from './thresholds'

function buildConfig(
  overrides: Partial<NotificationThreshold>
): NotificationThreshold {
  return {
    id: 'cfg',
    status: 'published',
    sort: null,
    date_created: null,
    date_updated: null,
    user_created: null,
    user_updated: null,
    min_hours_inclusive: 0,
    initial_threshold_hours: 1,
    recurring_threshold_hours: 1,
    ...overrides
  }
}

function buildWarning(overrides: Partial<JiraWarning>): JiraWarning {
  return {
    id: 'w',
    status: 'published',
    sort: null,
    date_created: null,
    date_updated: null,
    user_created: null,
    user_updated: null,
    client: null,
    jira_issue_key: 'ABC-1',
    last_notified_hours: null,
    next_threshold_hours: null,
    halt_requested: false,
    halt_requested_by: null,
    halt_requested_at: null,
    halt_resolved_by: null,
    halt_resolved_at: null,
    silenced_permanently: false,
    silenced_by: null,
    silenced_at: null,
    ...overrides
  }
}

describe('selectThresholdForHours', () => {
  const configs = [
    buildConfig({
      id: 'quarter',
      min_hours_inclusive: 0.25,
      initial_threshold_hours: 1,
      recurring_threshold_hours: 1
    }),
    buildConfig({
      id: 'one',
      min_hours_inclusive: 1,
      initial_threshold_hours: 2,
      recurring_threshold_hours: 1
    }),
    buildConfig({
      id: 'ten',
      min_hours_inclusive: 10,
      initial_threshold_hours: 9,
      recurring_threshold_hours: 4
    })
  ]

  it('returns null when the estimate is smaller than every bound', () => {
    expect(selectThresholdForHours(0.1, configs)).toBeNull()
  })

  it('matches the boundary itself (inclusive)', () => {
    expect(selectThresholdForHours(0.25, configs)?.initialHours).toBe(1)
    expect(selectThresholdForHours(1, configs)?.initialHours).toBe(2)
    expect(selectThresholdForHours(10, configs)?.initialHours).toBe(9)
  })

  it('returns the 0.25 schedule for tiny in-between estimates', () => {
    expect(selectThresholdForHours(0.5, configs)).toEqual({
      initialHours: 1,
      recurringHours: 1
    })
  })

  it('steps to the next bucket once the bound is crossed', () => {
    expect(selectThresholdForHours(1.01, configs)?.initialHours).toBe(2)
  })

  it('selects the largest-bound bucket for big estimates', () => {
    expect(selectThresholdForHours(100, configs)).toEqual({
      initialHours: 9,
      recurringHours: 4
    })
  })

  it('works regardless of config order', () => {
    const reversed = [...configs].reverse()
    expect(selectThresholdForHours(20, reversed)?.initialHours).toBe(9)
  })

  it('ignores configs whose recurring step is not positive', () => {
    const broken = [
      buildConfig({
        min_hours_inclusive: 0,
        initial_threshold_hours: 1,
        recurring_threshold_hours: 0
      })
    ]
    expect(selectThresholdForHours(5, broken)).toBeNull()
  })
})

describe('highestCrossedThreshold', () => {
  const schedule: ThresholdSchedule = {
    initialHours: 9,
    recurringHours: 4
  }

  it('null when below the initial threshold', () => {
    expect(highestCrossedThreshold(8.99, schedule)).toBeNull()
  })

  it('returns the initial threshold when met exactly', () => {
    expect(highestCrossedThreshold(9, schedule)).toBe(9)
  })

  it('stays on the initial threshold until the first recurring step', () => {
    expect(highestCrossedThreshold(12.99, schedule)).toBe(9)
    expect(highestCrossedThreshold(13, schedule)).toBe(13)
  })

  it('walks the arithmetic progression without an upper bound', () => {
    expect(highestCrossedThreshold(17.5, schedule)).toBe(17)
    expect(highestCrossedThreshold(21, schedule)).toBe(21)
    expect(highestCrossedThreshold(100, schedule)).toBe(97) // 9 + 22·4
  })
})

describe('shouldNotify', () => {
  it('does not notify when no threshold crossed', () => {
    expect(shouldNotify(null, null)).toBe(false)
  })
  it('notifies when no prior warning exists', () => {
    expect(shouldNotify(9, null)).toBe(true)
  })
  it('does not notify when permanently silenced', () => {
    expect(shouldNotify(13, buildWarning({ silenced_permanently: true }))).toBe(
      false
    )
  })
  it('does not notify when crossed equals last notified', () => {
    expect(shouldNotify(13, buildWarning({ last_notified_hours: 13 }))).toBe(
      false
    )
  })
  it('notifies when crossed above last notified', () => {
    expect(shouldNotify(17, buildWarning({ last_notified_hours: 13 }))).toBe(
      true
    )
  })
})

describe('percentUsed', () => {
  it('rounds to nearest integer', () => {
    expect(percentUsed(1.5, 2)).toBe(75)
    expect(percentUsed(2, 3)).toBe(67)
  })
  it('returns 0 for zero estimate', () => {
    expect(percentUsed(5, 0)).toBe(0)
  })
})

describe('isClientPaused', () => {
  it('false for null/undefined', () => {
    expect(isClientPaused(null)).toBe(false)
    expect(isClientPaused(undefined)).toBe(false)
  })
  it('false when flag is false', () => {
    expect(isClientPaused(false)).toBe(false)
  })
  it('true when flag is true', () => {
    expect(isClientPaused(true)).toBe(true)
  })
})

describe('computePendingWarnings', () => {
  const smallBucket = buildConfig({
    id: 'small',
    min_hours_inclusive: 0,
    initial_threshold_hours: 2,
    recurring_threshold_hours: 1
  })
  const mediumBucket = buildConfig({
    id: 'medium',
    min_hours_inclusive: 10,
    initial_threshold_hours: 9,
    recurring_threshold_hours: 4
  })
  const configs = [smallBucket, mediumBucket]

  it('skips issues with no estimation', () => {
    const result = computePendingWarnings({
      issues: [
        { jiraIssueKey: 'ABC-1', estimatedHours: 0, totalHoursUsed: 5 },
        { jiraIssueKey: 'ABC-2', estimatedHours: 15, totalHoursUsed: 14 }
      ],
      thresholdConfigs: configs,
      warningsByKey: new Map()
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.jiraIssueKey).toBe('ABC-2')
  })

  it('skips issues whose hours do not fit any bucket', () => {
    const strictConfigs = [
      buildConfig({
        min_hours_inclusive: 5,
        initial_threshold_hours: 4,
        recurring_threshold_hours: 1
      })
    ]
    const result = computePendingWarnings({
      issues: [
        { jiraIssueKey: 'ABC-1', estimatedHours: 3, totalHoursUsed: 10 }
      ],
      thresholdConfigs: strictConfigs,
      warningsByKey: new Map()
    })
    expect(result).toHaveLength(0)
  })

  it('skips issues below their initial threshold', () => {
    const result = computePendingWarnings({
      issues: [
        { jiraIssueKey: 'ABC-2', estimatedHours: 15, totalHoursUsed: 8 }
      ],
      thresholdConfigs: configs,
      warningsByKey: new Map()
    })
    expect(result).toHaveLength(0)
  })

  it('notifies a fresh issue that reached the initial threshold', () => {
    const result = computePendingWarnings({
      issues: [
        { jiraIssueKey: 'ABC-2', estimatedHours: 15, totalHoursUsed: 9 }
      ],
      thresholdConfigs: configs,
      warningsByKey: new Map()
    })
    expect(result).toEqual([
      {
        jiraIssueKey: 'ABC-2',
        estimatedHours: 15,
        totalHoursUsed: 9,
        usedPercent: 60,
        crossedThresholdHours: 9,
        nextThresholdHours: 13
      }
    ])
  })

  it('suppresses an issue already notified at the current crossed threshold', () => {
    const warning = buildWarning({
      jira_issue_key: 'ABC-2',
      last_notified_hours: 13
    })
    const result = computePendingWarnings({
      issues: [
        { jiraIssueKey: 'ABC-2', estimatedHours: 15, totalHoursUsed: 13 }
      ],
      thresholdConfigs: configs,
      warningsByKey: new Map([['ABC-2', warning]])
    })
    expect(result).toHaveLength(0)
  })

  it('re-fires at the next recurring step after the previous notification', () => {
    const prior = buildWarning({
      jira_issue_key: 'ABC-2',
      last_notified_hours: 13
    })
    const result = computePendingWarnings({
      issues: [
        { jiraIssueKey: 'ABC-2', estimatedHours: 15, totalHoursUsed: 17 }
      ],
      thresholdConfigs: configs,
      warningsByKey: new Map([['ABC-2', prior]])
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.crossedThresholdHours).toBe(17)
    expect(result[0]!.nextThresholdHours).toBe(21)
  })

  it('tolerates Postgres returning numeric columns as strings', () => {
    // Directus / pg returns `decimal` columns as strings, so every math
    // helper must coerce them. This test uses deliberately stringified
    // values to lock that contract in.
    const stringConfigs: NotificationThreshold[] = [
      buildConfig({
        id: 'stringly',
        min_hours_inclusive: '10' as unknown as number,
        initial_threshold_hours: '9' as unknown as number,
        recurring_threshold_hours: '4' as unknown as number
      })
    ]
    const result = computePendingWarnings({
      issues: [
        {
          jiraIssueKey: 'ABC-9',
          estimatedHours: '15' as unknown as number,
          totalHoursUsed: '17' as unknown as number
        }
      ],
      thresholdConfigs: stringConfigs,
      warningsByKey: new Map()
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.crossedThresholdHours).toBe(17)
    expect(result[0]!.nextThresholdHours).toBe(21)
  })

  it('respects permanent silence regardless of usage', () => {
    const silenced = buildWarning({
      jira_issue_key: 'ABC-1',
      silenced_permanently: true
    })
    const result = computePendingWarnings({
      issues: [
        { jiraIssueKey: 'ABC-1', estimatedHours: 5, totalHoursUsed: 50 }
      ],
      thresholdConfigs: configs,
      warningsByKey: new Map([['ABC-1', silenced]])
    })
    expect(result).toHaveLength(0)
  })
})
