import { useQuery } from '@apollo/client/react'
import { CockpitHeader } from '@/components/CockpitHeader'
import { CockpitHeute } from '@/components/CockpitHeute'
import { BereitschaftStreifen } from '@/components/BereitschaftStreifen'
import { VorschlaegeInbox } from '@/components/VorschlaegeInbox'
import { AgentChat } from '@/components/AgentChat'
import { UsagePanel } from '@/components/UsagePanel'
import { VORSCHLAEGE_OFFEN, type Vorschlag } from '@/graphql/vorschlaege'

export default function AgentPage() {
  const { data } = useQuery(VORSCHLAEGE_OFFEN, { pollInterval: 30000, errorPolicy: 'all' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vorschlaege: Vorschlag[] = ((data as any)?.agent_vorschlaege ?? []) as Vorschlag[]

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <CockpitHeader />
      <CockpitHeute />
      <BereitschaftStreifen />

      <details className="rounded-lg border border-slate-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Frage an Der Gerät
        </summary>
        <div className="border-t border-slate-100 p-4">
          <AgentChat className="h-[440px] min-h-[320px]" />
        </div>
      </details>

      <details className="rounded-lg border border-slate-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Alle Vorschläge &amp; To-dos ({vorschlaege.length})
        </summary>
        <div className="border-t border-slate-100 p-4">
          <VorschlaegeInbox vorschlaege={vorschlaege} />
        </div>
      </details>

      <UsagePanel />
    </div>
  )
}
