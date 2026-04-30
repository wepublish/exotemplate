import { describe, expect, it } from 'vitest'
import {
  buildDashboardUrl,
  composeGermanHaltRequestedDmMessage,
  composeGermanHaltRequestedMessage,
  composeGermanHaltResolvedMessage,
  composeGermanWarningMessage
} from './composeMessage'

describe('buildDashboardUrl', () => {
  it('composes a client + warning url', () => {
    expect(
      buildDashboardUrl('https://dash.example.com', 'client-123', 'ABC-1')
    ).toBe('https://dash.example.com/?clientId=client-123&issue=ABC-1')
  })

  it('strips trailing slashes from the base url', () => {
    expect(buildDashboardUrl('https://dash.example.com/', 'c', 'ABC-1')).toBe(
      'https://dash.example.com/?clientId=c&issue=ABC-1'
    )
  })

  it('encodes the client id', () => {
    expect(
      buildDashboardUrl(
        'https://dash.example.com',
        'client with space',
        'ABC-1'
      )
    ).toContain('client+with+space')
  })
})

describe('composeGermanWarningMessage', () => {
  it('uses singular/plural wording based on warning count', () => {
    const single = composeGermanWarningMessage({
      clientName: 'Acme',
      clientId: '1',
      warnings: [
        {
          jiraIssueKey: 'ABC-1',
          estimatedHours: 5,
          totalHoursUsed: 7,
          usedPercent: 140,
          crossedThresholdHours: 100,
          nextThresholdHours: 104
        }
      ],
      dashboardBaseUrl: 'https://dash.example.com'
    })
    expect(single.text).toContain('1 Jira-Ticket hat')

    const many = composeGermanWarningMessage({
      clientName: 'Acme',
      clientId: '1',
      warnings: [
        {
          jiraIssueKey: 'ABC-1',
          estimatedHours: 5,
          totalHoursUsed: 7,
          usedPercent: 140,
          crossedThresholdHours: 100,
          nextThresholdHours: 104
        },
        {
          jiraIssueKey: 'ABC-2',
          estimatedHours: 10,
          totalHoursUsed: 9,
          usedPercent: 90,
          crossedThresholdHours: 80,
          nextThresholdHours: 84
        }
      ],
      dashboardBaseUrl: 'https://dash.example.com'
    })
    expect(many.text).toContain('2 Jira-Tickets haben')
  })

  it('renders one section block per warning plus header/divider/footer', () => {
    const msg = composeGermanWarningMessage({
      clientName: 'Acme',
      clientId: '1',
      warnings: [
        {
          jiraIssueKey: 'ABC-1',
          estimatedHours: 5,
          totalHoursUsed: 7,
          usedPercent: 140,
          crossedThresholdHours: 100,
          nextThresholdHours: 104
        },
        {
          jiraIssueKey: 'ABC-2',
          estimatedHours: 10,
          totalHoursUsed: 9,
          usedPercent: 90,
          crossedThresholdHours: 80,
          nextThresholdHours: 84
        }
      ],
      dashboardBaseUrl: 'https://dash.example.com'
    })
    // header, section (summary), divider, 2 warning sections, context
    expect(msg.blocks).toHaveLength(6)
    expect(msg.blocks.filter((b) => b.type === 'section')).toHaveLength(3)
  })

  it('announces the next threshold in both the block and fallback text', () => {
    const msg = composeGermanWarningMessage({
      clientName: 'Acme',
      clientId: '1',
      warnings: [
        {
          jiraIssueKey: 'ABC-1',
          estimatedHours: 5,
          totalHoursUsed: 7,
          usedPercent: 140,
          crossedThresholdHours: 9,
          nextThresholdHours: 13
        }
      ],
      dashboardBaseUrl: 'https://dash.example.com'
    })
    expect(msg.text).toContain('nächste Meldung ab 13 h')
    const serialised = JSON.stringify(msg)
    expect(serialised).toContain('Nächste Meldung, sobald 13 h')
  })

  it('puts a dashboard link into each warning block', () => {
    const msg = composeGermanWarningMessage({
      clientName: 'Acme',
      clientId: 'abc',
      warnings: [
        {
          jiraIssueKey: 'ABC-1',
          estimatedHours: 5,
          totalHoursUsed: 7,
          usedPercent: 140,
          crossedThresholdHours: 100,
          nextThresholdHours: 104
        }
      ],
      dashboardBaseUrl: 'https://dash.example.com'
    })
    const serialised = JSON.stringify(msg)
    expect(serialised).toContain(
      'https://dash.example.com/?clientId=abc&issue=ABC-1'
    )
  })
})

describe('composeGermanHaltRequestedMessage', () => {
  const baseInput = {
    clientName: 'Acme',
    clientId: 'acme',
    jiraIssueKey: 'ABC-42',
    actorName: 'Renée Client',
    actorEmail: 'renee@acme.example',
    occurredAtIso: '2026-04-23T12:30:00.000Z',
    dashboardBaseUrl: 'https://dash.example.com'
  }

  it('tells the channel to stop work and links to the dashboard', () => {
    const msg = composeGermanHaltRequestedMessage(baseInput)
    const serialised = JSON.stringify(msg)
    expect(msg.text).toMatch(/stellt die Arbeit/i)
    expect(serialised).toContain('Arbeitsstopp')
    expect(serialised).toContain('Renée Client')
    expect(serialised).toContain(
      'https://dash.example.com/?clientId=acme&issue=ABC-42'
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
      clientId: 'acme',
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
      'https://dash.example.com/?clientId=acme&issue=ABC-42'
    )
  })
})

describe('composeGermanHaltRequestedDmMessage', () => {
  const baseInput = {
    clientName: 'Acme',
    clientId: 'acme',
    jiraIssueKey: 'ABC-42',
    actorName: 'Renée Client',
    actorEmail: 'renee@acme.example',
    occurredAtIso: '2026-04-23T12:30:00.000Z',
    dashboardBaseUrl: 'https://dash.example.com',
    assigneeName: 'Sam Developer'
  }

  it('addresses the assignee by name and links to the dashboard', () => {
    const msg = composeGermanHaltRequestedDmMessage(baseInput)
    const serialised = JSON.stringify(msg)
    expect(serialised).toContain('Hallo Sam Developer,')
    expect(serialised).toContain('zugewiesen')
    expect(serialised).toContain('Renée Client')
    expect(serialised).toContain(
      'https://dash.example.com/?clientId=acme&issue=ABC-42'
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
