import { useState } from 'react'
import { useQuery, useMutation } from '@apollo/client/react'
import { toast } from 'sonner'
import {
  gruppiereNachMedium,
  kannSenden,
  ANLASS_LABEL,
  type OutboxEintrag,
} from '@/lib/outbox'
import {
  OUTBOX_ENTWUERFE,
  OUTBOX_COUNT_ENTWURF,
  OUTBOX_BEARBEITEN,
  OUTBOX_VERWERFEN,
} from '@/graphql/outbox'
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

// Typ-Kurzbezeichnungen für die Badge-Anzeige
const TYP_LABEL: Record<string, string> = {
  mail: 'Mail',
  slack: 'Slack',
  gesuch_final: 'Gesuch-Final',
}

// ---- Präsentationale Komponente (pure, testbar) ----

export interface FreigabeListeProps {
  eintraege: OutboxEintrag[]
  sendetId: string | null
  onSenden: (e: OutboxEintrag) => void
  onVerwerfen: (e: OutboxEintrag) => void
  onAnsehen: (e: OutboxEintrag) => void
  /** Sammel-Freigabe: alle sendbaren Entwürfe einer Medium-Gruppe (D3). */
  onAlleSenden?: (medium: string, zeilen: OutboxEintrag[]) => void
}

export function FreigabeListe({
  eintraege,
  sendetId,
  onSenden,
  onVerwerfen,
  onAnsehen,
  onAlleSenden,
}: FreigabeListeProps) {
  if (eintraege.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-slate-400">
        Nichts versandbereit. Entwürfe entstehen durch den Wächter und künftig den Paket-Builder.
      </p>
    )
  }

  const gruppen = gruppiereNachMedium(eintraege)

  return (
    <div className="space-y-6">
      {gruppen.map(({ medium, eintraege: zeilen }) => (
        <div key={medium}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {medium}
            </p>
            {onAlleSenden && zeilen.filter(kannSenden).length >= 2 && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[11px]"
                disabled={sendetId !== null}
                onClick={() => onAlleSenden(medium, zeilen.filter(kannSenden))}
              >
                Alle senden ({zeilen.filter(kannSenden).length})
              </Button>
            )}
          </div>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {zeilen.map((e) => (
              <div key={e.id} className="flex flex-col gap-1.5 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Anlass-Badge */}
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                    {ANLASS_LABEL[e.anlass] ?? e.anlass}
                  </span>
                  {/* Typ-Badge */}
                  <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
                    {TYP_LABEL[e.typ] ?? e.typ}
                  </span>
                  {/* Empfänger */}
                  {e.empfaenger && (
                    <span className="font-mono text-xs text-slate-500">{e.empfaenger}</span>
                  )}
                </div>
                {/* Inhalt-Vorschau */}
                <p className="line-clamp-2 text-sm text-slate-700">{e.inhalt}</p>
                {/* Aktions-Zeile */}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => onAnsehen(e)}>
                    Ansehen
                  </Button>
                  {kannSenden(e) && (
                    <Button
                      size="sm"
                      disabled={sendetId === e.id}
                      onClick={() => onSenden(e)}
                    >
                      {sendetId === e.id ? 'sendet…' : 'Senden'}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-slate-500 hover:text-red-600"
                    onClick={() => onVerwerfen(e)}
                  >
                    Verwerfen
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- Container-Komponente ----

export default function FreigabeZentrale({ user }: { user?: string }) {
  const refetchList = [{ query: OUTBOX_ENTWUERFE }, { query: OUTBOX_COUNT_ENTWURF }]
  const { data, refetch } = useQuery(OUTBOX_ENTWUERFE, {
    pollInterval: 30000,
    errorPolicy: 'all',
  })
  const [verwerfen] = useMutation(OUTBOX_VERWERFEN, { refetchQueries: refetchList })
  const [bearbeiten] = useMutation(OUTBOX_BEARBEITEN, { refetchQueries: refetchList })

  // Sende-Status: ID des gerade sendenden Eintrags
  const [sendetId, setSendetId] = useState<string | null>(null)

  // Ansehen-/Bearbeiten-Dialog
  const [edit, setEdit] = useState<OutboxEintrag | null>(null)
  const [editEmpfaenger, setEditEmpfaenger] = useState('')
  const [editBetreff, setEditBetreff] = useState('')
  const [editInhalt, setEditInhalt] = useState('')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eintraege: OutboxEintrag[] = ((data as any)?.agent_outbox ?? []) as OutboxEintrag[]

  function oeffneAnsehen(e: OutboxEintrag) {
    setEdit(e)
    setEditEmpfaenger(e.empfaenger ?? '')
    setEditBetreff(e.betreff ?? '')
    setEditInhalt(e.inhalt)
  }

  async function speichereBearbeitung() {
    if (!edit) return
    try {
      await bearbeiten({
        variables: {
          id: edit.id,
          betreff: editBetreff || null,
          inhalt: editInhalt,
          empfaenger: editEmpfaenger || null,
        },
      })
      toast.success('Entwurf gespeichert')
      // Lokalen edit-Stand aktualisieren, damit «Senden» den richtigen Empfänger hat
      setEdit((prev) =>
        prev
          ? { ...prev, empfaenger: editEmpfaenger || null, betreff: editBetreff || null, inhalt: editInhalt }
          : null
      )
    } catch (err: unknown) {
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Interner Versand-Helfer — führt den API-Call aus und zeigt Toast.
  // Gibt true zurück wenn erfolgreich (damit der Dialog schliessen kann).
  async function fuehreVersandAus(id: string, empfaenger: string | null): Promise<boolean> {
    try {
      const resp = await fetch('/api/outbox-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const json = await resp.json()
      if (json.ok) {
        toast.success('Versendet an ' + (empfaenger ?? ''))
        await refetch()
        return true
      } else {
        toast.error(json.fehler ?? 'Versand fehlgeschlagen.')
        return false
      }
    } catch (err: unknown) {
      toast.error('Netzwerkfehler: ' + (err instanceof Error ? err.message : 'unbekannt'))
      return false
    }
  }

  async function sende(e: OutboxEintrag) {
    setSendetId(e.id)
    try {
      await fuehreVersandAus(e.id, e.empfaenger ?? null)
    } finally {
      setSendetId(null)
    }
  }

  async function verwerfeEintrag(e: OutboxEintrag) {
    try {
      await verwerfen({ variables: { id: e.id, von: user ?? null } })
      toast.success('Entwurf verworfen')
      await refetch()
    } catch (err: unknown) {
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Sammel-Freigabe (D3): erst bestätigen, dann sequenziell senden.
  const [alleBestaetigen, setAlleBestaetigen] = useState<{
    medium: string
    zeilen: OutboxEintrag[]
  } | null>(null)

  async function sendeAlleBestaetigt() {
    if (!alleBestaetigen) return
    const { zeilen } = alleBestaetigen
    setAlleBestaetigen(null)
    let ok = 0
    let fehler = 0
    for (const e of zeilen) {
      setSendetId(e.id)
      try {
        const erfolg = await fuehreVersandAus(e.id, e.empfaenger ?? null)
        if (erfolg) ok += 1
        else fehler += 1
      } finally {
        setSendetId(null)
      }
    }
    if (ok > 0) toast.success(`${ok} von ${zeilen.length} versendet`)
    if (fehler > 0) toast.error(`${fehler} fehlgeschlagen — Zeilen bleiben als Entwurf/Fehler stehen`)
    await refetch()
  }

  // Senden aus dem Dialog heraus — speichert zuerst, damit DB-Stand = gesendeter Stand.
  // Schliesst den Dialog bei Erfolg.
  async function sendeAusDemDialog() {
    if (!edit) return
    // Schritt 1: ungespeicherte Änderungen persistieren
    try {
      await bearbeiten({
        variables: {
          id: edit.id,
          betreff: editBetreff || null,
          inhalt: editInhalt,
          empfaenger: editEmpfaenger || null,
        },
      })
    } catch (err: unknown) {
      toast.error(`Speichern fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    // Schritt 2: Versand mit dem jetzt in der DB gespeicherten Empfänger
    const empfaenger = editEmpfaenger || (edit.empfaenger ?? null)
    setSendetId(edit.id)
    try {
      const ok = await fuehreVersandAus(edit.id, empfaenger)
      if (ok) setEdit(null)
    } finally {
      setSendetId(null)
    }
  }

  return (
    <div>
      <FreigabeListe
        eintraege={eintraege}
        sendetId={sendetId}
        onSenden={sende}
        onVerwerfen={verwerfeEintrag}
        onAnsehen={oeffneAnsehen}
        onAlleSenden={(medium, zeilen) => setAlleBestaetigen({ medium, zeilen })}
      />

      {/* Sammel-Freigabe-Bestätigung */}
      <Dialog open={alleBestaetigen !== null} onOpenChange={(o) => !o && setAlleBestaetigen(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Alle senden?</DialogTitle>
            <DialogDescription>
              {alleBestaetigen
                ? `${alleBestaetigen.zeilen.length} Entwürfe für ${alleBestaetigen.medium} werden wirklich versendet (Slack/Mail).`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAlleBestaetigen(null)}>
              Abbrechen
            </Button>
            <Button onClick={sendeAlleBestaetigt}>Ja, alle senden</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Ansehen-/Bearbeiten-Dialog */}
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Entwurf ansehen und bearbeiten</DialogTitle>
            <DialogDescription>
              Empfänger, Betreff und Inhalt anpassen, dann senden oder schliessen.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-500">Empfänger</p>
              <Input
                value={editEmpfaenger}
                onChange={(e) => setEditEmpfaenger(e.target.value)}
                className="text-sm"
              />
            </div>
            {edit?.typ === 'mail' && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-500">Betreff</p>
                <Input
                  value={editBetreff}
                  onChange={(e) => setEditBetreff(e.target.value)}
                  className="text-sm"
                />
              </div>
            )}
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-500">Inhalt</p>
              <Textarea
                value={editInhalt}
                onChange={(e) => setEditInhalt(e.target.value)}
                className="h-48 text-sm"
              />
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setEdit(null)}>
              Schliessen
            </Button>
            <Button variant="outline" onClick={speichereBearbeitung}>
              Speichern
            </Button>
            {edit && kannSenden({ ...edit, empfaenger: editEmpfaenger || edit.empfaenger }) && (
              <Button disabled={sendetId === edit?.id} onClick={sendeAusDemDialog}>
                {sendetId === edit?.id ? 'sendet…' : 'Senden'}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
