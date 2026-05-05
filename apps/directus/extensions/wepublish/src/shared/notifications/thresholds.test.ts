import { describe, expect, it } from 'vitest'
import type { JiraWarning, NotificationThreshold } from '../../DirectusTypes'
import {
  computePendingWarnings,
  highestCrossedThreshold,
  initialThresholdForEstimate,
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
    initial_threshold_offset_hours: 0,
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
      initial_threshold_offset_hours: 0.75,
      recurring_threshold_hours: 1
    }),
    buildConfig({
      id: 'one',
      min_hours_inclusive: 1,
      initial_threshold_offset_hours: 1,
      recurring_threshold_hours: 1
    }),
    buildConfig({
      id: 'ten',
      min_hours_inclusive: 10,
      initial_threshold_offset_hours: -1,
      recurring_threshold_hours: 4
    })
  ]

  it('returns null when the estimate is smaller than every bound', () => {
    expect(selectThresholdForHours(0.1, configs)).toBeNull()
  })

  it('matches the boundary itself (inclusive)', () => {
    expect(selectThresholdForHours(0.25, configs)?.initialOffsetHours).toBe(
      0.75
    )
    expect(selectThresholdForHours(1, configs)?.initialOffsetHours).toBe(1)
    expect(selectThresholdForHours(10, configs)?.initialOffsetHours).toBe(-1)
  })

  it('returns the 0.25 schedule for tiny in-between estimates', () => {
    expect(selectThresholdForHours(0.5, configs)).toEqual({
      initialOffsetHours: 0.75,
      recurringHours: 1
    })
  })

  it('steps to the next bucket once the bound is crossed', () => {
    expect(selectThresholdForHours(1.01, configs)?.initialOffsetHours).toBe(1)
  })

  it('selects the largest-bound bucket for big estimates', () => {
    expect(selectThresholdForHours(100, configs)).toEqual({
      initialOffsetHours: -1,
      recurringHours: 4
    })
  })

  it('works regardless of config order', () => {
    const reversed = [...configs].reverse()
    expect(selectThresholdForHours(20, reversed)?.initialOffsetHours).toBe(-1)
  })

  it('ignores configs whose recurring step is not positive', () => {
    const broken = [
      buildConfig({
        min_hours_inclusive: 0,
        initial_threshold_offset_hours: 1,
        recurring_threshold_hours: 0
      })
    ]
    expect(selectThresholdForHours(5, broken)).toBeNull()
  })

  it('accepts negative offsets as a valid early-warning configuration', () => {
    const early = [
      buildConfig({
        min_hours_inclusive: 5,
        initial_threshold_offset_hours: -2,
        recurring_threshold_hours: 2
      })
    ]
    expect(selectThresholdForHours(5, early)?.initialOffsetHours).toBe(-2)
  })
})

describe('initialThresholdForEstimate', () => {
  it('adds the signed offset to the estimate', () => {
    expect(
      initialThresholdForEstimate(9, {
        initialOffsetHours: 2,
        recurringHours: 4
      })
    ).toBe(11)
    expect(
      initialThresholdForEstimate(13, {
        initialOffsetHours: -2,
        recurringHours: 4
      })
    ).toBe(11)
  })

  it('coerces stringified numbers from Postgres', () => {
    expect(
      initialThresholdForEstimate(9 as unknown as number, {
        initialOffsetHours: '2' as unknown as number,
        recurringHours: 4
      })
    ).toBe(11)
  })
})

describe('highestCrossedThreshold', () => {
  // Estimate 9 h, offset 0, recurring 4 h → 9, 13, 17, 21, …
  const schedule: ThresholdSchedule = {
    initialOffsetHours: 0,
    recurringHours: 4
  }

  it('null when below the initial threshold (estimate + offset)', () => {
    expect(highestCrossedThreshold(8.99, 9, schedule)).toBeNull()
  })

  it('returns the initial threshold when met exactly', () => {
    expect(highestCrossedThreshold(9, 9, schedule)).toBe(9)
  })

  it('stays on the initial threshold until the first recurring step', () => {
    expect(highestCrossedThreshold(12.99, 9, schedule)).toBe(9)
    expect(highestCrossedThreshold(13, 9, schedule)).toBe(13)
  })

  it('walks the arithmetic progression without an upper bound', () => {
    expect(highestCrossedThreshold(17.5, 9, schedule)).toBe(17)
    expect(highestCrossedThreshold(21, 9, schedule)).toBe(21)
    expect(highestCrossedThreshold(100, 9, schedule)).toBe(97) // 9 + 22·4
  })

  it('shifts the entire progression with the estimate (fairness across bucket)', () => {
    // Bucket [5, 10) with offset +2, recurring 4
    const fair: ThresholdSchedule = {
      initialOffsetHours: 2,
      recurringHours: 4
    }
    // Estimate 5 → first warn at 7, next at 11
    expect(highestCrossedThreshold(7, 5, fair)).toBe(7)
    expect(highestCrossedThreshold(11, 5, fair)).toBe(11)
    // Estimate 9 → first warn at 11, next at 15 (no longer fires "too early")
    expect(highestCrossedThreshold(7, 9, fair)).toBeNull()
    expect(highestCrossedThreshold(11, 9, fair)).toBe(11)
    expect(highestCrossedThreshold(15, 9, fair)).toBe(15)
  })

  it('supports negative offsets (early warning before the estimate)', () => {
    const early: ThresholdSchedule = {
      initialOffsetHours: -1,
      recurringHours: 2
    }
    // Estimate 5 → first warn at 4
    expect(highestCrossedThreshold(3.99, 5, early)).toBeNull()
    expect(highestCrossedThreshold(4, 5, early)).toBe(4)
    expect(highestCrossedThreshold(6, 5, early)).toBe(6)
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
  // Bucket "small" applies to estimates 0..9.99h with offset 0 and step 1.
  // Bucket "medium" applies to estimates ≥10h with offset 0 and step 4.
  const smallBucket = buildConfig({
    id: 'small',
    min_hours_inclusive: 0,
    initial_threshold_offset_hours: 0,
    recurring_threshold_hours: 1
  })
  const mediumBucket = buildConfig({
    id: 'medium',
    min_hours_inclusive: 10,
    initial_threshold_offset_hours: 0,
    recurring_threshold_hours: 4
  })
  const configs = [smallBucket, mediumBucket]

  it('skips issues with no estimation', () => {
    const result = computePendingWarnings({
      issues: [
        { jiraIssueKey: 'ABC-1', estimatedHours: 0, totalHoursUsed: 5 },
        { jiraIssueKey: 'ABC-2', estimatedHours: 15, totalHoursUsed: 15 }
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
        initial_threshold_offset_hours: -1,
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
        { jiraIssueKey: 'ABC-2', estimatedHours: 15, totalHoursUsed: 14.99 }
      ],
      thresholdConfigs: configs,
      warningsByKey: new Map()
    })
    expect(result).toHaveLength(0)
  })

  it('notifies a fresh issue that reached the initial threshold', () => {
    const result = computePendingWarnings({
      issues: [
        { jiraIssueKey: 'ABC-2', estimatedHours: 15, totalHoursUsed: 15 }
      ],
      thresholdConfigs: configs,
      warningsByKey: new Map()
    })
    expect(result).toEqual([
      {
        jiraIssueKey: 'ABC-2',
        estimatedHours: 15,
        totalHoursUsed: 15,
        usedPercent: 100,
        initialThresholdHours: 15,
        crossedThresholdHours: 15,
        nextThresholdHours: 19
      }
    ])
  })

  it('treats every ticket fairly across the bucket via offset', () => {
    // Bucket [5, 10) with offset -1 and recurring 2.
    // Estimate 5 → first warn at 4. Estimate 9 → first warn at 8.
    const fairConfigs = [
      buildConfig({
        min_hours_inclusive: 5,
        initial_threshold_offset_hours: -1,
        recurring_threshold_hours: 2
      })
    ]
    const result = computePendingWarnings({
      issues: [
        { jiraIssueKey: 'SMALL', estimatedHours: 5, totalHoursUsed: 4 },
        { jiraIssueKey: 'BIG', estimatedHours: 9, totalHoursUsed: 4 }
      ],
      thresholdConfigs: fairConfigs,
      warningsByKey: new Map()
    })
    // Only the small ticket has crossed its (estimate-1)=4h threshold;
    // the big one is still below its 8h threshold.
    expect(result).toHaveLength(1)
    expect(result[0]!.jiraIssueKey).toBe('SMALL')
    expect(result[0]!.initialThresholdHours).toBe(4)
  })

  it('suppresses an issue already notified at the current crossed threshold', () => {
    const warning = buildWarning({
      jira_issue_key: 'ABC-2',
      last_notified_hours: 19
    })
    const result = computePendingWarnings({
      issues: [
        { jiraIssueKey: 'ABC-2', estimatedHours: 15, totalHoursUsed: 19 }
      ],
      thresholdConfigs: configs,
      warningsByKey: new Map([['ABC-2', warning]])
    })
    expect(result).toHaveLength(0)
  })

  it('re-fires at the next recurring step after the previous notification', () => {
    const prior = buildWarning({
      jira_issue_key: 'ABC-2',
      last_notified_hours: 19
    })
    const result = computePendingWarnings({
      issues: [
        { jiraIssueKey: 'ABC-2', estimatedHours: 15, totalHoursUsed: 23 }
      ],
      thresholdConfigs: configs,
      warningsByKey: new Map([['ABC-2', prior]])
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.crossedThresholdHours).toBe(23)
    expect(result[0]!.nextThresholdHours).toBe(27)
    expect(result[0]!.initialThresholdHours).toBe(15)
  })

  it('tolerates Postgres returning numeric columns as strings', () => {
    // Directus / pg returns `decimal` columns as strings, so every math
    // helper must coerce them. This test uses deliberately stringified
    // values to lock that contract in.
    const stringConfigs: NotificationThreshold[] = [
      buildConfig({
        id: 'stringly',
        min_hours_inclusive: '10' as unknown as number,
        initial_threshold_offset_hours: '0' as unknown as number,
        recurring_threshold_hours: '4' as unknown as number
      })
    ]
    const result = computePendingWarnings({
      issues: [
        {
          jiraIssueKey: 'ABC-9',
          estimatedHours: '15' as unknown as number,
          totalHoursUsed: '23' as unknown as number
        }
      ],
      thresholdConfigs: stringConfigs,
      warningsByKey: new Map()
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.crossedThresholdHours).toBe(23)
    expect(result[0]!.nextThresholdHours).toBe(27)
    expect(result[0]!.initialThresholdHours).toBe(15)
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
