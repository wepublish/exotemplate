import { describe, expect, it } from 'vitest'
import { flattenUserDailyGroups } from './userDailyHours'

describe('flattenUserDailyGroups', () => {
  it('flattens the (users_id → day) tree and converts duration seconds to hours', () => {
    // Shape mirrors Clockodo's /v2/entrygroups response: snake_case
    // `sub_groups`, `duration` in seconds. The bug this guards against is
    // reading the wrong field names (camelCase or `hours`) and silently
    // returning 0 hours for every user/day pair.
    const input = [
      {
        group: '324568',
        name: 'Michael Scheurer',
        duration: 28800,
        sub_groups: [
          { group: '2026-05-25', duration: 14400 },
          { group: '2026-05-27', duration: 28800 }
        ]
      },
      {
        group: '111',
        duration: 14400,
        sub_groups: [{ group: '2026-05-26', duration: 14400 }]
      }
    ]

    const result = flattenUserDailyGroups(input)

    expect(result).toEqual([
      { usersId: 324568, day: '2026-05-25', hours: 4 },
      { usersId: 324568, day: '2026-05-27', hours: 8 },
      { usersId: 111, day: '2026-05-26', hours: 4 }
    ])
  })

  it('skips groups whose id is not a finite number', () => {
    const input = [
      {
        group: 'not-a-number',
        sub_groups: [{ group: '2026-05-25', duration: 14400 }]
      },
      {
        group: '324568',
        sub_groups: [{ group: '2026-05-25', duration: 14400 }]
      }
    ]
    expect(flattenUserDailyGroups(input)).toEqual([
      { usersId: 324568, day: '2026-05-25', hours: 4 }
    ])
  })

  it('treats a missing duration as 0 hours', () => {
    const input = [
      {
        group: '324568',
        sub_groups: [{ group: '2026-05-25' }]
      }
    ]
    expect(flattenUserDailyGroups(input)).toEqual([
      { usersId: 324568, day: '2026-05-25', hours: 0 }
    ])
  })

  it('returns empty when groups is empty or sub_groups is missing', () => {
    expect(flattenUserDailyGroups([])).toEqual([])
    expect(flattenUserDailyGroups([{ group: '1' }])).toEqual([])
  })
})
