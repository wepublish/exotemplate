import { useEffect, useState } from 'react'
import { useQuery } from '@apollo/client/react'
import { MEDIEN_BEREITSCHAFT, MEDIUM_DNA_AKTIV } from '@/graphql/cockpit'
import { baueBereitschaft, type Bereitschaft, type MediumRoh } from '@/lib/bereitschaft'

// ---- reine View ----
export function BereitschaftView({ b, anzahl }: { b: Bereitschaft; anzahl: number }) {
  if (b.alleBereit) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        Alle {anzahl} Medien startklar
        <span className="text-emerald-600/70">· DNA, Slack und Mail verbunden</span>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <div className="font-medium">Einrichtung noch nicht vollständig</div>
      <ul className="mt-1 space-y-0.5">
        {b.gmailFehlt && <li>Gmail noch nicht verbunden (Mail-Versand)</li>}
        {b.luecken.map((l) => (
          <li key={l.slug}>
            {l.slug}: {l.fehlt.join(', ')} fehlt
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---- Container ----
export function BereitschaftStreifen() {
  const { data: md } = useQuery(MEDIEN_BEREITSCHAFT, { errorPolicy: 'all' })
  const { data: dna } = useQuery(MEDIUM_DNA_AKTIV, { errorPolicy: 'all' })
  const [gmail, setGmail] = useState(false)

  useEffect(() => {
    fetch('/api/faas-readiness')
      .then((r) => r.json())
      .then((d: { gmail_connected?: boolean }) => setGmail(!!d.gmail_connected))
      .catch(() => setGmail(false))
  }, [])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const medien: MediumRoh[] = ((md as any)?.faas_medien ?? []) as MediumRoh[]
  const dnaIds = new Set<string>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (((dna as any)?.medium_dna ?? []) as any[]).map((x) => String(x.medium_id)),
  )
  const b = baueBereitschaft(medien, dnaIds, gmail)
  return <BereitschaftView b={b} anzahl={medien.length} />
}
