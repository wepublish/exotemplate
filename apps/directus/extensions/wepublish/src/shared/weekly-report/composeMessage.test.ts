import { describe, expect, it } from 'vitest'
import {
  buildWeeklyReportDashboardUrl,
  composeGermanOverBudgetEscalationMessage,
  composeWeeklyReportMessage
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
  it('links to the period dashboard via the path', () => {
    expect(buildWeeklyReportDashboardUrl('https://dash.example.com', 42)).toBe(
      'https://dash.example.com/42/dashboard'
    )
  })

  it('falls back to the root (redirects to the default) with no period', () => {
    expect(
      buildWeeklyReportDashboardUrl('https://dash.example.com//', null)
    ).toBe('https://dash.example.com/')
  })
})

describe('composeWeeklyReportMessage', () => {
  it('uses on-track wording when budget and time match', () => {
    const msg = composeWeeklyReportMessage(baseInput, 1)
    expect(msg.text.toLowerCase()).toContain('budget')
    expect(JSON.stringify(msg)).toContain('Gleichlauf')
  })

  it('uses over-budget wording when status is over_budget', () => {
    const msg = composeWeeklyReportMessage(
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
    const msg = composeWeeklyReportMessage(
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
    const msg = composeWeeklyReportMessage(baseInput, 7)
    const serialised = JSON.stringify(msg)
    expect(serialised).toContain('https://dash.example.com/7/dashboard')
  })

  it('renders the no_budget case without the misleading budget bar', () => {
    const msg = composeWeeklyReportMessage(
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
    const msg = composeWeeklyReportMessage(
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
    expect(serialised).toContain('https://dash.example.com/3/dashboard')
  })

  it('monthly: bills the remaining hours (negated available), not totalUsedHours', () => {
    // Bug regression: previously the monthly variant displayed totalUsedHours
    // (total recorded) in both "Aktuell zu verrechnen" and the body. After a
    // partial mid-period invoice (e.g. 10 h already billed via Bexio top-up),
    // we should only surface the still-open delta.
    const msg = composeWeeklyReportMessage(
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
    const msg = composeWeeklyReportMessage(
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
    const msg = composeWeeklyReportMessage(baseInput, 1)
    const serialised = JSON.stringify(msg)
    // existing format must still emit the budget+time bars
    expect(serialised).toContain('Budget:* `')
    expect(serialised).toContain('Zeit:*    `')
    expect(serialised).toContain('Verfügbar')
  })
})

describe('composeWeeklyReportMessage — French and English', () => {
  it('renders the on-track headline and header in French', () => {
    const serialised = JSON.stringify(
      composeWeeklyReportMessage(baseInput, 1, 'fr')
    )
    expect(serialised).toContain('Budget et temps alignés')
    expect(serialised).toContain('Rapport hebdomadaire du projet')
  })

  it('renders the over-budget headline and header in English', () => {
    const serialised = JSON.stringify(
      composeWeeklyReportMessage(
        {
          ...baseInput,
          progress: {
            ...baseProgress,
            status: 'over_budget',
            budgetUsedPercent: 110
          }
        },
        1,
        'en'
      )
    )
    expect(serialised).toContain('Budget exceeded')
    expect(serialised).toContain('Weekly project report')
  })

  it('routes monthly billing to the localized variant (French)', () => {
    const serialised = JSON.stringify(
      composeWeeklyReportMessage(
        {
          ...baseInput,
          billingMode: 'monthly',
          totalTopUpHours: 0,
          totalUsedHours: 23,
          totalAvailableHours: -23
        },
        3,
        'fr'
      )
    )
    expect(serialised).toContain('État de facturation actuel')
  })

  it('defaults to German when no locale is passed', () => {
    expect(JSON.stringify(composeWeeklyReportMessage(baseInput, 1))).toContain(
      'Gleichlauf'
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
