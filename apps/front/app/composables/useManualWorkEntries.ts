import type { ManualWorkEntry } from '~~/types/DirectusTypes'

export const useManualWorkEntries = () => {
  function getSumByClientPeriod (entries: ManualWorkEntry[]): number {
    return entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0)
  }

  return {
    getSumByClientPeriod
  }
}
