import type { Contract } from '../DirectusTypes'

// Per-client contract versions are 1-based and monotonic. The next version is
// one above the current max — gaps from archived/deleted rows are preserved so
// version numbers stay stable references in the timeline.
export function nextContractVersion(
  existing: Pick<Contract, 'version'>[]
): number {
  const max = existing.reduce(
    (acc, c) => Math.max(acc, typeof c.version === 'number' ? c.version : 0),
    0
  )
  return max + 1
}

// Produces a filesystem-safe PDF file name like `Vertrag_Mein_Medium_v2.pdf`.
export function buildContractFileName(
  clientName: string,
  version: number
): string {
  const safe =
    clientName
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, '_')
      .replace(/^_+|_+$/g, '') || 'Vertrag'
  return `Vertrag_${safe}_v${version}.pdf`
}

// The current contract = the highest-version non-archived row.
export function currentContract<T extends Pick<Contract, 'version' | 'status'>>(
  contracts: T[]
): T | undefined {
  return contracts
    .filter((c) => c.status !== 'archived')
    .reduce<
      T | undefined
    >((best, c) => (!best || c.version > best.version ? c : best), undefined)
}

// Drives the "Vertrag nicht unterzeichnet" warning: true ONLY when a contract
// exists for the client and its current (latest) version is not yet signed.
// Returns false when the client has no contract at all — we don't nag clients
// who simply have nothing on file.
export function currentContractNeedsSignature(
  contracts: Pick<Contract, 'version' | 'status' | 'signed'>[]
): boolean {
  const current = currentContract(contracts)
  return Boolean(current) && current!.signed !== true
}
