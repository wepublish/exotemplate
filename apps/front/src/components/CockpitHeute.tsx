import { useMemo } from 'react'
import { useQuery } from '@apollo/client/react'
import { cockpitZaehlerQuery, schwelleVorTagen } from '@/graphql/cockpit'
import { baueHeute, type Handgriff } from '@/lib/cockpit'

// ---- reine View ----
export function CockpitHeuteView({ gruss, aktionen }: { gruss: string; aktionen: Handgriff[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{gruss}</p>
      {aktionen.length === 0 ? (
        <p className="py-2 text-sm text-slate-500">
          Aktuell nichts zu tun. Der Gerät meldet sich, sobald etwas ansteht, du musst nicht
          nachschauen.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {aktionen.map((a, i) => (
              <li key={a.key} className="flex items-center gap-3 py-3">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    a.dringend ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {i + 1}
                </span>
                <div className="flex-1">
                  <div className="font-medium text-slate-900">{a.titel}</div>
                  <div className="text-sm text-slate-500">{a.sub}</div>
                </div>
                <a
                  href={a.href}
                  aria-label={`Öffnen: ${a.titel}`}
                  className={`shrink-0 rounded-md border px-3 py-1.5 text-sm font-medium ${
                    a.dringend
                      ? 'border-rose-300 text-rose-700 hover:bg-rose-50'
                      : 'border-indigo-300 text-indigo-700 hover:bg-indigo-50'
                  }`}
                >
                  Öffnen
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-slate-500">
            Wenn das erledigt ist, ist nichts weiter zu tun. Der Gerät meldet sich, sobald wieder
            etwas ansteht.
          </p>
        </>
      )}
    </section>
  )
}

// ---- Container ----
export function CockpitHeute() {
  // Query EINMAL bauen: schwelleVorTagen nutzt new Date(), das pro Render einen
  // anderen Zeitstempel inline-baut -> ohne useMemo wäre das Query-Dokument bei
  // jedem Render neu und Apollo würde nie stabilisieren (Zaehler blieben 0).
  const query = useMemo(() => cockpitZaehlerQuery(schwelleVorTagen(10), schwelleVorTagen(14)), [])
  const { data } = useQuery(query, {
    pollInterval: 30000,
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any
  const n = (x: unknown) => Number(x ?? 0)
  const aktionen = baueHeute({
    sichten: n(d?.sichten?.[0]?.count?.id),
    freigeben: n(d?.freigeben?.[0]?.count?.id),
    nachfassen: n(d?.nachfassen?.[0]?.count?.id),
    frist: n(d?.frist?.[0]?.count?.id),
    ausgang: n(d?.ausgang?.[0]?.count?.id),
  })
  return <CockpitHeuteView gruss="Guten Morgen Ramona, das ist heute dran" aktionen={aktionen} />
}
