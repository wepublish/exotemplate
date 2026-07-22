import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useQuery } from '@apollo/client/react'
import { Accordion } from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { FilterBar } from '@/components/FilterBar'
import { MatchRow } from '@/components/MatchRow'
import type { ApplicationSnap } from '@/components/MatchRow'
import { MatchingToolbar } from '@/components/MatchingToolbar'
import { PdfDokument } from '@/components/PdfDokument'
import { useMatches } from '@/data/useMatches'
import { APPLICATIONS_FOR_MEDIUM } from '@/graphql/applications.mutations'
import { PROJEKTE_FOR_MEDIUM, type Projekt } from '@/graphql/projekte'
import type { BetragsVorschlag } from '@/data/types'
import { tenant } from '../../config/tenant'

const PAGE = 50

export default function FoerderstiftungenPage() {
  const [medium, setMedium] = useState<string>(tenant.clients[0])
  // Deep-Link: ?medium=<slug> (z.B. aus dem Morgenbriefing «Liste öffnen») wählt das Medium vor.
  const router = useRouter()
  useEffect(() => {
    const m = router.query.medium
    if (typeof m === 'string' && (tenant.clients as readonly string[]).includes(m)) setMedium(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query.medium])
  const [projekt, setProjekt] = useState<number | null>(null)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [printN, setPrintN] = useState(10)
  // Frisch berechnete Beträge je Stiftung — Brücke, bis der 30s-Poll den
  // persistierten Wert (match_results.betrag_recherche) nachgeladen hat.
  const [betraege, setBetraege] = useState<Record<string, BetragsVorschlag>>({})
  const [zeigeAusgeblendete, setZeigeAusgeblendete] = useState(false)

  // Projekte des Mediums (für die Projekt-Unterauswahl)
  const { data: projData } = useQuery(PROJEKTE_FOR_MEDIUM, { variables: { medium }, skip: !medium })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projekte: Projekt[] = ((projData as any)?.projekte ?? []) as Projekt[]
  const aktivesProjekt = projekte.find(p => p.id === projekt) ?? null

  const { rows, loading } = useMatches(medium, projekt)

  // Persistierte Beträge (aus der Match-Liste) + frisch berechnete (Seiten-State).
  // Frische gewinnen, bis der Poll die persistierte Fassung liefert.
  const effektiveBetraege = useMemo<Record<string, BetragsVorschlag>>(() => {
    const map: Record<string, BetragsVorschlag> = {}
    for (const r of rows) {
      if (r.betragRecherche) map[r.stiftungId] = r.betragRecherche
    }
    return { ...map, ...betraege }
  }, [rows, betraege])

  // Anträge für das aktuelle Medium laden
  const { data: appsData, refetch: refetchApps } = useQuery(
    APPLICATIONS_FOR_MEDIUM,
    {
      variables: { medium },
      skip: !medium,
      fetchPolicy: 'cache-and-network',
    }
  )

  // Map stiftung_id (als String) → ApplicationSnap
  const applicationByStiftungId = useMemo<Map<string, ApplicationSnap>>(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: any[] = (appsData as any)?.applications ?? []
    const map = new Map<string, ApplicationSnap>()
    for (const a of list) {
      // stiftung_id kann als Int oder String ankommen — immer als String speichern
      const key = String(a.stiftung_id ?? '')
      if (key && !map.has(key)) {
        map.set(key, {
          id: a.id,
          stiftung_id: a.stiftung_id,
          status: a.status,
          bemerkung: a.bemerkung ?? null,
        })
      }
    }
    return map
  }, [appsData])

  // Zähler ausgeblendeter Einträge (über alle rows, unabhängig von Suche)
  const ausgeblendetCount = rows.filter(r => {
    const app = applicationByStiftungId.get(r.stiftungId)
    return app?.status === 'ausgeblendet'
  }).length

  const filtered = rows.filter(r => {
    // Suchtext-Filter
    if (q && !r.name.toLowerCase().includes(q.toLowerCase())) return false
    // Ausgeblendet-Filter: ausblenden wenn zeigeAusgeblendete=false
    if (!zeigeAusgeblendete) {
      const app = applicationByStiftungId.get(r.stiftungId)
      if (app?.status === 'ausgeblendet') return false
    }
    return true
  })

  // Pagination (Pagesize 50).
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE))
  const curPage = Math.min(page, pageCount)
  const list = filtered.slice((curPage - 1) * PAGE, curPage * PAGE)

  return (
    <>
      {/* Bildschirm-Ansicht — im Druck ausgeblendet */}
      <div className="space-y-4 print:hidden">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-700 mb-1">
              <span className="text-slate-300">{'// '}</span>Matching
            </p>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
              Förder<span className="text-indigo-500">stiftungen</span>
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              {medium}
              {aktivesProjekt && <span className="text-indigo-600"> · Projekt: {aktivesProjekt.name}</span>}
              {!loading && (
                <span className="font-medium text-slate-700"> · {filtered.length} Treffer</span>
              )}
            </p>
          </div>
          <MatchingToolbar
            printN={printN}
            onPrintN={setPrintN}
            onPrint={() => window.print()}
          />
        </div>

        <div className="no-print">
          <FilterBar
            medium={medium}
            onMedium={m => { setMedium(m); setProjekt(null); setPage(1) }}
            q={q}
            onQ={v => { setQ(v); setPage(1) }}
            projekte={projekte}
            projekt={projekt}
            onProjekt={id => { setProjekt(id); setPage(1) }}
          />
          {ausgeblendetCount > 0 && (
            <div className="mt-2 flex items-center">
              <button
                type="button"
                onClick={() => { setZeigeAusgeblendete(v => !v); setPage(1) }}
                className="text-xs text-slate-500 hover:text-slate-700 underline underline-offset-2"
              >
                {zeigeAusgeblendete
                  ? `Ausgeblendete verbergen`
                  : `Ausgeblendete anzeigen (${ausgeblendetCount})`}
              </button>
            </div>
          )}
        </div>

        {loading && (
          <div className="w-full bg-slate-200 rounded-full h-1 overflow-hidden">
            <div className="h-1 bg-indigo-500 animate-pulse w-2/3 rounded-full" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="p-12 text-center border-2 border-dashed border-slate-200 rounded-xl">
            <p className="text-slate-500">Keine Matches für diese Filter gefunden.</p>
          </div>
        )}

        <Accordion type="multiple" className="space-y-3 w-full">
          {list.map((r, i) => (
            <MatchRow
              key={r.id}
              row={r}
              rank={(curPage - 1) * PAGE + i + 1}
              medium={medium}
              projektId={projekt}
              application={applicationByStiftungId.get(r.stiftungId)}
              onApplicationCreated={() => refetchApps()}
              betrag={effektiveBetraege[r.stiftungId]}
              onBetragComputed={v =>
                setBetraege(prev => ({ ...prev, [r.stiftungId]: v }))
              }
            />
          ))}
        </Accordion>

        {pageCount > 1 && (
          <div className="flex items-center justify-center gap-4 pt-2 no-print">
            <Button
              variant="outline"
              size="sm"
              disabled={curPage <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              Zurück
            </Button>
            <span className="text-sm text-slate-500">
              Seite {curPage} von {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={curPage >= pageCount}
              onClick={() => setPage(p => Math.min(pageCount, p + 1))}
            >
              Weiter
            </Button>
          </div>
        )}
      </div>

      {/* Druck-Dokument — nur im PDF/Druck sichtbar, zeigt die obersten N Treffer */}
      <PdfDokument
        mediumSlug={medium}
        mediumName={medium}
        rows={filtered.slice(0, printN)}
        betraege={effektiveBetraege}
      />
    </>
  )
}
