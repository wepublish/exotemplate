import { describe, expect, it } from 'vitest'
import {
  resolveLocale,
  SUPPORTED_LOCALES
} from '../app/composables/useAppLocale'

describe('SUPPORTED_LOCALES', () => {
  it('is exactly de, fr, en with German first (default)', () => {
    expect(SUPPORTED_LOCALES).toEqual(['de', 'fr', 'en'])
  })
})

describe('resolveLocale', () => {
  it('maps bare codes to themselves', () => {
    expect(resolveLocale('de')).toBe('de')
    expect(resolveLocale('fr')).toBe('fr')
    expect(resolveLocale('en')).toBe('en')
  })

  it('maps legacy admin locale tags by prefix', () => {
    expect(resolveLocale('de-DE')).toBe('de')
    expect(resolveLocale('de-CH')).toBe('de')
    expect(resolveLocale('fr-FR')).toBe('fr')
    expect(resolveLocale('fr-CH')).toBe('fr')
    expect(resolveLocale('en-US')).toBe('en')
    expect(resolveLocale('en-GB')).toBe('en')
  })

  it('is case-insensitive', () => {
    expect(resolveLocale('FR')).toBe('fr')
    expect(resolveLocale('EN-us')).toBe('en')
  })

  it('falls back to German for unknown, empty, or missing values', () => {
    expect(resolveLocale('it')).toBe('de')
    expect(resolveLocale('')).toBe('de')
    expect(resolveLocale(null)).toBe('de')
    expect(resolveLocale(undefined)).toBe('de')
  })
})
