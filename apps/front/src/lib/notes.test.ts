import { formatDateTime, isSummaryStale, parseStoredSummary, statusLabel } from './notes'

describe('parseStoredSummary', () => {
  it('splits text and tags', () => {
    expect(parseStoredSummary('Kurz gefasst.\n\n#protokoll #team')).toEqual({
      text: 'Kurz gefasst.',
      tags: ['protokoll', 'team']
    })
  })

  it('handles a summary without tags', () => {
    expect(parseStoredSummary('Kurz gefasst.')).toEqual({ text: 'Kurz gefasst.', tags: [] })
  })

  it('returns null for nothing stored', () => {
    expect(parseStoredSummary(null)).toBeNull()
    expect(parseStoredSummary('   ')).toBeNull()
  })

  it('ignores a bare hash', () => {
    expect(parseStoredSummary('Text.\n\n# #echt')?.tags).toEqual(['echt'])
  })
})

describe('formatDateTime', () => {
  it('formats a timestamp', () => {
    expect(formatDateTime('2026-07-29T08:30:00Z')).toMatch(/2026/)
  })

  it('never renders Invalid Date', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime('keine Zeit')).toBe('—')
  })
})

describe('isSummaryStale', () => {
  it('is stale when there is text but no summary', () => {
    expect(isSummaryStale({ body: 'Text', ai_summary: null })).toBe(true)
    expect(isSummaryStale({ body: 'Text', ai_summary: '  ' })).toBe(true)
  })

  it('is not stale with a summary, or without text', () => {
    expect(isSummaryStale({ body: 'Text', ai_summary: 'Kurz.' })).toBe(false)
    expect(isSummaryStale({ body: null, ai_summary: null })).toBe(false)
  })
})

describe('statusLabel', () => {
  it('translates known statuses and passes through unknown ones', () => {
    expect(statusLabel('draft')).toBe('Entwurf')
    expect(statusLabel('irgendwas')).toBe('irgendwas')
  })
})
