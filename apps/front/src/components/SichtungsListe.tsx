import { useState } from 'react'
import { useQuery, useMutation } from '@apollo/client/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { parsePaket, type Paket, type PaketApplication } from '@/lib/pakete'
import {
  PAKETE_ZU_SICHTEN,
  PAKET_UEBERNEHMEN,
  PAKET_VERWERFEN,
  OUTBOX_PROMOTE,
  OUTBOX_PROMOTE_EINZEL,
  OUTBOX_VERWERFEN_BATCH,
  OUTBOX_VERWERFEN_EINZEL,
} from '@/graphql/pakete'
import { OUTBOX_ENTWUERFE, OUTBOX_COUNT_ENTWURF } from '@/graphql/outbox'
import { CREATE_LESSON } from '@/graphql/vorschlaege.mutations'
import { AusblendenDialog } from '@/components/AusblendenDialog'
import { bauAusblendeNotiz, bauAusblendeLesson, type AusblendeGrund } from '@/lib/ausblenden'

type Zeile = PaketApplication & { paket: Paket }

/**
 * Listen-Modus der Sichtung: alle ungesichteten Pakete als Tabelle mit
 * Mehrfachauswahl und Sammelaktionen. Für den Stapel-Abbau gebaut — 20 Pakete
 * in Minuten statt Karte für Karte.
 */
export default function SichtungsListe() {
  const refetchList = [
    { query: PAKETE_ZU_SICHTEN },
    { query: OUTBOX_ENTWUERFE },
    { query: OUTBOX_COUNT_ENTWURF },
  ]

  const { data, refetch } = useQuery(PAKETE_ZU_SICHTEN, {
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

  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set())
  const [beschaeftigt, setBeschaeftigt] = useState(false)
  const [verwerfenDialogOffen, setVerwerfenDialogOffen] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rohe: unknown[] = (data as any)?.applications ?? []
  const zeilen: Zeile[] = rohe
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
    .filter((x): x is Zeile => x !== null)
    .sort((a, b) => (b.paket.score ?? 0) - (a.paket.score ?? 0))

  const auswahl = zeilen.filter((z) => gewaehlt.has(z.id))
  const alleGewaehlt = zeilen.length > 0 && auswahl.length === zeilen.length

  function toggle(id: string) {
    setGewaehlt((prev) => {
      const neu = new Set(prev)
      if (neu.has(id)) neu.delete(id)
      else neu.add(id)
      return neu
    })
  }

  function toggleAlle() {
    setGewaehlt(alleGewaehlt ? new Set() : new Set(zeilen.map((z) => z.id)))
  }

  async function promoteOutbox(ids: string[], status: string) {
    if (ids.length === 0) return
    try {
      await promoteBatch({ variables: { ids, status } })
    } catch {
      for (const id of ids) {
        await promoteEinzel({ variables: { id, status } })
      }
    }
  }

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

  async function handleUebernehmenAuswahl() {
    if (auswahl.length === 0 || beschaeftigt) return
    setBeschaeftigt(true)
    let ok = 0
    try {
      for (const z of auswahl) {
        try {
          await uebernehmen({ variables: { id: z.id, jetzt: new Date().toISOString() } })
          if (z.paket.outbox_ids.length > 0) {
            await promoteOutbox(z.paket.outbox_ids, 'entwurf')
          }
          ok += 1
        } catch (err: unknown) {
          toast.error(
            `${z.stiftung_name ?? z.id}: ` +
              (err instanceof Error ? err.message : String(err)),
          )
        }
      }
      if (ok > 0) {
        toast.success(
          `${ok} Paket${ok === 1 ? '' : 'e'} übernommen — Entwürfe liegen in der Freigabe-Zentrale`,
        )
      }
      setGewaehlt(new Set())
      await refetch()
    } finally {
      setBeschaeftigt(false)
    }
  }

  /** Verwirft die ganze Auswahl mit EINEM gemeinsamen Grund (Dialog). */
  async function handleVerwerfenBestaetigen(grund: AusblendeGrund, freitext: string) {
    if (auswahl.length === 0 || beschaeftigt) return
    setBeschaeftigt(true)
    let ok = 0
    try {
      for (const z of auswahl) {
        try {
          const bemerkung = bauAusblendeNotiz(z.stiftung_name ?? '', grund.label, freitext)
          await verwerfen({ variables: { id: z.id, bemerkung } })
          if (z.paket.outbox_ids.length > 0) {
            await verwerfenOutbox(z.paket.outbox_ids)
          }
          await createLesson({
            variables: {
              data: bauAusblendeLesson({
                mediumId: z.medium_id,
                stiftungId: String(z.stiftung_id ?? ''),
                stiftungName: z.stiftung_name ?? '',
                grundKey: grund.key,
                grundLabel: grund.label,
                freitext,
              }),
            },
          })
          ok += 1
        } catch (err: unknown) {
          toast.error(
            `${z.stiftung_name ?? z.id}: ` +
              (err instanceof Error ? err.message : String(err)),
          )
        }
      }
      if (ok > 0) toast.success(`${ok} Paket${ok === 1 ? '' : 'e'} verworfen`)
      setGewaehlt(new Set())
      setVerwerfenDialogOffen(false)
      await refetch()
    } finally {
      setBeschaeftigt(false)
    }
  }

  if (zeilen.length === 0) {
    return (
      <p className="py-6 text-sm text-slate-400">
        Stapel leer. Der Paket-Builder schnürt nachts neue Pakete aus starken Matches.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Sammelaktionen */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={auswahl.length === 0 || beschaeftigt}
          onClick={handleUebernehmenAuswahl}
        >
          Übernehmen ({auswahl.length})
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-slate-500 hover:text-red-600"
          disabled={auswahl.length === 0 || beschaeftigt}
          onClick={() => setVerwerfenDialogOffen(true)}
        >
          Verwerfen ({auswahl.length})
        </Button>
        <span className="ml-auto text-xs text-slate-400">
          {zeilen.length} ungesichtet
        </span>
      </div>

      {/* Tabelle */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  checked={alleGewaehlt}
                  onChange={toggleAlle}
                  aria-label="Alle wählen"
                />
              </th>
              <th className="px-2 py-2 font-medium">Stiftung</th>
              <th className="px-2 py-2 font-medium">Medium</th>
              <th className="px-2 py-2 font-medium">Score</th>
              <th className="px-2 py-2 font-medium">Betrag</th>
              <th className="px-2 py-2 font-medium">Begründung</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => (
              <tr
                key={z.id}
                className={`cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 ${
                  gewaehlt.has(z.id) ? 'bg-indigo-50/60' : ''
                }`}
                onClick={() => toggle(z.id)}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={gewaehlt.has(z.id)}
                    onChange={() => toggle(z.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`${z.stiftung_name ?? z.id} wählen`}
                  />
                </td>
                <td className="px-2 py-2 font-medium text-slate-800">
                  {z.stiftung_name ?? '(unbekannt)'}
                  {z.paket.gold && (
                    <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                      Gold
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-slate-500">{z.medium_id}</td>
                <td className="px-2 py-2 font-mono text-slate-700">{z.paket.score}</td>
                <td className="px-2 py-2 font-mono text-xs text-slate-600">
                  {z.paket.betrag != null
                    ? `CHF ${z.paket.betrag.suggested_amount.toLocaleString('de-CH')}`
                    : '—'}
                </td>
                <td className="max-w-md px-2 py-2 text-xs text-slate-500">
                  <span className="line-clamp-2">{z.paket.begruendung_kurz}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AusblendenDialog
        offen={verwerfenDialogOffen}
        stiftungName={
          auswahl.length === 1
            ? auswahl[0].stiftung_name ?? ''
            : `${auswahl.length} Pakete`
        }
        beschaeftigt={beschaeftigt}
        onAbbrechen={() => setVerwerfenDialogOffen(false)}
        onBestaetigen={handleVerwerfenBestaetigen}
      />
    </div>
  )
}
