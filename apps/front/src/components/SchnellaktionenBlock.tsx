import { useState } from 'react'
import { useQuery } from '@apollo/client/react'
import { gql } from '@apollo/client'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { MailEntwurfButton } from '@/components/MailEntwurfButton'
import { GesuchPromptButton } from '@/components/GesuchPromptButton'
import { bauWillkommensmail } from '@/lib/mail-vorlagen'
import { baueSlackVerweis } from '@/lib/portal-texte'
import { tenant } from '../../config/tenant'

const MEDIEN_QUERY = gql`
  query AktiveMedienListe {
    faas_medien(
      filter: { is_active: { _eq: true }, mandant: { _eq: "${tenant.key}" } }
      sort: ["name"]
      limit: -1
    ) {
      slug
      name
      slack_channel
    }
  }
`

type Medium = { slug: string; name: string; slack_channel: string | null }

export function SchnellaktionenBlock() {
  const { data } = useQuery(MEDIEN_QUERY, { errorPolicy: 'all' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const medien: Medium[] = ((data as any)?.faas_medien ?? []) as Medium[]
  const [slug, setSlug] = useState('')
  const [stiftungId, setStiftungId] = useState('')

  const medium = medien.find((m) => m.slug === slug) ?? null
  // Alle Angaben fuellen, damit kein Platzhalter in der Mail landet: die Anrede
  // faellt auf «Liebe Redaktion von X» zurueck, der Absender auf Ramona, und der
  // Weg hinein ist die Login-Seite (kein Link in der Mail, siehe portal-texte.ts).
  const mail = medium
    ? bauWillkommensmail({
        mediumName: medium.name,
        loginSeite: typeof window !== 'undefined' ? `${window.location.origin}/portal/login` : '',
        slack: baueSlackVerweis(medium.slack_channel),
      })
    : null

  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Schnellaktionen
      </h2>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <Select value={slug} onValueChange={setSlug}>
          <SelectTrigger className="w-44 text-sm">
            <SelectValue placeholder="Medium wählen…" />
          </SelectTrigger>
          <SelectContent>
            {medien.map((m) => (
              <SelectItem key={m.slug} value={m.slug} className="text-sm">
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {mail && (
          <MailEntwurfButton
            betreff={mail.betreff}
            text={mail.text}
            label="Willkommensmail"
            titel={`Willkommensmail – ${medium?.name}`}
          />
        )}

        <Input
          value={stiftungId}
          onChange={(e) => setStiftungId(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="Stiftung-ID"
          className="w-32 text-sm"
        />
        {slug && stiftungId && (
          <GesuchPromptButton medium={slug} stiftungId={stiftungId} />
        )}
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        Willkommensmail braucht nur das Medium; der Gesuch-Prompt zusätzlich die Stiftung-ID.
      </p>
    </div>
  )
}
