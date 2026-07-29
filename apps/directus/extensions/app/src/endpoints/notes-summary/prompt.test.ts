import { describe, expect, it } from 'vitest'
import {
  buildSummaryPrompt,
  EmptyNoteError,
  formatSummaryForStorage,
  parseSummary
} from './prompt'

describe('buildSummaryPrompt', () => {
  it('includes title and body', () => {
    const prompt = buildSummaryPrompt({
      title: 'Sitzung',
      body: 'Wir haben entschieden ...'
    })

    expect(prompt).toContain('Titel: Sitzung')
    expect(prompt).toContain('Wir haben entschieden ...')
  })

  it('works with a title only', () => {
    expect(buildSummaryPrompt({ title: 'Nur Titel', body: null })).toContain(
      '(kein Text)'
    )
  })

  it('refuses a note with neither title nor body', () => {
    expect(() => buildSummaryPrompt({ title: '  ', body: '  ' })).toThrow(
      EmptyNoteError
    )
  })
})

describe('parseSummary', () => {
  it('accepts a well-formed answer', () => {
    expect(
      parseSummary({ summary: 'Kurz.', tags: ['Protokoll', 'TEAM'] })
    ).toEqual({
      summary: 'Kurz.',
      tags: ['protokoll', 'team']
    })
  })

  it('defaults to no tags when the field is missing or wrong', () => {
    expect(parseSummary({ summary: 'Kurz.' }).tags).toEqual([])
    expect(parseSummary({ summary: 'Kurz.', tags: 'protokoll' }).tags).toEqual(
      []
    )
  })

  it('drops non-string and blank tags and caps at five', () => {
    const parsed = parseSummary({
      summary: 'Kurz.',
      tags: ['a', 2, '', 'b', 'c', 'd', 'e', 'f']
    })

    expect(parsed.tags).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('truncates an over-long summary instead of storing it', () => {
    const parsed = parseSummary({ summary: 'x'.repeat(400), tags: [] })

    expect(parsed.summary).toHaveLength(240)
  })

  it('rejects answers without a usable summary', () => {
    expect(() => parseSummary(null)).toThrow()
    expect(() => parseSummary('kurz')).toThrow()
    expect(() => parseSummary({ summary: '   ' })).toThrow()
  })
})

describe('formatSummaryForStorage', () => {
  it('appends tags as hashtags', () => {
    expect(
      formatSummaryForStorage({ summary: 'Kurz.', tags: ['a', 'b'] })
    ).toBe('Kurz.\n\n#a #b')
  })

  it('stores the summary alone when there are no tags', () => {
    expect(formatSummaryForStorage({ summary: 'Kurz.', tags: [] })).toBe(
      'Kurz.'
    )
  })
})
