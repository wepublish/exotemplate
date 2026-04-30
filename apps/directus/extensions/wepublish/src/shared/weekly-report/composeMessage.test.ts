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
  dashboardBaseUrl: 'https://dash.example.com'
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
