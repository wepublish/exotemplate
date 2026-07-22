import { useEffect, useState } from 'react'
import { useQuery, useMutation } from '@apollo/client/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { parsePaket, paketChecks, type Paket, type PaketApplication } from '@/lib/pakete'
import {
  PAKETE_ZU_SICHTEN,
  PAKET_UEBERNEHMEN,
  PAKET_VERWERFEN,
  OUTBOX_PROMOTE,
  OUTBOX_PROMOTE_EINZEL,
  OUTBOX_VERWERFEN_BATCH,
  OUTBOX_VERWERFEN_EINZEL,
} from '@/graphql/pakete'
import {
  OUTBOX_ENTWUERFE,
  OUTBOX_COUNT_ENTWURF,
} from '@/graphql/outbox'
import { CREATE_LESSON } from '@/graphql/vorschlaege.mutations'
import { AusblendenDialog } from '@/components/AusblendenDialog'
import { bauAusblendeNotiz, bauAusblendeLesson, type AusblendeGrund } from '@/lib/ausblenden'

// ---- Präsentationale Karte (pure, testbar) ----

export interface SichtungsKarteProps {
  app: PaketApplication
  paket: Paket
  position: number
  total: number
  beschaeftigt: boolean
  onUebernehmen: () => void
  onSpaeter: () => void
  onVerwerfen: () => void
}

/** Formatiert einen Betrag als «CHF 25.000» (Schweizer Tausend-Punkt-Trenner). */
function formatChf(betrag: number): string {
  return 'CHF ' + betrag.toLocaleString('de-CH')
}

export function SichtungsKarte({
  app,
  paket,
  position,
  total,
  beschaeftigt,
  onUebernehmen,
  onSpaeter,
  onVerwerfen,
}: SichtungsKarteProps) {
  const checks = paketChecks(paket)

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {/* Kopfzeile */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <h3 className="font-semibold text-slate-900">
          {app.stiftung_name ?? '(unbekannte Stiftung)'}{' '}
          <span className="font-normal text-slate-500">×</span>{' '}
          {app.medium_id}
        </h3>
        <span className="shrink-0 font-mono text-xs text-slate-400">
          {position} von {total}
        </span>
      </div>

      {/* Score, Betrag, Gold */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-slate-700">Score {paket.score}</span>
        {paket.betrag != null ? (
          <span className="rounded bg-emerald-50 px-2 py-0.5 font-mono text-xs font-medium text-emerald-800">
            {formatChf(paket.betrag.suggested_amount)}
          </span>
        ) : (
          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-400">
            kein Betrag
          </span>
        )}
        {paket.gold && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
            Gold
          </span>
        )}
      </div>

      {/* Begründung */}
      <p className="mb-3 text-sm text-slate-700">{paket.begruendung_kurz}</p>

      {/* Checks */}
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1">
        {checks.map((c) => (
          <span
            key={c.label}
            className={`text-xs ${c.ok ? 'text-slate-700' : 'text-slate-400'}`}
          >
            {c.ok ? '✓' : '–'} {c.label}
          </span>
        ))}
      </div>

      {/* Aktions-Zeile */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={beschaeftigt}
          onClick={onUebernehmen}
        >
          Übernehmen (U)
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={beschaeftigt}
          onClick={onSpaeter}
        >
          Später (S)
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-slate-500 hover:text-red-600"
          disabled={beschaeftigt}
          onClick={onVerwerfen}
        >
          Verwerfen (V)
        </Button>
      </div>
    </div>
  )
}

// ---- Container ----

export default function SichtungsStapel({ user }: { user?: string }) {
  const refetchList = [
    { query: PAKETE_ZU_SICHTEN },
    { query: OUTBOX_ENTWUERFE },
    { query: OUTBOX_COUNT_ENTWURF },
  ]

  const { data } = useQuery(PAKETE_ZU_SICHTEN, {
    pollInterval: 60000,
    errorPolicy: 'all',
  })

  const [uebernehmen] = useMutation(PAKET_UEBERNEHMEN)
  const [verwerfen] = useMutation(PAKET_VERWERFEN)
  const [promoteBatch] = useMutation(OUTBOX_PROMOTE, { refetchQueries: refetchList })
  const [promoteEinzel] = useMutation(OUTBOX_PROMOTE_EINZEL)
  const [verwerfenBatch] = useMutation(OUTBOX_VERWERFEN_BATCH, { refetchQueries: refetchList })
  const [verwerfenEinzel] = useMutation(OUTBOX_VERWERFEN_EINZEL)
  const [createLesson] = useMutation(CREATE_LESSON)

  const [beschaeftigt, setBeschaeftigt] = useState(false)
  // IDs der «Später»-geklickten Einträge — rein client-seitig, kein Server-Write
  const [zurueckgestellt, setZurueckgestellt] = useState<string[]>([])
  // Verwerfen-Dialog: offen/geschlossen
  const [verwerfenDialogOffen, setVerwerfenDialogOffen] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rohe: unknown[] = (data as any)?.applications ?? []

  // Parsed und filtert: Einträge ohne gültiges Paket aussortieren
  const apps: (PaketApplication & { paket: Paket })[] = rohe
    .map((r) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = r as any
      const paket = parsePaket(raw.paket)
      if (!paket) return null
      return {
        id: raw.id,
        medium_id: raw.medium_id,
        stiftung_id: raw.stiftung_id,
        stiftung_name: raw.stiftung_name ?? null,
        status: raw.status,
        gesichtet_am: raw.gesichtet_am ?? null,
        paket,
      }
    })
    .filter((x): x is PaketApplication & { paket: Paket } => x !== null)

  // Anzeigereihenfolge: nicht-zurückgestellte zuerst, dann zurückgestellte
  const sichtbar = [
    ...apps.filter((a) => !zurueckgestellt.includes(a.id)),
    ...zurueckgestellt
      .map((id) => apps.find((a) => a.id === id))
      .filter((a): a is PaketApplication & { paket: Paket } => a !== undefined),
  ]

  const aktuelle = sichtbar[0] ?? null

  // Hilfsfunktion: Outbox-Einträge promoten — Batch, Fallback auf Einzel
  async function promoteOutbox(ids: string[], status: string) {
    if (ids.length === 0) return
    try {
      await promoteBatch({ variables: { ids, status } })
    } catch {
      // Fallback: sequenziell
      for (const id of ids) {
        await promoteEinzel({ variables: { id, status } })
      }
    }
  }

  // Hilfsfunktion: Outbox-Einträge verwerfen — Batch, Fallback auf Einzel
  async function verwerfenOutbox(ids: string[]) {
    if (ids.length === 0) return
    try {
      await verwerfenBatch({ variables: { ids } })
    } catch {
      for (const id of ids) {
        await verwerfenEinzel({ variables: { id } })
      }
    }
  }

  async function handleUebernehmen() {
    if (!aktuelle || beschaeftigt) return
    setBeschaeftigt(true)
    try {
      await uebernehmen({
        variables: { id: aktuelle.id, jetzt: new Date().toISOString() },
        refetchQueries: [{ query: PAKETE_ZU_SICHTEN }],
      })
      if (aktuelle.paket.outbox_ids.length > 0) {
        await promoteOutbox(aktuelle.paket.outbox_ids, 'entwurf')
      }
      toast.success('Paket übernommen, Entwürfe in der Freigabe-Zentrale')
    } catch (err: unknown) {
      toast.error('Fehler: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setBeschaeftigt(false)
    }
  }

  function handleSpaeter() {
    if (!aktuelle || beschaeftigt) return
    // Nur client-seitig verschieben, kein Server-Write
    setZurueckgestellt((prev) => [...prev.filter((id) => id !== aktuelle.id), aktuelle.id])
  }

  /** Öffnet den Ausblenden-Dialog (eigentliches Verwerfen erfolgt nach Grund-Auswahl). */
  function handleVerwerfenAnstossen() {
    if (!aktuelle || beschaeftigt) return
    setVerwerfenDialogOffen(true)
  }

  /** Wird vom Dialog aufgerufen nachdem Grund gewählt wurde. */
  async function handleVerwerfenBestaetigen(grund: AusblendeGrund, freitext: string) {
    if (!aktuelle || beschaeftigt) return
    setBeschaeftigt(true)
    const bemerkung = bauAusblendeNotiz(
      aktuelle.stiftung_name ?? '',
      grund.label,
      freitext,
    )
    try {
      await verwerfen({
        variables: { id: aktuelle.id, bemerkung },
        refetchQueries: [{ query: PAKETE_ZU_SICHTEN }],
      })
      if (aktuelle.paket.outbox_ids.length > 0) {
        await verwerfenOutbox(aktuelle.paket.outbox_ids)
      }
      await createLesson({
        variables: {
          data: bauAusblendeLesson({
            mediumId:    aktuelle.medium_id,
            stiftungId:  String(aktuelle.stiftung_id ?? ''),
            stiftungName: aktuelle.stiftung_name ?? '',
            grundKey:    grund.key,
            grundLabel:  grund.label,
            freitext,
          }),
        },
      })
      toast.success('Paket verworfen')
      setVerwerfenDialogOffen(false)
      // aus der Zurückgestellt-Liste entfernen falls dort
      setZurueckgestellt((prev) => prev.filter((id) => id !== aktuelle.id))
    } catch (err: unknown) {
      toast.error('Fehler: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setBeschaeftigt(false)
    }
  }

  // Tastatur-Shortcuts: u=Übernehmen, s=Später, v=Verwerfen
  // Guard: solange der Dialog offen ist, feuern U/S/V nicht
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Nicht reagieren wenn ein Eingabefeld fokussiert ist
      const tag = (document.activeElement?.tagName ?? '').toLowerCase()
      const isEditable =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        document.activeElement?.getAttribute('contenteditable') === 'true'
      if (isEditable) return
      // Nicht reagieren wenn Dialog offen (Tastatur gehört dem Dialog)
      if (verwerfenDialogOffen) return
      // Nicht reagieren wenn Stapel leer oder gerade beschäftigt
      if (!aktuelle || beschaeftigt) return

      if (e.key === 'u') handleUebernehmen()
      else if (e.key === 's') handleSpaeter()
      else if (e.key === 'v') handleVerwerfenAnstossen()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktuelle, beschaeftigt, verwerfenDialogOffen])

  if (!aktuelle) {
    return (
      <p className="py-6 text-sm text-slate-400">
        Stapel leer. Der Paket-Builder schnürt nachts neue Pakete aus starken Matches.
      </p>
    )
  }

  return (
    <>
      <SichtungsKarte
        app={aktuelle}
        paket={aktuelle.paket}
        position={sichtbar.indexOf(aktuelle) + 1}
        total={sichtbar.length}
        beschaeftigt={beschaeftigt}
        onUebernehmen={handleUebernehmen}
        onSpaeter={handleSpaeter}
        onVerwerfen={handleVerwerfenAnstossen}
      />
      <AusblendenDialog
        offen={verwerfenDialogOffen}
        stiftungName={aktuelle.stiftung_name ?? ''}
        beschaeftigt={beschaeftigt}
        onAbbrechen={() => setVerwerfenDialogOffen(false)}
        onBestaetigen={handleVerwerfenBestaetigen}
      />
    </>
  )
}
