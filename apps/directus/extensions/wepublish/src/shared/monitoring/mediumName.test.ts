import { describe, it, expect } from 'vitest'
import { slugifyMediumName } from './mediumName'

describe('slugifyMediumName', () => {
  it('leaves a valid identifier untouched', () => {
    expect(slugifyMediumName('bajour')).toBe('bajour')
  })

  it('lowercases and replaces spaces with underscores', () => {
    expect(slugifyMediumName('One Test')).toBe('one_test')
  })

  it('drops punctuation and collapses separators', () => {
    expect(slugifyMediumName('Bajour!!  News')).toBe('bajour_news')
    expect(slugifyMediumName('St. Galler')).toBe('st_galler')
  })

  it('trims leading and trailing separators', () => {
    expect(slugifyMediumName('  Foo  ')).toBe('foo')
  })

  it('prefixes a leading digit so it starts with a letter', () => {
    expect(slugifyMediumName('3sat')).toBe('m3sat')
  })

  it('returns an empty string when nothing usable remains', () => {
    expect(slugifyMediumName('!!!')).toBe('')
    expect(slugifyMediumName('')).toBe('')
  })
})
