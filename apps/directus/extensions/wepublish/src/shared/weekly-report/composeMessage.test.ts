import { describe, expect, it } from 'vitest'
import {
  buildWeeklyReportDashboardUrl,
  composeGermanOverBudgetEscalationMessage,
  composeGermanWeeklyReportMessage
} from './composeMessage'
import type { WeeklyReportProgress } from './progress'

const baseProgress: WeeklyReportProgress = {
  budgetUsedPercent: 50,
  timeElapsedPercent: 50,
  deltaPercent: 0,
  status: 'on_track',
  daysRemaining: 30,
  periodDurationDays: 60
}

const baseInput = {
  clientName: 'Acme',
  clientId: 'acme',
  periodName: 'Q2 2026',
  periodFromIso: '2026-04-01T00:00:00.000Z',
  periodToIso: '2026-06-30T00:00:00.000Z',
  totalTopUpHours: 100,
  totalUsedHours: 50,
  totalAvailableHours: 50,
  progress: baseProgress,
  dashboardBaseUrl: 'https://dash.example.com',
  billingMode: 'prepaid' as const
}

describe('buildWeeklyReportDashboardUrl', () => {
  it('encodes client and period ids into the dashboard query', () => {
    expect(
      buildWeeklyReportDashboardUrl('https://dash.example.com', 'acme', 42)
    ).toBe('https://dash.example.com/?clientId=acme&clientPeriodId=42')
  })

  it('strips trailing slashes from the base url', () => {
    expect(
      buildWeeklyReportDashboardUrl('https://dash.example.com//', 'acme', null)
    ).toBe('https://dash.example.com/?clientId=acme')
  })
})

describe('composeGermanWeeklyReportMessage', () => {
  it('uses on-track wording when budget and time match', () => {
    const msg = composeGermanWeeklyReportMessage(baseInput, 1)
    expect(msg.text.toLowerCase()).toContain('budget')
    expect(JSON.stringify(msg)).toContain('Gleichlauf')
  })

  it('uses over-budget wording when status is over_budget', () => {
    const msg = composeGermanWeeklyReportMessage(
      {
        ...baseInput,
        progress: {
          ...baseProgress,
          status: 'over_budget',
          budgetUsedPercent: 110
        }
      },
      1
    )
    expect(JSON.stringify(msg)).toContain('Budget überschritten')
    expect(msg.text).toContain('Budget überschritten')
  })

  it('uses close-to-limit wording when at 92 %', () => {
    const msg = composeGermanWeeklyReportMessage(
      {
        ...baseInput,
        progress: {
          ...baseProgress,
          status: 'close_to_limit',
          budgetUsedPercent: 92
        }
      },
      1
    )
    expect(JSON.stringify(msg)).toContain('fast aufgebraucht')
  })

  it('embeds the dashboard link in the action button', () => {
    const msg = composeGermanWeeklyReportMessage(baseInput, 7)
    const serialised = JSON.stringify(msg)
    expect(serialised).toContain(
      'https://dash.example.com/?clientId=acme&clientPeriodId=7'
    )
  })

  it('renders the no_budget case without the misleading budget bar', () => {
    const msg = composeGermanWeeklyReportMessage(
      {
        ...baseInput,
        totalTopUpHours: 0,
        totalUsedHours: 2.5,
        totalAvailableHours: -2.5,
        progress: {
          ...baseProgress,
          status: 'no_budget',
          budgetUsedPercent: 0,
          timeElapsedPercent: 82,
          deltaPercent: -82
        }
      },
      9
    )
    const serialised = JSON.stringify(msg)
    expect(serialised).toContain('Kein Budget hinterlegt')
    expect(serialised).toContain('separat verrechnet')
    expect(serialised).not.toContain('Reichlich Spielraum')
    // bug regression guard: the old wording for ahead_of_schedule must not surface
    expect(serialised).not.toContain('unter Plan')
    expect(msg.text).toContain('kein Top-Up')
  })

  it('routes monthly billing mode to a no-progress-bar variant', () => {
    const msg = composeGermanWeeklyReportMessage(
      {
        ...baseInput,
        billingMode: 'monthly',
        totalTopUpHours: 0,
        totalUsedHours: 23,
        totalAvailableHours: -23
      },
      3
    )
    const serialised = JSON.stringify(msg)
    expect(serialised).toContain('Abrechnungsstand')
    expect(serialised).toContain('monatlich in Rechnung')
    // monthly variant must NOT contain the budget/time bar block
    expect(serialised).not.toContain('Budget:* `')
    expect(serialised).not.toContain('Zeit:*    `')
    // still has the dashboard button
    expect(serialised).toContain(
      'https://dash.example.com/?clientId=acme&clientPeriodId=3'
    )
  })

  it('monthly: bills the remaining hours (negated available), not totalUsedHours', () => {
    // Bug regression: previously the monthly variant displayed totalUsedHours
    // (total recorded) in both "Aktuell zu verrechnen" and the body. After a
    // partial mid-period invoice (e.g. 10 h already billed via Bexio top-up),
    // we should only surface the still-open delta.
    const msg = composeGermanWeeklyReportMessage(
      {
        ...baseInput,
        billingMode: 'monthly',
        totalTopUpHours: 10, // already invoiced
        totalUsedHours: 23, // recorded so far
        totalAvailableHours: -13 // 13 h still to bill
      },
      4
    )
    const serialised = JSON.stringify(msg)
    expect(serialised).toContain('Aktuell zu verrechnen')
    expect(serialised).toContain('13')
    expect(serialised).not.toContain('23 h erfasst')
    expect(msg.text).toContain('13')
    expect(msg.text).not.toContain('23')
  })

  it('monthly: shows zero / "keine offenen Stunden" when the client is in credit', () => {
    const msg = composeGermanWeeklyReportMessage(
      {
        ...baseInput,
        billingMode: 'monthly',
        totalTopUpHours: 10,
        totalUsedHours: 5,
        totalAvailableHours: 5
      },
      5
    )
    const serialised = JSON.stringify(msg)
    expect(serialised).toContain('keine offenen Stunden')
    // never display a negative billable amount
    expect(serialised).not.toMatch(/-\d/)
  })

  it('keeps the existing prepaid layout for the unchanged on-track case', () => {
    const msg = composeGermanWeeklyReportMessage(baseInput, 1)
    const serialised = JSON.stringify(msg)
    // existing format must still emit the budget+time bars
    expect(serialised).toContain('Budget:* `')
    expect(serialised).toContain('Zeit:*    `')
    expect(serialised).toContain('Verfügbar')
  })
})

describe('composeGermanOverBudgetEscalationMessage', () => {
  it('mentions the project channel when provided', () => {
    const msg = composeGermanOverBudgetEscalationMessage(
      {
        ...baseInput,
        progress: {
          ...baseProgress,
          status: 'over_budget',
          budgetUsedPercent: 120
        },
        slackChannelHint: 'C12345678'
      },
      1
    )
    expect(JSON.stringify(msg)).toContain('<#C12345678>')
  })

  it('omits the channel reference when none is provided', () => {
    const msg = composeGermanOverBudgetEscalationMessage(
      {
        ...baseInput,
        progress: {
          ...baseProgress,
          status: 'over_budget',
          budgetUsedPercent: 120
        },
        slackChannelHint: null
      },
      1
    )
    expect(JSON.stringify(msg)).not.toContain('Projekt-Channel')
  })

  it('always tags the message as a controlling escalation', () => {
    const msg = composeGermanOverBudgetEscalationMessage(
      { ...baseInput, slackChannelHint: null },
      1
    )
    expect(JSON.stringify(msg)).toContain('Controlling-Hinweis')
  })
})
