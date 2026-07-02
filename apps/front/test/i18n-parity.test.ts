import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const LOCALES = ['de', 'fr', 'en'] as const
const localesDir = fileURLToPath(new URL('../i18n/locales', import.meta.url))

type Json = Record<string, unknown>

function load(locale: string, file: string): Json {
  return JSON.parse(readFileSync(join(localesDir, locale, file), 'utf8'))
}

/** Flatten nested message objects into dotted keys → leaf string values. */
function flatten(obj: Json, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value as Json, path))
    } else {
      out[path] = String(value)
    }
  }
  return out
}

const namespaceFiles = readdirSync(join(localesDir, 'de')).filter((f) =>
  f.endsWith('.json')
)

describe('i18n catalog parity', () => {
  it('defines the same namespace files for every locale', () => {
    for (const locale of LOCALES) {
      const files = readdirSync(join(localesDir, locale))
        .filter((f) => f.endsWith('.json'))
        .sort()
      expect(files).toEqual([...namespaceFiles].sort())
    }
  })

  describe.each(namespaceFiles)('namespace %s', (file) => {
    const de = flatten(load('de', file))
    const deKeys = Object.keys(de).sort()

    it.each(['fr', 'en'])('%s has exactly the same keys as de', (locale) => {
      const other = Object.keys(flatten(load(locale, file))).sort()
      expect(other).toEqual(deKeys)
    })

    it.each(LOCALES)('%s has no empty values', (locale) => {
      const flat = flatten(load(locale, file))
      const empty = Object.entries(flat)
        .filter(([, v]) => v.trim() === '')
        .map(([k]) => k)
      expect(empty).toEqual([])
    })

    it.each(['fr', 'en'])(
      '%s keeps the same number of plural forms as de',
      (locale) => {
        const other = flatten(load(locale, file))
        for (const [key, deValue] of Object.entries(de)) {
          if (!deValue.includes(' | ')) continue
          const deForms = deValue.split(' | ').length
          const otherForms = (other[key] ?? '').split(' | ').length
          expect(otherForms, `${file}:${key} plural-form count mismatch`).toBe(
            deForms
          )
        }
      }
    )
  })
})
