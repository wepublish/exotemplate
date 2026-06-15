import type { Contract } from '~~/types/DirectusTypes'

// Pure contract-status helpers. Kept free of Nuxt/SDK runtime so they're unit
// testable in the plain `node` vitest environment and reusable across the
// dashboard banner, overview tiles, and the settings contract page.

function isActive(contract: Pick<Contract, 'status'>): boolean {
  return contract.status !== 'archived'
}

function highestVersion<T extends Pick<Contract, 'version'>>(
  contracts: T[]
): T | undefined {
  return contracts.reduce<T | undefined>(
    (best, c) => (!best || c.version > best.version ? c : best),
    undefined
  )
}

/** The current contract: the highest-version non-archived row (signed or not). */
export function currentContract(contracts: Contract[]): Contract | undefined {
  return highestVersion(contracts.filter(isActive))
}

/**
 * The "in effect" signed contract: the highest-version non-archived row that is
 * signed. Undefined when the current contract isn't signed yet.
 */
export function currentValidContract(
  contracts: Contract[]
): Contract | undefined {
  return highestVersion(contracts.filter((c) => isActive(c) && c.signed))
}

/**
 * Drives the "Vertrag nicht unterzeichnet" warning: true ONLY when a contract
 * exists for the client and its current (latest) version is not signed. Returns
 * false when there is no contract at all — we don't nag clients with nothing on
 * file.
 */
export function contractNeedsSignature(contracts: Contract[]): boolean {
  const current = currentContract(contracts)
  return Boolean(current) && current!.signed !== true
}
