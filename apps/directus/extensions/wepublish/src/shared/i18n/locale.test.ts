import { describe, expect, it } from 'vitest'
import {
  createSlackFormatters,
  resolveClientLocale,
  SLACK_LOCALES
} from './locale'

describe('resolveClientLocale', () => {
  it('maps bare codes to themselves', () => {
    expect(resolveClientLocale('de')).toBe('de')
    expect(resolveClientLocale('fr')).toBe('fr')
    expect(resolveClientLocale('en')).toBe('en')
  })

  it('maps legacy admin locale tags by prefix', () => {
    expect(resolveClientLocale('de-DE')).toBe('de')
    expect(resolveClientLocale('fr-FR')).toBe('fr')
    expect(resolveClientLocale('en-US')).toBe('en')
  })

  it('is case-insensitive', () => {
    expect(resolveClientLocale('FR')).toBe('fr')
  })

  it('falls back to German for unknown, empty, or missing values', () => {
    expect(resolveClientLocale('it')).toBe('de')
    expect(resolveClientLocale('')).toBe('de')
    expect(resolveClientLocale(null)).toBe('de')
    expect(resolveClientLocale(undefined)).toBe('de')
  })

  it('exposes exactly de, fr, en (German first)', () => {
    expect(SLACK_LOCALES).toEqual(['de', 'fr', 'en'])
  })
})

describe('createSlackFormatters', () => {
  it('formats hours and percent with a unit suffix in every locale', () => {
    for (const locale of SLACK_LOCALES) {
      const fmt = createSlackFormatters(locale)
      expect(fmt.formatHours(2)).toBe('2 h')
      expect(fmt.formatPercent(50)).toBe('50 %')
    }
  })

  it('returns the raw input for an unparseable date', () => {
    const fmt = createSlackFormatters('de')
    expect(fmt.formatDate('not-a-date')).toBe('not-a-date')
    expect(fmt.formatTimestamp('nope')).toBe('nope')
  })

  it('formats a valid ISO date including the year', () => {
    const fmt = createSlackFormatters('de')
    expect(fmt.formatDate('2026-04-23T12:00:00.000Z')).toContain('2026')
  })
})
