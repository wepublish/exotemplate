import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@apollo/client/react'
import { toast } from 'sonner'
import { Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FAAS_MEDIUM_KONTAKT, UPDATE_FAAS_MEDIUM_KONTAKT } from '@/graphql/medien'
import { parseEmails, formatEmails } from '@/lib/kontakt-emails'
import { tenant } from '../../config/tenant'

/**
 * Editor für die Kontakt-E-Mails eines Mediums (faas_medien.kontakt_emails).
 * Die Adressen sind zugleich die Mail-Versand-Allowlist; sind sie gesetzt, springt
 * der Bereitschafts-Streifen im Cockpit für dieses Medium auf «startklar».
 */
export function KontaktEmailEditor({ mediumSlug }: { mediumSlug: string }) {
  const { data, refetch } = useQuery(FAAS_MEDIUM_KONTAKT, {
    variables: { slug: mediumSlug, mandant: tenant.key },
    fetchPolicy: 'cache-and-network',
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (data as any)?.faas_medien?.[0] ?? null

  const [wert, setWert] = useState('')
  const [dirty, setDirty] = useState(false)
  const [update, { loading }] = useMutation(UPDATE_FAAS_MEDIUM_KONTAKT)

  // Wert aus den gespeicherten Adressen vorbelegen, sobald sie geladen sind.
  useEffect(() => {
    setWert(formatEmails(row?.kontakt_emails))
    setDirty(false)
  }, [row?.kontakt_emails])

  async function speichern() {
    if (!row?.id) {
      toast.error('Medium nicht gefunden')
      return
    }
    const emails = parseEmails(wert)
    try {
      await update({ variables: { id: row.id, data: { kontakt_emails: emails } } })
      toast.success(emails.length ? `${emails.length} Adresse(n) gespeichert` : 'Adressen geleert')
      setDirty(false)
      await refetch()
    } catch (e: unknown) {
      toast.error('Fehler: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  return (
    <div className="border-t border-slate-100 pt-4 space-y-2">
      <div className="flex items-center gap-2">
        <Mail className="w-3.5 h-3.5 text-slate-400" />
        <h4 className="text-xs font-semibold text-slate-700">Kontakt-E-Mails</h4>
      </div>
      <p className="text-[10px] text-slate-400">
        Adressen des Mediums, an die FaaS Mails senden darf (kommagetrennt). Dient als
        Versand-Allowlist; gesetzt = Medium im Cockpit «startklar».
      </p>
      <textarea
        value={wert}
        onChange={(e) => {
          setWert(e.target.value)
          setDirty(true)
        }}
        placeholder="kontakt@medium.ch, redaktion@medium.ch"
        className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-xs min-h-[44px] resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {dirty && (
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-7"
          disabled={loading}
          onClick={speichern}
        >
          Speichern
        </Button>
      )}
    </div>
  )
}
