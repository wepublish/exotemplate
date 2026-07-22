import { useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { toast } from 'sonner'
import { VorschlagCard } from './VorschlagCard'
import {
  sortVorschlaege,
  bauApplicationDaten,
  bauLessonDaten,
  type VorschlagTyp,
} from '@/lib/vorschlaege'
import {
  VORSCHLAEGE_OFFEN,
  VORSCHLAEGE_COUNT_OFFEN,
  type Vorschlag,
  type VorschlagStatus,
} from '@/graphql/vorschlaege'
import {
  VORSCHLAG_ENTSCHEIDEN,
  VORSCHLAG_ANPASSEN,
  CREATE_LESSON,
} from '@/graphql/vorschlaege.mutations'
import { CREATE_APPLICATION } from '@/graphql/applications.mutations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

const TYPEN: { key: VorschlagTyp | 'alle'; label: string }[] = [
  { key: 'alle', label: 'Alle' },
  { key: 'frist', label: 'Fristen' },
  { key: 'match', label: 'Matches' },
  { key: 'entwurf', label: 'Entwürfe' },
  { key: 'hygiene', label: 'Hygiene' },
]

export function VorschlaegeInbox({ vorschlaege, user }: { vorschlaege: Vorschlag[]; user?: string }) {
  const [filter, setFilter] = useState<VorschlagTyp | 'alle'>('alle')
  const refetch = [{ query: VORSCHLAEGE_OFFEN }, { query: VORSCHLAEGE_COUNT_OFFEN }]
  const [entscheiden] = useMutation(VORSCHLAG_ENTSCHEIDEN, { refetchQueries: refetch })
  const [anpassen] = useMutation(VORSCHLAG_ANPASSEN, { refetchQueries: refetch })
  const [createApp] = useMutation(CREATE_APPLICATION)
  const [createLesson] = useMutation(CREATE_LESSON)

  // Anpassen-Dialog-Zustand
  const [edit, setEdit] = useState<Vorschlag | null>(null)
  const [titel, setTitel] = useState('')
  const [beschreibung, setBeschreibung] = useState('')
  const [stiftungName, setStiftungName] = useState('')

  function oeffneAnpassen(v: Vorschlag) {
    setEdit(v)
    setTitel(v.titel)
    setBeschreibung(v.beschreibung)
    setStiftungName(v.stiftung_name ?? '')
  }

  async function speichereAnpassung() {
    if (!edit) return
    try {
      await anpassen({
        variables: {
          id: edit.id,
          titel,
          beschreibung,
          stiftung_name: stiftungName || null,
          von: user ?? null,
        },
      })
      toast.success('Vorschlag angepasst')
      setEdit(null)
    } catch (err: unknown) {
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Freigeben: bei Match -> Antrag anlegen. Verneinen: Lern-Notiz schreiben.
  // Danach den Vorschlag-Status setzen. Aussen-Gates (Versand/Geld) bleiben separat.
  async function entscheide(v: Vorschlag, status: VorschlagStatus) {
    try {
      if (status === 'verneint') {
        await createLesson({ variables: { data: bauLessonDaten(v, user) } })
      } else if (status === 'freigegeben' && v.typ === 'match') {
        await createApp({ variables: { data: bauApplicationDaten(v, user) } })
      }
      await entscheiden({ variables: { id: v.id, status, von: user ?? null } })
      if (status === 'freigegeben' && v.typ === 'match') {
        toast.success(`«${v.stiftung_name ?? v.titel}» in Anträge übernommen`)
      } else if (status === 'freigegeben') {
        toast.success('Vorschlag freigegeben')
      } else {
        toast.success('Vorschlag verneint')
      }
    } catch (err: unknown) {
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const sichtbar = sortVorschlaege(
    vorschlaege.filter((v) => filter === 'alle' || v.typ === filter),
  )

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {TYPEN.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`rounded-full px-3 py-1 text-sm transition-colors ${
              filter === t.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {sichtbar.length === 0 ? (
        <p className="py-12 text-center text-slate-400">Keine offenen Vorschläge.</p>
      ) : (
        <div className="grid gap-3">
          {sichtbar.map((v) => (
            <VorschlagCard key={v.id} vorschlag={v} onEntscheiden={entscheide} onAnpassen={oeffneAnpassen} />
          ))}
        </div>
      )}

      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Vorschlag anpassen</DialogTitle>
            <DialogDescription>
              Titel, Beschreibung oder Stiftungsname ändern. Der Vorschlag wird als «angepasst»
              markiert.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-500">Titel</p>
              <Input value={titel} onChange={(e) => setTitel(e.target.value)} className="text-sm" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-500">Stiftung</p>
              <Input
                value={stiftungName}
                onChange={(e) => setStiftungName(e.target.value)}
                className="text-sm"
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-500">Beschreibung</p>
              <Textarea
                value={beschreibung}
                onChange={(e) => setBeschreibung(e.target.value)}
                className="h-28 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEdit(null)}>
              Abbrechen
            </Button>
            <Button onClick={speichereAnpassung}>Speichern</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
