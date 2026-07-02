import { describe, it, expect } from 'vitest'
import { slugifyMediumName } from './mediumName'

describe('slugifyMediumName', () => {
  it('leaves a valid identifier untouched', () => {
    expect(slugifyMediumName('bajour')).toBe('bajour')
  })

  it('lowercases and merges words with no separator', () => {
    expect(slugifyMediumName('One Test')).toBe('onetest')
  })

  it('drops punctuation and whitespace entirely (no separator)', () => {
    expect(slugifyMediumName('Bajour!!  News')).toBe('bajournews')
    expect(slugifyMediumName('St. Galler')).toBe('stgaller')
  })

  it('strips diacritics', () => {
    expect(slugifyMediumName('Zürich')).toBe('zurich')
  })

  it('trims surrounding whitespace', () => {
    expect(slugifyMediumName('  Foo  ')).toBe('foo')
  })

  it('prefixes a leading digit so it starts with a letter (domain-safe)', () => {
    expect(slugifyMediumName('3sat')).toBe('m3sat')
  })

  it('returns an empty string when nothing usable remains', () => {
    expect(slugifyMediumName('!!!')).toBe('')
    expect(slugifyMediumName('')).toBe('')
  })
})
