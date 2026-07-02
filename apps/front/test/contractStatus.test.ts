import { describe, it, expect } from 'vitest'
import {
  currentContract,
  currentValidContract,
  contractNeedsSignature
} from '~/composables/contractStatus'
import type { Contract } from '~~/types/DirectusTypes'

function makeContract(partial: Partial<Contract>): Contract {
  return {
    id: 1,
    status: 'published',
    sort: null,
    client: 'client-1',
    version: 1,
    file: 'file-1',
    signed: false,
    signed_at: null,
    notes: null,
    date_created: null,
    date_updated: null,
    user_created: null,
    user_updated: null,
    ...partial
  }
}

describe('currentContract', () => {
  it('returns undefined when there are none', () => {
    expect(currentContract([])).toBeUndefined()
  })

  it('returns the highest-version non-archived row', () => {
    const result = currentContract([
      makeContract({ id: 1, version: 1 }),
      makeContract({ id: 2, version: 3 }),
      makeContract({ id: 3, version: 2 })
    ])
    expect(result?.id).toBe(2)
  })

  it('ignores archived rows', () => {
    const result = currentContract([
      makeContract({ id: 1, version: 1, status: 'published' }),
      makeContract({ id: 2, version: 5, status: 'archived' })
    ])
    expect(result?.id).toBe(1)
  })
})

describe('currentValidContract', () => {
  it('returns the highest-version signed row', () => {
    const result = currentValidContract([
      makeContract({ id: 1, version: 1, signed: true }),
      makeContract({ id: 2, version: 2, signed: false }),
      makeContract({ id: 3, version: 3, signed: true })
    ])
    expect(result?.id).toBe(3)
  })

  it('is undefined when nothing is signed', () => {
    expect(
      currentValidContract([makeContract({ version: 2, signed: false })])
    ).toBeUndefined()
  })
})

describe('contractNeedsSignature', () => {
  it('is false when there is no contract at all', () => {
    expect(contractNeedsSignature([])).toBe(false)
  })

  it('is true when the current version is not signed', () => {
    expect(
      contractNeedsSignature([makeContract({ version: 1, signed: false })])
    ).toBe(true)
  })

  it('is false when the current version is signed', () => {
    expect(
      contractNeedsSignature([makeContract({ version: 1, signed: true })])
    ).toBe(false)
  })

  it('looks only at the current (latest) version', () => {
    expect(
      contractNeedsSignature([
        makeContract({ id: 1, version: 1, signed: true }),
        makeContract({ id: 2, version: 2, signed: false })
      ])
    ).toBe(true)
    expect(
      contractNeedsSignature([
        makeContract({ id: 1, version: 1, signed: false }),
        makeContract({ id: 2, version: 2, signed: true })
      ])
    ).toBe(false)
  })
})
