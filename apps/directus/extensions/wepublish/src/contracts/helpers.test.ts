import { describe, it, expect } from 'vitest'
import {
  nextContractVersion,
  buildContractFileName,
  currentContract,
  currentContractNeedsSignature
} from './helpers'

describe('nextContractVersion', () => {
  it('starts at 1 when there are no contracts', () => {
    expect(nextContractVersion([])).toBe(1)
  })

  it('returns one above the current max', () => {
    expect(nextContractVersion([{ version: 1 }, { version: 2 }])).toBe(3)
  })

  it('preserves gaps (does not reuse archived/deleted version numbers)', () => {
    expect(nextContractVersion([{ version: 1 }, { version: 5 }])).toBe(6)
  })
})

describe('buildContractFileName', () => {
  it('sanitises the client name, appends the version, ends in .pdf', () => {
    expect(buildContractFileName('Mein Medium', 2)).toBe(
      'Vertrag_Mein_Medium_v2.pdf'
    )
    expect(buildContractFileName('Tatört / News!', 1)).toBe(
      'Vertrag_Tatört_News_v1.pdf'
    )
  })

  it('falls back to a default when the name has no usable characters', () => {
    expect(buildContractFileName('   ///   ', 3)).toBe('Vertrag_Vertrag_v3.pdf')
  })
})

describe('currentContract', () => {
  it('returns the highest-version non-archived row', () => {
    const result = currentContract([
      { version: 1, status: 'published' },
      { version: 3, status: 'published' },
      { version: 5, status: 'archived' }
    ])
    expect(result?.version).toBe(3)
  })

  it('is undefined when there are none', () => {
    expect(currentContract([])).toBeUndefined()
  })
})

describe('currentContractNeedsSignature', () => {
  it('is false when the client has no contract', () => {
    expect(currentContractNeedsSignature([])).toBe(false)
  })

  it('is true when the current version is not signed', () => {
    expect(
      currentContractNeedsSignature([
        { version: 1, status: 'published', signed: false }
      ])
    ).toBe(true)
  })

  it('is false when the current version is signed', () => {
    expect(
      currentContractNeedsSignature([
        { version: 1, status: 'published', signed: true }
      ])
    ).toBe(false)
  })

  it('looks only at the current (latest) version', () => {
    // older signed, newer unsigned → still needs a signature
    expect(
      currentContractNeedsSignature([
        { version: 1, status: 'published', signed: true },
        { version: 2, status: 'published', signed: false }
      ])
    ).toBe(true)
    // older unsigned, newer signed → satisfied
    expect(
      currentContractNeedsSignature([
        { version: 1, status: 'published', signed: false },
        { version: 2, status: 'published', signed: true }
      ])
    ).toBe(false)
  })
})
