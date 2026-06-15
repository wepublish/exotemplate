import { describe, it, expect } from 'vitest'
import {
  periodsOf,
  newestPeriodId,
  selectDefaultPeriodId
} from '~/utils/clientPeriodDefaults'
import type { Client, ClientPeriod, Period } from '~~/types/DirectusTypes'

function makePeriod(id: string, from: string): Period {
  return {
    date_created: null,
    date_updated: null,
    from,
    id,
    name: `Period ${id}`,
    sort: null,
    status: 'published',
    to: from,
    user_created: null,
    user_updated: null
  }
}

/** `id` is the ClientPeriod (selection) id; `from` drives "newest". */
function makeClientPeriod(id: number, from: string): ClientPeriod {
  return {
    Clients_id: null,
    Periods_id: makePeriod(`p-${id}`, from),
    id,
    manualWorkEntries: [],
    topUps: [],
    invoices: []
  }
}

function makeClient(id: string, periods: ClientPeriod[]): Client {
  return {
    clockodo_customer_id: null,
    date_created: null,
    date_updated: null,
    id,
    jira_short_code: null,
    name: `Client ${id}`,
    sort: null,
    status: 'published',
    user_created: null,
    user_updated: null,
    bexio_contact_id: null,
    apiUrl: null,
    slack_channel_id: null,
    onboarding_current_step: null,
    onboarding_manual_checklist: null,
    notifications_paused: false,
    weekly_report_paused: false,
    billing_mode: 'prepaid' as Client['billing_mode'],
    language: 'de' as Client['language'],
    allowedUsers: [],
    periods,
    articles: [],
    contracts: []
  }
}

describe('periodsOf', () => {
  it('is an empty array for undefined or period-less clients', () => {
    expect(periodsOf(undefined)).toEqual([])
    expect(periodsOf(makeClient('a', []))).toEqual([])
  })
})

describe('newestPeriodId', () => {
  it('is undefined for a client with no periods', () => {
    expect(newestPeriodId(makeClient('a', []))).toBeUndefined()
    expect(newestPeriodId(undefined)).toBeUndefined()
  })

  it('returns the id of the period with the latest `from`', () => {
    const client = makeClient('a', [
      makeClientPeriod(10, '2025-01-01'),
      makeClientPeriod(20, '2026-01-01'),
      makeClientPeriod(30, '2024-01-01')
    ])
    expect(newestPeriodId(client)).toBe(20)
  })
})

describe('selectDefaultPeriodId', () => {
  it('is undefined when there are no clients', () => {
    expect(selectDefaultPeriodId([])).toBeUndefined()
  })

  it('is undefined when no client has any period', () => {
    expect(
      selectDefaultPeriodId([makeClient('a', []), makeClient('b', [])])
    ).toBeUndefined()
  })

  // Regression: the bare `/` root showed a blank page with dead nav links
  // because the first client ("The Conversation") had no periods, so the old
  // `clients[0]`-only logic returned undefined and never redirected.
  it('skips a period-less first client and uses the next client that has one', () => {
    const clients = [
      makeClient('the-conversation', []),
      makeClient('berner-kulturagenda', [makeClientPeriod(42, '2026-01-01')])
    ]
    expect(selectDefaultPeriodId(clients)).toBe(42)
  })

  it('picks the FIRST client that has a period, not a later one', () => {
    const clients = [
      makeClient('a', []),
      makeClient('b', [makeClientPeriod(1, '2025-01-01')]),
      makeClient('c', [makeClientPeriod(2, '2027-01-01')])
    ]
    expect(selectDefaultPeriodId(clients)).toBe(1)
  })

  it('returns the newest period within the chosen client', () => {
    const clients = [
      makeClient('a', [
        makeClientPeriod(5, '2024-06-01'),
        makeClientPeriod(6, '2026-06-01')
      ])
    ]
    expect(selectDefaultPeriodId(clients)).toBe(6)
  })
})
