import { describe, expect, it } from 'vitest'
import {
  buildWorkLogUrl,
  composeGermanHaltRequestedDmMessage,
  composeGermanHaltRequestedMessage,
  composeGermanHaltResolvedMessage,
  composeGermanWarningMessage
} from './composeMessage'

describe('buildWorkLogUrl', () => {
  it('composes the per-period work-log url with the issue query param', () => {
    expect(buildWorkLogUrl('https://dash.example.com', 42, 'ABC-1')).toBe(
      'https://dash.example.com/42/work-log?issue=ABC-1'
    )
  })

  it('strips trailing slashes from the base url', () => {
    expect(buildWorkLogUrl('https://dash.example.com/', 7, 'ABC-1')).toBe(
      'https://dash.example.com/7/work-log?issue=ABC-1'
    )
  })

  it('encodes the jira issue key', () => {
    expect(buildWorkLogUrl('https://dash.example.com', 1, 'A B-1')).toContain(
      'issue=A+B-1'
    )
  })
})

describe('composeGermanWarningMessage', () => {
  it('uses singular/plural wording based on warning count', () => {
    const single = composeGermanWarningMessage({
      clientName: 'Acme',
      clientPeriodId: 1,
      warnings: [
        {
          jiraIssueKey: 'ABC-1',
          estimatedHours: 5,
          totalHoursUsed: 7,
          usedPercent: 140,
          initialThresholdHours: 7,
          crossedThresholdHours: 7,
          nextThresholdHours: 9
        }
      ],
      dashboardBaseUrl: 'https://dash.example.com'
    })
    expect(single.text).toContain('1 Jira-Ticket hat')

    const many = composeGermanWarningMessage({
      clientName: 'Acme',
      clientPeriodId: 1,
      warnings: [
        {
          jiraIssueKey: 'ABC-1',
          estimatedHours: 5,
          totalHoursUsed: 7,
          usedPercent: 140,
          initialThresholdHours: 7,
          crossedThresholdHours: 7,
          nextThresholdHours: 9
        },
        {
          jiraIssueKey: 'ABC-2',
          estimatedHours: 10,
          totalHoursUsed: 9,
          usedPercent: 90,
          initialThresholdHours: 8,
          crossedThresholdHours: 8,
          nextThresholdHours: 10
        }
      ],
      dashboardBaseUrl: 'https://dash.example.com'
    })
    expect(many.text).toContain('2 Jira-Tickets haben')
  })

  it('renders one section block per warning plus header/divider/footer', () => {
    const msg = composeGermanWarningMessage({
      clientName: 'Acme',
      clientPeriodId: 1,
      warnings: [
        {
          jiraIssueKey: 'ABC-1',
          estimatedHours: 5,
          totalHoursUsed: 7,
          usedPercent: 140,
          initialThresholdHours: 7,
          crossedThresholdHours: 7,
          nextThresholdHours: 9
        },
        {
          jiraIssueKey: 'ABC-2',
          estimatedHours: 10,
          totalHoursUsed: 9,
          usedPercent: 90,
          initialThresholdHours: 8,
          crossedThresholdHours: 8,
          nextThresholdHours: 10
        }
      ],
      dashboardBaseUrl: 'https://dash.example.com'
    })
    // header, section (summary), divider, 2 warning sections, context
    expect(msg.blocks).toHaveLength(6)
    expect(msg.blocks.filter((b) => b.type === 'section')).toHaveLength(3)
  })

  it('shows the initial threshold with its signed offset relative to the estimate', () => {
    const msg = composeGermanWarningMessage({
      clientName: 'Acme',
      clientPeriodId: 1,
      warnings: [
        {
          jiraIssueKey: 'ABC-1',
          estimatedHours: 9,
          totalHoursUsed: 11,
          usedPercent: 122,
          initialThresholdHours: 11,
          crossedThresholdHours: 11,
          nextThresholdHours: 15
        }
      ],
      dashboardBaseUrl: 'https://dash.example.com'
    })
    const serialised = JSON.stringify(msg)
    expect(serialised).toContain('Erste Meldung ab 11 h')
  })

  it('formats a negative offset with the proper minus sign', () => {
    const msg = composeGermanWarningMessage({
      clientName: 'Acme',
      clientPeriodId: 1,
      warnings: [
        {
          jiraIssueKey: 'ABC-1',
          estimatedHours: 5,
          totalHoursUsed: 4,
          usedPercent: 80,
          initialThresholdHours: 4,
          crossedThresholdHours: 4,
          nextThresholdHours: 6
        }
      ],
      dashboardBaseUrl: 'https://dash.example.com'
    })
    const serialised = JSON.stringify(msg)
    expect(serialised).toContain('Schätzung 5 h −1 h')
  })

  it('announces the next threshold in both the block and fallback text', () => {
    const msg = composeGermanWarningMessage({
      clientName: 'Acme',
      clientPeriodId: 1,
      warnings: [
        {
          jiraIssueKey: 'ABC-1',
          estimatedHours: 9,
          totalHoursUsed: 9,
          usedPercent: 100,
          initialThresholdHours: 9,
          crossedThresholdHours: 9,
          nextThresholdHours: 13
        }
      ],
      dashboardBaseUrl: 'https://dash.example.com'
    })
    expect(msg.text).toContain('nächste Meldung ab 13 h')
    const serialised = JSON.stringify(msg)
    expect(serialised).toContain('Nächste Meldung ab 13 h')
  })

  it('puts a per-period work-log link into each warning block', () => {
    const msg = composeGermanWarningMessage({
      clientName: 'Acme',
      clientPeriodId: 99,
      warnings: [
        {
          jiraIssueKey: 'ABC-1',
          estimatedHours: 5,
          totalHoursUsed: 7,
          usedPercent: 140,
          initialThresholdHours: 7,
          crossedThresholdHours: 7,
          nextThresholdHours: 9
        }
      ],
      dashboardBaseUrl: 'https://dash.example.com'
    })
    const serialised = JSON.stringify(msg)
    expect(serialised).toContain(
      'https://dash.example.com/99/work-log?issue=ABC-1'
    )
  })
})

describe('composeGermanHaltRequestedMessage', () => {
  const baseInput = {
    clientName: 'Acme',
    clientPeriodId: 17,
    jiraIssueKey: 'ABC-42',
    actorName: 'Renée Client',
    actorEmail: 'renee@acme.example',
    occurredAtIso: '2026-04-23T12:30:00.000Z',
    dashboardBaseUrl: 'https://dash.example.com'
  }

  it('tells the channel to stop work and links to the per-period work-log page', () => {
    const msg = composeGermanHaltRequestedMessage(baseInput)
    const serialised = JSON.stringify(msg)
    expect(msg.text).toMatch(/stellt die Arbeit/i)
    expect(serialised).toContain('Arbeitsstopp')
    expect(serialised).toContain('Renée Client')
    expect(serialised).toContain(
      'https://dash.example.com/17/work-log?issue=ABC-42'
    )
    expect(serialised).toContain('"danger"')
  })

  it('falls back to email when no name is given', () => {
    const msg = composeGermanHaltRequestedMessage({
      ...baseInput,
      actorName: ''
    })
    expect(msg.text).toContain('renee@acme.example')
  })
})

describe('composeGermanHaltResolvedMessage', () => {
  it('tells the channel they can resume work', () => {
    const msg = composeGermanHaltResolvedMessage({
      clientName: 'Acme',
      clientPeriodId: 17,
      jiraIssueKey: 'ABC-42',
      actorName: 'Renée Client',
      actorEmail: 'renee@acme.example',
      occurredAtIso: '2026-04-23T15:00:00.000Z',
      dashboardBaseUrl: 'https://dash.example.com'
    })
    const serialised = JSON.stringify(msg)
    expect(msg.text).toMatch(/wieder aufgenommen/i)
    expect(serialised).toContain('Arbeitsstopp aufgehoben')
    expect(serialised).toContain(
      'https://dash.example.com/17/work-log?issue=ABC-42'
    )
  })
})

describe('composeGermanHaltRequestedDmMessage', () => {
  const baseInput = {
    clientName: 'Acme',
    clientPeriodId: 17,
    jiraIssueKey: 'ABC-42',
    actorName: 'Renée Client',
    actorEmail: 'renee@acme.example',
    occurredAtIso: '2026-04-23T12:30:00.000Z',
    dashboardBaseUrl: 'https://dash.example.com',
    assigneeName: 'Sam Developer'
  }

  it('addresses the assignee by name and links to the per-period work-log page', () => {
    const msg = composeGermanHaltRequestedDmMessage(baseInput)
    const serialised = JSON.stringify(msg)
    expect(serialised).toContain('Hallo Sam Developer,')
    expect(serialised).toContain('zugewiesen')
    expect(serialised).toContain('Renée Client')
    expect(serialised).toContain(
      'https://dash.example.com/17/work-log?issue=ABC-42'
    )
    expect(serialised).toContain('"danger"')
  })

  it('falls back to a generic greeting when the assignee name is missing', () => {
    const msg = composeGermanHaltRequestedDmMessage({
      ...baseInput,
      assigneeName: null
    })
    expect(JSON.stringify(msg)).toContain('Hallo,')
  })

  it('keeps the fallback text actionable for mobile previews', () => {
    const msg = composeGermanHaltRequestedDmMessage(baseInput)
    expect(msg.text).toMatch(/ARBEITSSTOPP/)
    expect(msg.text).toContain('ABC-42')
    expect(msg.text).toMatch(/sofort ein/)
  })
})
