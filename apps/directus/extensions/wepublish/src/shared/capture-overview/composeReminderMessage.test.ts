import { describe, expect, it } from 'vitest'
import { composeDailyReminderMessage } from './composeReminderMessage'

describe('composeDailyReminderMessage', () => {
  it('throws when no missing users — caller must skip', () => {
    expect(() =>
      composeDailyReminderMessage({
        missingUsers: [],
        referenceDate: '2026-05-25'
      })
    ).toThrow(/no users/)
  })

  it('mentions Slack users by ID when available, falls back to name', () => {
    const msg = composeDailyReminderMessage({
      missingUsers: [
        { name: 'Ann Example', email: 'ann@x', slackUserId: 'U001' },
        { name: 'Pat Part-Time', email: 'pat@x', slackUserId: null }
      ],
      referenceDate: '2026-05-25'
    })
    const headlineBlock = msg.blocks[1] as { text: { text: string } }
    expect(headlineBlock.text.text).toContain('<@U001>')
    expect(headlineBlock.text.text).toContain('Pat Part-Time')
  })

  it('uses "und" for two names, comma list for more', () => {
    const two = composeDailyReminderMessage({
      missingUsers: [
        { name: 'Ann', email: 'a@x', slackUserId: null },
        { name: 'Bob', email: 'b@x', slackUserId: null }
      ],
      referenceDate: '2026-05-25'
    })
    expect((two.blocks[1] as any).text.text).toContain('Ann und Bob')

    const three = composeDailyReminderMessage({
      missingUsers: [
        { name: 'Ann', email: 'a@x', slackUserId: null },
        { name: 'Bob', email: 'b@x', slackUserId: null },
        { name: 'Cara', email: 'c@x', slackUserId: null }
      ],
      referenceDate: '2026-05-25'
    })
    expect((three.blocks[1] as any).text.text).toContain('Ann, Bob und Cara')
  })

  it('rotates the opener day-to-day deterministically', () => {
    const day1 = composeDailyReminderMessage({
      missingUsers: [{ name: 'A', email: 'a@x', slackUserId: null }],
      referenceDate: '2026-05-25'
    })
    const day2 = composeDailyReminderMessage({
      missingUsers: [{ name: 'A', email: 'a@x', slackUserId: null }],
      referenceDate: '2026-05-26'
    })
    const day1Again = composeDailyReminderMessage({
      missingUsers: [{ name: 'A', email: 'a@x', slackUserId: null }],
      referenceDate: '2026-05-25'
    })

    expect(day1.text).toBe(day1Again.text)
    expect(day1.text).not.toBe(day2.text)
  })

  it('includes the German weekday + date in the headline', () => {
    const msg = composeDailyReminderMessage({
      missingUsers: [{ name: 'A', email: 'a@x', slackUserId: null }],
      referenceDate: '2026-05-25'
    })
    // 2026-05-25 is a Monday — German "Montag" should appear
    expect(msg.text).toMatch(/Montag/)
    expect(msg.text).toContain('25.05.2026')
  })

  it('has both fallback text and blocks', () => {
    const msg = composeDailyReminderMessage({
      missingUsers: [{ name: 'Ann', email: 'a@x', slackUserId: null }],
      referenceDate: '2026-05-25'
    })
    expect(msg.text.length).toBeGreaterThan(20)
    expect(msg.blocks.length).toBeGreaterThanOrEqual(3)
  })
})
