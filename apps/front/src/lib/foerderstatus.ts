/**
 * Reine Orchestrierungs-Logik für das globale Entfernen einer Stiftung aus dem
 * Matching («ist keine Förderstiftung») bzw. das Wieder-Aufnehmen.
 *
 * Entfernen = ist_foerderstiftung auf false setzen + ALLE Match-Treffer der
 * Stiftung (über alle Medien) löschen, damit sie sofort überall verschwindet.
 * Reversibel über `nimmStiftungWiederAuf` (Flag zurück auf true; Treffer
 * entstehen beim nächsten Re-Match neu).
 *
 * Die Directus-Calls werden als Callbacks injiziert → unit-testbar ohne Apollo.
 */

export interface FoerderstatusCallbacks {
  setStatus: (ist: boolean) => Promise<void>
  ladeMatchIds: () => Promise<string[]>
  loescheMatches: (ids: string[]) => Promise<void>
}

const BATCH = 100

export async function entferneStiftungGlobal(cb: FoerderstatusCallbacks): Promise<{ geloeschteMatches: number }> {
  // 1) Flag zuerst: damit künftige Re-Matches sie nicht neu erzeugen.
  await cb.setStatus(false)
  // 2) Bestehende Treffer über alle Medien löschen (in Stapeln).
  const ids = await cb.ladeMatchIds()
  for (let i = 0; i < ids.length; i += BATCH) {
    const stapel = ids.slice(i, i + BATCH)
    if (stapel.length > 0) await cb.loescheMatches(stapel)
  }
  return { geloeschteMatches: ids.length }
}

export async function nimmStiftungWiederAuf(cb: Pick<FoerderstatusCallbacks, 'setStatus'>): Promise<void> {
  await cb.setStatus(true)
}
