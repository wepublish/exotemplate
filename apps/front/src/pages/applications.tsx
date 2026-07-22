import { useState, useEffect } from 'react'
import { useQuery, useMutation, useApolloClient } from '@apollo/client/react'
import { ExternalLink, MessageSquare, FileText, Send, BookOpen, Copy, Check, FolderPlus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { GesuchPromptButton } from '@/components/GesuchPromptButton'
import { ablagePfad, ablageAnzeige } from '@/lib/gesuch-prompt'
import { AusgeblendeteListe } from '@/components/AusgeblendeteListe'
import type { AusgeblendetEintrag } from '@/components/AusgeblendeteListe'
import { AusblendenDialog } from '@/components/AusblendenDialog'
import {
  APPLICATIONS_ALL,
  AUSGEBLENDETE_APPLICATIONS,
  MEDIEN_KANAELE,
} from '@/graphql/applications'
import {
  UPDATE_APPLICATION,
  STATUS_STATION,
  ARBEITS_STATUS,
} from '@/graphql/applications.mutations'
import {
  OUTBOX_FUER_APPLICATION,
  OUTBOX_VERWERFEN_BATCH,
  OUTBOX_VERWERFEN_EINZEL,
  CREATE_OUTBOX,
  OUTBOX_DEDUP_CHECK,
} from '@/graphql/pakete'
import { CREATE_LESSON } from '@/graphql/vorschlaege.mutations'
import { bauAusblendeNotiz, bauAusblendeLesson, type AusblendeGrund } from '@/lib/ausblenden'
import { bauStatusPatch, bauAbsageBemerkung } from '@/lib/vorschlaege'
import { parsePaket, entwurfLabel, gesuchStufe, parseSonderRef, type GesuchStufe } from '@/lib/pakete'
import { parsePortal } from '@/lib/portal-status'
import { baueCoworkAuftrag } from '@/lib/cowork-auftrag'
import { tenant } from '../../config/tenant'

// ─── Typen ────────────────────────────────────────────────────────────────────

interface Application {
  id: string
  medium_id: string | null
  stiftung_id: string | null
  stiftung_name: string | null
  match_result_id: string | null
  station: number | null
  status: string | null
  betrag_chf: number | null
  betrag_zugesagt_chf: number | null
  frist: string | null
  eingereicht_am: string | null
  entschieden_am: string | null
  drive_link: string | null
  slack_thread_url: string | null
  sonder_ref: string | null
  bemerkung: string | null
  verantwortung: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paket: any | null
  /** Rohes portal-json (Task 9-11), defensiv über parsePortal() lesen. */
  portal?: unknown
  date_created: string | null
  date_updated: string | null
}

interface MediumKanal {
  slug: string
  slack_channel: string | null
  kontakt_emails: string | null
}

// ─── Kanban-Konfiguration ─────────────────────────────────────────────────────

const KANBAN_SPALTEN: Array<{
  status: string
  label: string
  farbe: string
  headerFarbe: string
}> = [
  {
    status: 'identifiziert',
    label: 'Identifiziert',
    farbe: 'bg-blue-50 border-blue-200',
    headerFarbe: 'text-blue-700 bg-blue-100',
  },
  {
    status: 'in_arbeit',
    label: 'In Arbeit',
    farbe: 'bg-amber-50 border-amber-200',
    headerFarbe: 'text-amber-700 bg-amber-100',
  },
  {
    status: 'eingereicht',
    label: 'Eingereicht',
    farbe: 'bg-indigo-50 border-indigo-200',
    headerFarbe: 'text-indigo-700 bg-indigo-100',
  },
  {
    status: 'zugesagt',
    label: 'Zugesagt',
    farbe: 'bg-green-50 border-green-200',
    headerFarbe: 'text-green-700 bg-green-100',
  },
  {
    status: 'abgelehnt',
    label: 'Abgelehnt',
    farbe: 'bg-red-50 border-red-200',
    headerFarbe: 'text-red-700 bg-red-100',
  },
]

// ─── Datums-Formatierung ──────────────────────────────────────────────────────

function formatDatum(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** ISO-Datum des heutigen Tags im Format YYYY-MM-DD */
function heuteIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}


// ─── Inline-Bemerkungsfeld ────────────────────────────────────────────────────

function BemerkungFeld({
  antragId,
  initial,
  onSaved,
}: {
  antragId: string
  initial: string | null
  onSaved: () => void
}) {
  const [wert, setWert] = useState(initial ?? '')
  const [dirty, setDirty] = useState(false)
  const [updateApp, { loading }] = useMutation(UPDATE_APPLICATION)

  useEffect(() => {
    setWert(initial ?? '')
    setDirty(false)
  }, [initial])

  async function handleSpeichern() {
    try {
      await updateApp({
        variables: {
          id: antragId,
          data: {
            bemerkung: wert,
            zuletzt_geaendert_quelle: 'matching-app',
          },
        },
      })
      toast.success('Bemerkung gespeichert')
      setDirty(false)
      onSaved()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Fehler: ${msg}`)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Textarea
        value={wert}
        onChange={e => { setWert(e.target.value); setDirty(true) }}
        placeholder="Bemerkung ..."
        className="text-xs min-h-[50px] resize-none"
      />
      {dirty && (
        <Button
          size="sm"
          variant="outline"
          className="self-end text-xs h-7"
          disabled={loading}
          onClick={handleSpeichern}
        >
          Speichern
        </Button>
      )}
    </div>
  )
}

// ─── Drive-Link-Feld ──────────────────────────────────────────────────────────

function DriveLinkFeld({
  antragId,
  initial,
  onSaved,
}: {
  antragId: string
  initial: string | null
  onSaved: () => void
}) {
  const [wert, setWert] = useState(initial ?? '')
  const [dirty, setDirty] = useState(false)
  const [updateApp, { loading }] = useMutation(UPDATE_APPLICATION)

  useEffect(() => {
    setWert(initial ?? '')
    setDirty(false)
  }, [initial])

  async function handleSpeichern() {
    try {
      await updateApp({
        variables: {
          id: antragId,
          data: {
            drive_link: wert || null,
            zuletzt_geaendert_quelle: 'matching-app',
          },
        },
      })
      toast.success('Stiftungs-Ordner gespeichert')
      setDirty(false)
      onSaved()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Fehler: ${msg}`)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="url"
        value={wert}
        onChange={e => { setWert(e.target.value); setDirty(true) }}
        placeholder="Stiftungs-Ordner (URL) ..."
        className="flex h-7 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {wert && !dirty && (
        <a
          href={wert}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-indigo-600 hover:text-indigo-800"
          title="Stiftungs-Ordner öffnen"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
      {dirty && (
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-7 px-2 whitespace-nowrap shrink-0"
          disabled={loading}
          onClick={handleSpeichern}
        >
          OK
        </Button>
      )}
    </div>
  )
}

// ─── Inline-Betrag-Feld (nur bei status=zugesagt) ────────────────────────────

function BetragFeld({
  antragId,
  initial,
  onSaved,
}: {
  antragId: string
  initial: number | null
  onSaved: () => void
}) {
  const initialStr = initial != null ? String(initial) : ''
  const [wert, setWert] = useState(initialStr)
  const [dirty, setDirty] = useState(false)
  const [updateApp, { loading }] = useMutation(UPDATE_APPLICATION)

  useEffect(() => {
    setWert(initial != null ? String(initial) : '')
    setDirty(false)
  }, [initial])

  async function handleSpeichern() {
    const num = parseFloat(wert.replace(',', '.'))
    if (isNaN(num)) {
      toast.error('Ungültiger Betrag')
      return
    }
    try {
      await updateApp({
        variables: {
          id: antragId,
          data: {
            betrag_zugesagt_chf: num,
            zuletzt_geaendert_quelle: 'matching-app',
          },
        },
      })
      toast.success('Betrag gespeichert')
      setDirty(false)
      onSaved()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Fehler: ${msg}`)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={wert}
        onChange={e => { setWert(e.target.value); setDirty(true) }}
        placeholder="Betrag CHF"
        className="flex h-7 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {dirty && (
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-7 px-2 whitespace-nowrap"
          disabled={loading}
          onClick={handleSpeichern}
        >
          OK
        </Button>
      )}
    </div>
  )
}

// ─── Gesuch-Dialog ────────────────────────────────────────────────────────────

function GesuchDialog({
  antrag,
  offen,
  onSchliessen,
  onRefetch,
}: {
  antrag: Application
  offen: boolean
  onSchliessen: () => void
  onRefetch: () => void
}) {
  const paket = parsePaket(antrag.paket)
  const [driveLinkInput, setDriveLinkInput] = useState(antrag.drive_link ?? '')
  const [kopiert, setKopiert] = useState(false)
  const [ordnerLaeuft, setOrdnerLaeuft] = useState(false)
  const [promptLaedt, setPromptLaedt] = useState(false)
  const [updateApp, { loading: updateLoading }] = useMutation(UPDATE_APPLICATION)

  useEffect(() => {
    if (offen) setDriveLinkInput(antrag.drive_link ?? '')
  }, [offen, antrag.drive_link])

  if (!paket) return null

  async function handleFinalMarkieren() {
    if (!driveLinkInput.trim()) {
      toast.error('Drive-Link ist Pflicht')
      return
    }
    try {
      const data: Record<string, unknown> = {
        drive_link: driveLinkInput.trim(),
        zuletzt_geaendert_quelle: 'matching-app',
      }
      // Nur auf in_arbeit setzen, wenn Status noch identifiziert ist
      if (antrag.status === 'identifiziert') {
        data.status = 'in_arbeit'
        data.station = STATUS_STATION['in_arbeit']
      }
      await updateApp({ variables: { id: antrag.id, data } })
      toast.success('Als final markiert, Drive-Link gespeichert')
      onSchliessen()
      onRefetch()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Fehler: ${msg}`)
    }
  }

  /** Legt den Stiftungs-Ordner im Drive an (falls nötig) und füllt den Link automatisch. */
  async function handleOrdnerVerknuepfen() {
    if (!paket) return
    const ablage = paket.gesuch_ablage && String(paket.gesuch_ablage).trim()
      ? String(paket.gesuch_ablage)
      : ablagePfad(antrag.medium_id ?? '', antrag.stiftung_name ?? '')
    setOrdnerLaeuft(true)
    try {
      const r = await fetch('/api/drive-ordner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ablage }),
      })
      const j = (await r.json()) as { ok?: boolean; url?: string; fehler?: string }
      if (j.ok && j.url) {
        setDriveLinkInput(j.url)
        toast.success('Stiftungs-Ordner angelegt und verknüpft')
      } else {
        toast.error('Ordner-Verknüpfung fehlgeschlagen: ' + (j.fehler ?? 'unbekannt'))
      }
    } catch (e: unknown) {
      toast.error('Fehler: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setOrdnerLaeuft(false)
    }
  }

  function handleKopieren(text: string, label: string) {
    navigator.clipboard.writeText(text).then(
      () => {
        setKopiert(true)
        toast.success(`${label} kopiert`)
        setTimeout(() => setKopiert(false), 2000)
      },
      () => toast.error('Kopieren fehlgeschlagen'),
    )
  }

  /**
   * Holt den Gold-Prompt FRISCH mit stil=verweis (verweist auf das Paradegesuch
   * im Drive, statt es einzubetten) und kopiert ihn. Der im paket gespeicherte
   * Prompt bleibt der eingebettete Volltext — den nutzt der nächtliche Text-Loop.
   */
  async function handleGoldPromptKopieren() {
    if (!antrag.medium_id || !antrag.stiftung_id) {
      if (paket?.gesuch_prompt) handleKopieren(paket.gesuch_prompt, 'Prompt')
      return
    }
    setPromptLaedt(true)
    try {
      const r = await fetch(
        `/api/gesuch-prompt?medium=${encodeURIComponent(antrag.medium_id)}&stiftung_id=${encodeURIComponent(
          antrag.stiftung_id,
        )}&stil=verweis`,
      )
      const j = await r.json()
      if (!r.ok || !j.prompt) throw new Error(j.error || 'Fehler beim Laden')
      handleKopieren(j.prompt, 'Prompt')
    } catch (e: unknown) {
      toast.error(`Fehler: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPromptLaedt(false)
    }
  }

  return (
    <Dialog open={offen} onOpenChange={v => { if (!v) onSchliessen() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            Gesuch: {antrag.stiftung_name ?? '—'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Entwurf vorhanden */}
          {paket.gesuch_entwurf ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-slate-500 font-medium">{entwurfLabel(paket)}</p>
              <Textarea
                readOnly
                value={paket.gesuch_entwurf}
                className="h-64 text-xs font-mono resize-none bg-slate-50"
              />
              <Button
                size="sm"
                variant="outline"
                className="self-end text-xs h-7 gap-1"
                onClick={() => handleKopieren(paket.gesuch_entwurf!, 'Entwurf')}
              >
                {kopiert ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                Entwurf kopieren
              </Button>
            </div>
          ) : paket.gold ? (
            /* Gold-Gesuch: Opus-Prompt */
            <div className="flex flex-col gap-2">
              <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
                <p className="text-xs text-amber-800 font-medium">
                  Gold-Gesuch: mit Opus veredeln (Prompt kopieren, in der Claude-App ausfuehren)
                </p>
              </div>
              {paket.gesuch_prompt && (
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start text-xs h-7 gap-1"
                  onClick={handleGoldPromptKopieren}
                  disabled={promptLaedt}
                >
                  {kopiert ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {promptLaedt ? 'Lädt …' : 'Prompt kopieren'}
                </Button>
              )}
              {paket.gesuch_ablage && (
                <p className="text-[10px] text-slate-400 font-mono">
                  Ablage: {ablageAnzeige(paket.gesuch_ablage)}
                </p>
              )}
            </div>
          ) : (
            /* Noch kein Entwurf */
            <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2">
              <p className="text-xs text-slate-500">
                Gesuch-Entwurf folgt mit dem naechsten Builder-Lauf.
              </p>
            </div>
          )}

          {/* Final markieren */}
          <div className="border-t border-slate-100 pt-3">
            <p className="text-xs text-slate-500 mb-1.5 font-medium">Final markieren</p>
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7 gap-1 mb-2"
              disabled={ordnerLaeuft}
              onClick={handleOrdnerVerknuepfen}
            >
              {ordnerLaeuft ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderPlus className="w-3 h-3" />}
              Stiftungs-Ordner anlegen &amp; verknüpfen
            </Button>
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={driveLinkInput}
                onChange={e => setDriveLinkInput(e.target.value)}
                placeholder="Stiftungs-Ordner-Link (Pflicht) ..."
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Speichert den Link zum Stiftungs-Ordner (Drive). Damit erscheint der Antrag in der
              Übersicht und der Roadmap
              {antrag.status === 'identifiziert' ? ' und der Status wird auf In Arbeit gesetzt.' : '.'}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={onSchliessen}
          >
            Schliessen
          </Button>
          <Button
            size="sm"
            className="text-xs"
            disabled={updateLoading || !driveLinkInput.trim()}
            onClick={handleFinalMarkieren}
          >
            Final markieren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Vom Medium angefordert (Task 11): Cowork-Übergabe + Freigabe ─────────────
//
// Operator-Gegenseite zu Task 9 (Portal-Anschreiben) und Task 10 (Portal-
// Gesuchseite): ein Medium hat über das Portal ein Gesuch angefordert
// (portal.angefordert_am gesetzt), der Operator holt sich dafür einen
// Cowork-Auftrag (Copy-paste, wie der bestehende Gesuch-Prompt-Knopf, nur
// zusätzlich gerahmt mit Ablage- und Sprachregeln), trägt den fertigen
// Gesuchtext + Beilagen ein und gibt erst dann fürs Medium frei
// (portal.freigegeben_am). Vorher sieht das Medium im Portal weder Text noch
// Beilagen (siehe GESUCH_STATUS_AB_BEREIT, portal-status.ts).

function VomMediumAngefordert({
  antraege,
  onRefetch,
}: {
  antraege: Application[]
  onRefetch: () => void
}) {
  const relevante = antraege.filter(a => {
    const portal = parsePortal(a.portal)
    return !!portal.angefordert_am && !portal.freigegeben_am
  })

  if (relevante.length === 0) return null

  return (
    <div className="mb-8">
      <h2 className="text-sm font-semibold text-slate-700 mb-2">
        Vom Medium angefordert ({relevante.length})
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {relevante.map(antrag => (
          <AngefordertKarte key={antrag.id} antrag={antrag} onRefetch={onRefetch} />
        ))}
      </div>
    </div>
  )
}

function AngefordertKarte({
  antrag,
  onRefetch,
}: {
  antrag: Application
  onRefetch: () => void
}) {
  const portal = parsePortal(antrag.portal)
  const paket = parsePaket(antrag.paket)
  const mediumName = MEDIUM_LABELS[antrag.medium_id ?? ''] ?? antrag.medium_id ?? '-'
  const stiftungName = antrag.stiftung_name ?? '-'
  const angefordertAm = formatDatum(portal.angefordert_am)

  const [text, setText] = useState(portal.gesuch_text ?? '')
  const [datei, setDatei] = useState<globalThis.File | null>(null)
  const [kopierenLaeuft, setKopierenLaeuft] = useState(false)
  const [speichernLaeuft, setSpeichernLaeuft] = useState(false)
  const [freigebenLaeuft, setFreigebenLaeuft] = useState(false)
  const [freigabeOffen, setFreigabeOffen] = useState(false)

  async function kopiereCoworkAuftrag() {
    setKopierenLaeuft(true)
    try {
      const r = await fetch(
        `/api/gesuch-prompt?medium=${encodeURIComponent(antrag.medium_id ?? '')}` +
          `&stiftung_id=${encodeURIComponent(antrag.stiftung_id ?? '')}&stil=verweis`,
      )
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Fehler beim Laden')
      const auftrag = baueCoworkAuftrag({
        gesuchPrompt: j.prompt,
        mediumName,
        stiftungName,
        ablagePfad: j.ablage,
      })
      await navigator.clipboard.writeText(auftrag)
      toast.success('Cowork-Auftrag kopiert')
    } catch (e: unknown) {
      toast.error(`Fehler: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setKopierenLaeuft(false)
    }
  }

  function studioEntwurfUebernehmen() {
    if (!paket?.gesuch_entwurf) return
    setText(paket.gesuch_entwurf)
    toast.success('Studio-Entwurf übernommen, vor dem Speichern prüfen')
  }

  async function speichern() {
    if (!text.trim() && !datei) {
      toast.error('Text oder Datei erforderlich.')
      return
    }
    setSpeichernLaeuft(true)
    try {
      let r: Response
      if (datei) {
        const form = new FormData()
        form.append('id', antrag.id)
        form.append('text', text)
        form.append('file', datei)
        r = await fetch('/api/gesuch-text-erfassen', { method: 'POST', body: form })
      } else {
        r = await fetch('/api/gesuch-text-erfassen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: antrag.id, text }),
        })
      }
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Speichern fehlgeschlagen')
      toast.success('Gesuch-Text gespeichert')
      setDatei(null)
      onRefetch()
    } catch (e: unknown) {
      toast.error(`Fehler: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSpeichernLaeuft(false)
    }
  }

  async function freigeben() {
    setFreigebenLaeuft(true)
    try {
      const r = await fetch('/api/gesuch-freigeben', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: antrag.id }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Freigabe fehlgeschlagen')
      toast.success('Fürs Medium freigegeben')
      setFreigabeOffen(false)
      onRefetch()
    } catch (e: unknown) {
      toast.error(`Fehler: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setFreigebenLaeuft(false)
    }
  }

  const kannFreigeben = !!portal.gesuch_text?.trim()

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-3 flex flex-col gap-2">
      <div>
        <p className="text-sm font-semibold text-slate-800">
          {mediumName} × {stiftungName}
        </p>
        <p className="text-[10px] text-slate-400">
          angefordert{portal.angefordert_von ? ` von ${portal.angefordert_von}` : ''}
          {angefordertAm ? ` am ${angefordertAm}` : ''}
        </p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          className="text-xs h-7 gap-1"
          disabled={kopierenLaeuft}
          onClick={kopiereCoworkAuftrag}
        >
          {kopierenLaeuft ? <Loader2 className="w-3 h-3 animate-spin" /> : <Copy className="w-3 h-3" />}
          Cowork-Auftrag kopieren
        </Button>
        {paket?.gesuch_entwurf && (
          <Button
            size="sm"
            variant="ghost"
            className="text-xs h-7 text-slate-500"
            onClick={studioEntwurfUebernehmen}
          >
            Studio-Entwurf übernehmen
          </Button>
        )}
      </div>

      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Gesuch-Text der Stiftung übergeben"
        className="text-xs min-h-[120px]"
      />

      <input
        type="file"
        onChange={e => setDatei(e.target.files?.[0] ?? null)}
        className="text-xs text-slate-500"
      />

      <div className="flex gap-1.5 justify-end pt-1">
        <Button size="sm" variant="outline" className="text-xs h-7" disabled={speichernLaeuft} onClick={speichern}>
          {speichernLaeuft && <Loader2 className="w-3 h-3 animate-spin" />}
          Speichern
        </Button>
        <Button
          size="sm"
          className="text-xs h-7"
          disabled={!kannFreigeben}
          onClick={() => setFreigabeOffen(true)}
        >
          Fürs Medium freigeben
        </Button>
      </div>

      <Dialog open={freigabeOffen} onOpenChange={v => { if (!v) setFreigabeOffen(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">Fürs Medium freigeben</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-500">
            Erst dieser Klick macht das Gesuch im Portal sichtbar.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setFreigabeOffen(false)}>
              Abbrechen
            </Button>
            <Button size="sm" className="text-xs" disabled={freigebenLaeuft} onClick={freigeben}>
              Freigeben
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Gesuch-Warteschlange (C1): wartet auf Entwurf / Review / final ───────────

const STUFEN_META: Record<GesuchStufe, { label: string; sub: string; farbe: string }> = {
  wartet: {
    label: 'Wartet auf Entwurf',
    sub: 'Loop schreibt nachts — oder «Entwurf jetzt»',
    farbe: 'border-slate-200',
  },
  review: {
    label: 'Entwurf zum Review',
    sub: 'Lesen, anpassen, final markieren',
    farbe: 'border-indigo-200',
  },
  final: {
    label: 'Final',
    sub: 'Gesuch im Stiftungs-Ordner',
    farbe: 'border-green-200',
  },
}

function GesuchWarteschlange({
  antraege,
  onRefetch,
}: {
  antraege: Application[]
  onRefetch: () => void
}) {
  const [laufend, setLaufend] = useState<Set<string>>(new Set())
  const [dialogAntrag, setDialogAntrag] = useState<Application | null>(null)

  const relevante = antraege.filter(
    a =>
      (a.status === 'identifiziert' || a.status === 'in_arbeit') &&
      parsePaket(a.paket) !== null,
  )

  // Polling solange «Entwurf jetzt»-Läufe offen sind: alle 10s refetchen,
  // bis der Entwurf im paket erscheint (dann fällt der Antrag aus «laufend»).
  useEffect(() => {
    if (laufend.size === 0) return
    const t = setInterval(() => onRefetch(), 10000)
    return () => clearInterval(t)
  }, [laufend.size, onRefetch])

  useEffect(() => {
    if (laufend.size === 0) return
    setLaufend(prev => {
      const neu = new Set(prev)
      for (const id of prev) {
        const a = relevante.find(x => x.id === id)
        const p = a ? parsePaket(a.paket) : null
        if (p?.gesuch_entwurf) {
          neu.delete(id)
          toast.success(`Entwurf bereit: ${a?.stiftung_name ?? id}`)
        }
      }
      return neu.size === prev.size ? prev : neu
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [antraege])

  async function handleEntwurfJetzt(a: Application) {
    try {
      const r = await fetch('/api/gesuch-entwurf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id }),
      })
      const j = (await r.json()) as { status?: string; error?: string; note?: string }
      if (j.status === 'gestartet' || j.status === 'läuft bereits') {
        setLaufend(prev => new Set(prev).add(a.id))
        toast.success('Entwurf läuft — dauert etwa eine Minute')
      } else {
        toast.error(j.error ?? j.note ?? j.status ?? 'Start fehlgeschlagen')
      }
    } catch (e: unknown) {
      toast.error('Fehler: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  if (relevante.length === 0) return null

  const nachStufe: Record<GesuchStufe, Application[]> = { wartet: [], review: [], final: [] }
  for (const a of relevante) {
    const stufe = gesuchStufe({ drive_link: a.drive_link, paket: parsePaket(a.paket) })
    if (stufe) nachStufe[stufe].push(a)
  }

  return (
    <div className="mb-8">
      <h2 className="text-sm font-semibold text-slate-700 mb-2">
        Gesuch-Warteschlange ({relevante.length})
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(Object.keys(STUFEN_META) as GesuchStufe[]).map(stufe => (
          <div
            key={stufe}
            className={`rounded-xl border bg-white ${STUFEN_META[stufe].farbe}`}
          >
            <div className="px-3 py-2 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-700">
                {STUFEN_META[stufe].label}{' '}
                <span className="font-mono text-slate-400">{nachStufe[stufe].length}</span>
              </p>
              <p className="text-[10px] text-slate-400">{STUFEN_META[stufe].sub}</p>
            </div>
            <div className="p-2 flex flex-col gap-1.5 max-h-64 overflow-y-auto">
              {nachStufe[stufe].length === 0 ? (
                <p className="text-[11px] text-slate-300 px-1 py-2">—</p>
              ) : (
                nachStufe[stufe].map(a => (
                  <div
                    key={a.id}
                    className="flex items-center gap-2 rounded-md border border-slate-100 px-2 py-1.5"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-800 truncate">
                        {a.stiftung_name ?? '—'}
                      </p>
                      <p className="text-[10px] text-slate-400">{a.medium_id}</p>
                    </div>
                    {stufe === 'wartet' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[10px] h-6 px-2 shrink-0"
                        disabled={laufend.has(a.id)}
                        onClick={() => handleEntwurfJetzt(a)}
                      >
                        {laufend.has(a.id) ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" /> läuft
                          </>
                        ) : (
                          'Entwurf jetzt'
                        )}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-[10px] h-6 px-2 shrink-0 text-slate-500"
                      onClick={() => setDialogAntrag(a)}
                    >
                      Gesuch
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
      {dialogAntrag && (
        <GesuchDialog
          antrag={dialogAntrag}
          offen={true}
          onSchliessen={() => setDialogAntrag(null)}
          onRefetch={onRefetch}
        />
      )}
    </div>
  )
}

// ─── Ein-Klick-Ausgang (Eingereicht / Zusage / Absage) ────────────────────────

function AusgangKnoepfe({
  antrag,
  onRefetch,
}: {
  antrag: Application
  onRefetch: () => void
}) {
  const [updateApp, { loading }] = useMutation(UPDATE_APPLICATION)
  const [zusageOffen, setZusageOffen] = useState(false)
  const [absageOffen, setAbsageOffen] = useState(false)
  const [betrag, setBetrag] = useState('')
  const [grund, setGrund] = useState('')

  async function setzeStatus(neuerStatus: string, extra: Record<string, unknown> = {}) {
    const stempel = bauStatusPatch(neuerStatus, {
      eingereicht_am: antrag.eingereicht_am,
      entschieden_am: antrag.entschieden_am,
    })
    try {
      await updateApp({
        variables: {
          id: antrag.id,
          data: {
            status: neuerStatus,
            station: STATUS_STATION[neuerStatus] ?? 1,
            ...stempel,
            ...extra,
            zuletzt_geaendert_quelle: 'matching-app',
          },
        },
      })
      toast.success(
        `${antrag.stiftung_name ?? 'Antrag'}: ${ARBEITS_STATUS.find(s => s.value === neuerStatus)?.label ?? neuerStatus}`,
      )
      setZusageOffen(false)
      setAbsageOffen(false)
      onRefetch()
    } catch (err: unknown) {
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function handleZusage() {
    const zahl = parseFloat(betrag.replace(/[^0-9.,]/g, '').replace(',', '.'))
    const extra: Record<string, unknown> = {}
    if (!isNaN(zahl) && zahl > 0) extra.betrag_zugesagt_chf = zahl
    setzeStatus('zugesagt', extra)
  }

  function handleAbsage() {
    const extra: Record<string, unknown> = {}
    const bemerkung = bauAbsageBemerkung(antrag.bemerkung, grund)
    if (bemerkung) extra.bemerkung = bemerkung
    setzeStatus('abgelehnt', extra)
  }

  return (
    <div className="border-t border-slate-100 pt-2 flex flex-col gap-1.5">
      <p className="text-[10px] text-slate-500">Ausgang erfassen</p>
      <div className="flex gap-1.5">
        {(antrag.status === 'identifiziert' || antrag.status === 'in_arbeit') && (
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs h-7 gap-1 text-indigo-700 border-indigo-200 hover:bg-indigo-50"
            disabled={loading}
            onClick={() => setzeStatus('eingereicht')}
          >
            <Send className="w-3 h-3" />
            Eingereicht
          </Button>
        )}
        {antrag.status === 'eingereicht' && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs h-7 text-green-700 border-green-200 hover:bg-green-50"
              disabled={loading}
              onClick={() => setZusageOffen(true)}
            >
              Zusage …
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs h-7 text-red-700 border-red-200 hover:bg-red-50"
              disabled={loading}
              onClick={() => setAbsageOffen(true)}
            >
              Absage …
            </Button>
          </>
        )}
      </div>

      {/* Zusage-Dialog: Betrag erfassen */}
      <Dialog open={zusageOffen} onOpenChange={v => { if (!v) setZusageOffen(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              Zusage: {antrag.stiftung_name ?? '—'}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-1">
            <p className="text-xs text-slate-500">
              Zugesagter Betrag (CHF, optional). Fliesst als Anker in künftige
              Betrags-Schätzungen und Gesuche ein.
            </p>
            <input
              type="text"
              value={betrag}
              onChange={e => setBetrag(e.target.value)}
              placeholder="z.B. 20000"
              autoFocus
              className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setZusageOffen(false)}>
              Abbrechen
            </Button>
            <Button size="sm" className="text-xs" disabled={loading} onClick={handleZusage}>
              Zusage speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Absage-Dialog: Grund erfassen */}
      <Dialog open={absageOffen} onOpenChange={v => { if (!v) setAbsageOffen(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              Absage: {antrag.stiftung_name ?? '—'}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-1">
            <p className="text-xs text-slate-500">
              Grund (optional). Landet in der Bemerkung und speist den Lern-Loop.
            </p>
            <Textarea
              value={grund}
              onChange={e => setGrund(e.target.value)}
              placeholder="z.B. fördert nur institutionelle Projekte"
              className="text-xs min-h-[60px] resize-none"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setAbsageOffen(false)}>
              Abbrechen
            </Button>
            <Button size="sm" className="text-xs" disabled={loading} onClick={handleAbsage}>
              Absage speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Antrags-Karte ────────────────────────────────────────────────────────────

function AntragCard({
  antrag,
  medienKanaele,
  onRefetch,
}: {
  antrag: Application
  medienKanaele: MediumKanal[]
  onRefetch: () => void
}) {
  const apolloClient = useApolloClient()
  const fristFormatiert = formatDatum(antrag.frist)
  const eingereichtFormatiert = formatDatum(antrag.eingereicht_am)
  const entschiedenFormatiert = formatDatum(antrag.entschieden_am)
  const paket = parsePaket(antrag.paket)

  const [updateApp, { loading: updateLoading }] = useMutation(UPDATE_APPLICATION)
  const [verwerfenBatch] = useMutation(OUTBOX_VERWERFEN_BATCH)
  const [verwerfenEinzel] = useMutation(OUTBOX_VERWERFEN_EINZEL)
  const [createLesson] = useMutation(CREATE_LESSON)
  const [createOutbox] = useMutation(CREATE_OUTBOX)
  const [ausblendenOffen, setAusblendenOffen] = useState(false)
  const [ausblendenBeschaeftigt, setAusblendenBeschaeftigt] = useState(false)
  const [gesuchOffen, setGesuchOffen] = useState(false)
  const [nachfassenLaeuft, setNachfassenLaeuft] = useState(false)

  async function handleStatusChange(neuerStatus: string) {
    const station = STATUS_STATION[neuerStatus] ?? 1
    // Auto-Stempel beim Statuswechsel
    const stempel = bauStatusPatch(neuerStatus, {
      eingereicht_am: antrag.eingereicht_am,
      entschieden_am: antrag.entschieden_am,
    })
    try {
      await updateApp({
        variables: {
          id: antrag.id,
          data: {
            status: neuerStatus,
            station,
            ...stempel,
            zuletzt_geaendert_quelle: 'matching-app',
          },
        },
      })
      toast.success(`Status: ${ARBEITS_STATUS.find(s => s.value === neuerStatus)?.label ?? neuerStatus}`)
      onRefetch()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Fehler: ${msg}`)
    }
  }

  async function handleNachfassen() {
    if (!antrag.medium_id) return
    const kanal = medienKanaele.find(m => m.slug === antrag.medium_id)

    // Kanal bestimmen
    const slackKanal = kanal?.slack_channel?.trim() || null
    const ersteMail = kanal?.kontakt_emails
      ? kanal.kontakt_emails.split(',')[0].trim()
      : null
    const typ: string | null = slackKanal ? 'slack' : ersteMail ? 'mail' : null

    if (!typ) {
      toast.warning('Kein Kanal/Kontakt fuers Medium gepflegt (Onboarding)')
      return
    }

    const dedupKey = `outbox|nachfass-manuell|${antrag.id}|${heuteIso()}`

    setNachfassenLaeuft(true)
    try {
      // Dedup-Pruefung
      const { data: dedupData } = await apolloClient.query({
        query: OUTBOX_DEDUP_CHECK,
        variables: { dedupKey },
        fetchPolicy: 'network-only',
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vorhandenIds: string[] = ((dedupData as any)?.agent_outbox ?? []).map(
        (o: { id: string }) => o.id,
      )
      if (vorhandenIds.length > 0) {
        toast.info('Heute schon entworfen')
        return
      }

      const datumText = eingereichtFormatiert
        ? `eingereicht am ${eingereichtFormatiert}`
        : 'vor einiger Zeit'
      const inhalt =
        `Kurzes Nachfassen zu eurem Gesuch bei ${antrag.stiftung_name ?? 'der Stiftung'}: ` +
        `${datumText}. Gibt es Neuigkeiten von der Stiftung? ` +
        `Wenn ihr etwas von uns braucht, meldet euch kurz. ` +
        `Der Gerät, FaaS`

      await createOutbox({
        variables: {
          data: {
            typ,
            anlass: 'nachfassen',
            status: 'entwurf',
            medium_id: antrag.medium_id,
            application_id: antrag.id,
            stiftung_id: antrag.stiftung_id ? parseInt(antrag.stiftung_id, 10) : undefined,
            empfaenger: slackKanal ?? ersteMail,
            inhalt,
            erstellt_von: 'kanban',
            mandant: tenant.key,
            dedup_key: dedupKey,
          },
        },
      })
      toast.success('Nachfass-Entwurf liegt in der Freigabe-Zentrale')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Fehler: ${msg}`)
    } finally {
      setNachfassenLaeuft(false)
    }
  }

  /**
   * Antrag nachtraeglich ausblenden (direkt aus der Kanban-Karte).
   */
  async function handleAusblenden(grund: AusblendeGrund, freitext: string) {
    setAusblendenBeschaeftigt(true)
    const stiftungName = antrag.stiftung_name ?? '—'
    try {
      await updateApp({
        variables: {
          id: antrag.id,
          data: {
            status: 'ausgeblendet',
            station: STATUS_STATION['ausgeblendet'],
            bemerkung: bauAusblendeNotiz(stiftungName, grund.label, freitext),
            zuletzt_geaendert_quelle: 'matching-app',
          },
        },
      })

      // Offene Outbox-Eintraege mitverwerfen
      try {
        const { data: outboxData } = await apolloClient.query({
          query: OUTBOX_FUER_APPLICATION,
          variables: { appId: antrag.id },
          fetchPolicy: 'network-only',
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const outboxIds: string[] = ((outboxData as any)?.agent_outbox ?? []).map(
          (o: { id: string }) => o.id,
        )
        if (outboxIds.length > 0) {
          try {
            await verwerfenBatch({ variables: { ids: outboxIds } })
          } catch {
            for (const id of outboxIds) {
              try {
                await verwerfenEinzel({ variables: { id } })
              } catch {
                // Einzelfehler nicht kritisch
              }
            }
          }
        }
      } catch {
        // Outbox-Fehler nicht kritisch
      }

      // Lern-Loop
      if (antrag.medium_id && antrag.stiftung_id) {
        await createLesson({
          variables: {
            data: bauAusblendeLesson({
              mediumId: antrag.medium_id,
              stiftungId: antrag.stiftung_id,
              stiftungName,
              grundKey: grund.key,
              grundLabel: grund.label,
              freitext,
            }),
          },
        })
      }

      toast.success(`«${stiftungName}» ausgeblendet`)
      setAusblendenOffen(false)
      onRefetch()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Fehler beim Ausblenden: ${msg}`)
    } finally {
      setAusblendenBeschaeftigt(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col gap-3">
      {/* Stiftungsname + Station-Badge */}
      <div>
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-slate-800 leading-snug">
            {antrag.stiftung_name ?? '—'}
          </p>
          {antrag.station != null && (
            <span className="shrink-0 text-[9px] font-mono bg-slate-100 text-slate-500 rounded px-1.5 py-0.5 border border-slate-200">
              Station {antrag.station}
            </span>
          )}
        </div>
        {antrag.stiftung_id && (
          <p className="text-[10px] text-slate-400 font-mono mt-0.5">
            ID {antrag.stiftung_id}
          </p>
        )}
      </div>

      {/* Medium-Badge + Betrag */}
      <div className="flex flex-wrap gap-2 items-center">
        {antrag.medium_id && (
          <Badge
            variant="outline"
            className="text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200"
          >
            {antrag.medium_id}
          </Badge>
        )}
        {antrag.betrag_chf != null && (
          <span className="text-[10px] text-slate-500">
            CHF {antrag.betrag_chf.toLocaleString('de-CH')}
          </span>
        )}
        {antrag.betrag_zugesagt_chf != null && (
          <span className="text-[10px] text-green-600 font-medium">
            CHF {antrag.betrag_zugesagt_chf.toLocaleString('de-CH')} zugesagt
          </span>
        )}
      </div>

      {/* Metadaten: Frist + Verantwortung */}
      <div className="flex flex-wrap gap-3 text-[10px] text-slate-500">
        {fristFormatiert && <span>Frist: {fristFormatiert}</span>}
        {antrag.verantwortung && <span>{antrag.verantwortung}</span>}
      </div>

      {/* Datumszeilen */}
      {(eingereichtFormatiert || entschiedenFormatiert) && (
        <div className="flex flex-col gap-0.5 text-[10px] text-slate-400">
          {eingereichtFormatiert && (
            <span>Eingereicht: {eingereichtFormatiert}</span>
          )}
          {entschiedenFormatiert && (
            <span>Entschieden: {entschiedenFormatiert}</span>
          )}
        </div>
      )}

      {/* Drive-Link + Slack */}
      {antrag.slack_thread_url && (
        <div className="flex gap-3 border-t border-slate-100 pt-1">
          <a
            href={antrag.slack_thread_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-indigo-600 hover:underline"
          >
            <MessageSquare className="w-3 h-3" />
            Slack
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      )}

      {/* Drive-Link-Feld */}
      <div className="border-t border-slate-100 pt-2">
        <p className="text-[10px] text-slate-500 mb-1">
          <FileText className="inline w-3 h-3 mr-0.5" />
          Stiftungs-Ordner (Drive)
        </p>
        <DriveLinkFeld
          antragId={antrag.id}
          initial={antrag.drive_link}
          onSaved={onRefetch}
        />
      </div>

      {/* Ein-Klick-Ausgang (Eingereicht / Zusage / Absage) */}
      {(antrag.status === 'identifiziert' ||
        antrag.status === 'in_arbeit' ||
        antrag.status === 'eingereicht') && (
        <AusgangKnoepfe antrag={antrag} onRefetch={onRefetch} />
      )}

      {/* Status-Wechsler */}
      <div className="border-t border-slate-100 pt-2">
        <Select
          value={antrag.status ?? 'identifiziert'}
          onValueChange={handleStatusChange}
          disabled={updateLoading}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Status waehlen" />
          </SelectTrigger>
          <SelectContent>
            {ARBEITS_STATUS.map(s => (
              <SelectItem key={s.value} value={s.value} className="text-xs">
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Betrag zugesagt (nur bei status=zugesagt) */}
      {antrag.status === 'zugesagt' && (
        <div className="border-t border-slate-100 pt-2">
          <p className="text-[10px] text-slate-500 mb-1">Betrag zugesagt (CHF)</p>
          <BetragFeld
            antragId={antrag.id}
            initial={antrag.betrag_zugesagt_chf}
            onSaved={onRefetch}
          />
        </div>
      )}

      {/* Bemerkung */}
      <div className="border-t border-slate-100 pt-2">
        <p className="text-[10px] text-slate-500 mb-1">Bemerkung</p>
        <BemerkungFeld
          antragId={antrag.id}
          initial={antrag.bemerkung}
          onSaved={onRefetch}
        />
      </div>

      {/* Nachfassen-Knopf (nur bei status=eingereicht) */}
      {antrag.status === 'eingereicht' && (
        <div className="border-t border-slate-100 pt-2">
          <Button
            size="sm"
            variant="outline"
            className="w-full text-xs h-7 gap-1 text-indigo-700 border-indigo-200 hover:bg-indigo-50"
            disabled={nachfassenLaeuft || updateLoading}
            onClick={handleNachfassen}
          >
            <Send className="w-3 h-3" />
            Nachfassen entwerfen
          </Button>
        </div>
      )}

      {/* Gesuch-Dialog-Knopf (nur wenn paket vorhanden) */}
      {paket && (
        <div className="border-t border-slate-100 pt-2">
          <Button
            size="sm"
            variant="outline"
            className="w-full text-xs h-7 gap-1 text-slate-700 border-slate-200 hover:bg-slate-50"
            onClick={() => setGesuchOffen(true)}
          >
            <BookOpen className="w-3 h-3" />
            Gesuch
          </Button>
          <GesuchDialog
            antrag={antrag}
            offen={gesuchOffen}
            onSchliessen={() => setGesuchOffen(false)}
            onRefetch={onRefetch}
          />
        </div>
      )}

      {/* Gesuch-Prompt fuer Opus (in Schreibphasen, nur wenn kein paket) */}
      {!paket && antrag.medium_id && antrag.stiftung_id &&
        (antrag.status === 'identifiziert' || antrag.status === 'in_arbeit') && (
          <div className="border-t border-slate-100 pt-2">
            <GesuchPromptButton
              medium={antrag.medium_id}
              stiftungId={antrag.stiftung_id}
              stiftungName={antrag.stiftung_name}
            />
          </div>
        )}

      {/* Sonder-Anträge (Kirchen/Förderer/Lotteriefonds/Sponsoren): Gesuch-Prompt
          über sonder_ref — vorher gab es hier keinen Knopf (Dialog war an
          stiftung_id gegated), der Knopf lag nur auf der Sonder-Seite. */}
      {!paket && antrag.medium_id && !antrag.stiftung_id &&
        (antrag.status === 'identifiziert' || antrag.status === 'in_arbeit') &&
        (() => {
          const sonder = parseSonderRef(antrag.sonder_ref)
          if (!sonder) return null
          return (
            <div className="border-t border-slate-100 pt-2">
              <GesuchPromptButton
                medium={antrag.medium_id}
                stiftungId={sonder.id}
                stiftungName={antrag.stiftung_name}
                ziel={sonder.ziel}
              />
            </div>
          )
        })()}

      {/* Ausblenden — nur bei identifiziert/in_arbeit */}
      {(antrag.status === 'identifiziert' || antrag.status === 'in_arbeit') && (
        <div className="border-t border-slate-100 pt-2">
          <Button
            size="sm"
            variant="outline"
            className="w-full text-xs h-7 text-slate-500 border-slate-200 hover:bg-slate-50"
            disabled={ausblendenBeschaeftigt || updateLoading}
            onClick={() => setAusblendenOffen(true)}
          >
            Ausblenden
          </Button>
          <AusblendenDialog
            offen={ausblendenOffen}
            stiftungName={antrag.stiftung_name ?? '—'}
            beschaeftigt={ausblendenBeschaeftigt}
            onAbbrechen={() => setAusblendenOffen(false)}
            onBestaetigen={handleAusblenden}
          />
        </div>
      )}
    </div>
  )
}

// ─── Kanban-Spalte ────────────────────────────────────────────────────────────

function KanbanSpalte({
  spalte,
  antraege,
  medienKanaele,
  onRefetch,
}: {
  spalte: typeof KANBAN_SPALTEN[number]
  antraege: Application[]
  medienKanaele: MediumKanal[]
  onRefetch: () => void
}) {
  return (
    <div className={`rounded-xl border ${spalte.farbe} flex flex-col min-h-[200px]`}>
      <div
        className={`flex items-center justify-between px-3 py-2 rounded-t-xl ${spalte.headerFarbe}`}
      >
        <span className="text-xs font-semibold">{spalte.label}</span>
        <span className="text-xs font-mono font-bold">{antraege.length}</span>
      </div>

      <div className="flex-1 p-2 flex flex-col gap-2 overflow-y-auto">
        {antraege.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-center py-6">
            <p className="text-xs text-slate-400">Noch keine Antraege</p>
          </div>
        ) : (
          antraege.map(antrag => (
            <AntragCard
              key={antrag.id}
              antrag={antrag}
              medienKanaele={medienKanaele}
              onRefetch={onRefetch}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ─── Hauptseite ───────────────────────────────────────────────────────────────

const MEDIUM_LABELS: Record<string, string> = {
  wepublish: 'We.Publish',
  cueltuer: 'Cueltuer',
  neue_wege: 'Neue Wege',
  ganzgraz: 'Ganz Graz',
  'ee-news': 'EE-News',
  bajour: 'Bajour',
}

export default function ApplicationsPage() {
  const { data: rawData, loading, refetch } = useQuery(APPLICATIONS_ALL, {
    fetchPolicy: 'cache-and-network',
  })

  const { data: ausgeblendetData, refetch: refetchAusgeblendet } = useQuery(
    AUSGEBLENDETE_APPLICATIONS,
    { fetchPolicy: 'cache-and-network' },
  )

  const { data: kanaeleData } = useQuery(MEDIEN_KANAELE, {
    fetchPolicy: 'cache-and-network',
  })

  const [filterMedium, setFilterMedium] = useState('alle')
  const [zeigeGeplante, setZeigeGeplante] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allAntraege: Application[] = (rawData as any)?.applications ?? []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const alleAusgeblendet: AusgeblendetEintrag[] = (ausgeblendetData as any)?.applications ?? []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const medienKanaele: MediumKanal[] = (kanaeleData as any)?.faas_medien ?? []

  const gefilterteAusgeblendet: AusgeblendetEintrag[] =
    filterMedium === 'alle'
      ? alleAusgeblendet
      : alleAusgeblendet.filter(e => (e.medium_id ?? '—') === filterMedium)

  function handleRefetch() {
    refetch()
    refetchAusgeblendet()
  }

  const medienMitAnzahl = Array.from(
    allAntraege.reduce((m, a) => {
      const k = a.medium_id ?? '—'
      m.set(k, (m.get(k) ?? 0) + 1)
      return m
    }, new Map<string, number>()),
  ).sort((a, b) => a[0].localeCompare(b[0]))

  const hatStiftungsOrdner = (a: Application) =>
    typeof a.drive_link === 'string' && a.drive_link.trim().length > 0

  const nachMedium =
    filterMedium === 'alle'
      ? allAntraege
      : allAntraege.filter(a => (a.medium_id ?? '—') === filterMedium)

  // Variante A: Standard zeigt nur wirklich erstellte Anträge (Stiftungs-Ordner
  // gesetzt = Gesuch erstellt + im Dossier). Der Schalter blendet die geplanten
  // (noch ohne Ordner) ein, damit du sie bearbeiten und finalisieren kannst.
  const geplanteAnzahl = nachMedium.filter(a => !hatStiftungsOrdner(a)).length
  const gefilterte = zeigeGeplante ? nachMedium : nachMedium.filter(hatStiftungsOrdner)

  const byStatus = Object.fromEntries(
    KANBAN_SPALTEN.map(s => [
      s.status,
      gefilterte.filter(a => a.status === s.status),
    ]),
  )

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Anträge</h1>
          <p className="text-sm text-slate-500 mt-1">
            Standard zeigt nur erstellte Anträge (Stiftungs-Ordner gesetzt). «Geplante anzeigen»
            blendet die noch unbearbeiteten ein, dort schreibst du das Gesuch und setzt den Ordner.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 text-xs shrink-0"
            onClick={() => setZeigeGeplante(v => !v)}
          >
            {zeigeGeplante ? 'Nur erstellte' : `Geplante anzeigen (${geplanteAnzahl})`}
          </Button>
          <div className="w-full sm:w-56">
            <Select value={filterMedium} onValueChange={setFilterMedium}>
              <SelectTrigger>
                <SelectValue placeholder="Medium" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alle">Alle Medien ({allAntraege.length})</SelectItem>
                {medienMitAnzahl.map(([mid, anzahl]) => (
                  <SelectItem key={mid} value={mid}>
                    {MEDIUM_LABELS[mid] ?? mid} ({anzahl})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Vom Medium angefordert: Cowork-Übergabe + Freigabe (Task 11) */}
      {!loading && (
        <VomMediumAngefordert
          antraege={filterMedium === 'alle' ? allAntraege : nachMedium}
          onRefetch={handleRefetch}
        />
      )}

      {/* Gesuch-Warteschlange: wartet auf Entwurf / Review / final */}
      {!loading && (
        <GesuchWarteschlange
          antraege={filterMedium === 'alle' ? allAntraege : nachMedium}
          onRefetch={handleRefetch}
        />
      )}

      {/* Lade-Skeleton */}
      {loading && allAntraege.length === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {KANBAN_SPALTEN.map(s => (
            <div key={s.status} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="h-5 bg-slate-100 rounded animate-pulse mb-3 w-2/3" />
              <div className="space-y-2">
                <div className="h-16 bg-slate-100 rounded animate-pulse" />
                <div className="h-16 bg-slate-100 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Kanban-Board */}
      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {KANBAN_SPALTEN.map(spalte => (
            <KanbanSpalte
              key={spalte.status}
              spalte={spalte}
              antraege={byStatus[spalte.status] ?? []}
              medienKanaele={medienKanaele}
              onRefetch={handleRefetch}
            />
          ))}
        </div>
      )}

      {!loading && allAntraege.length > 0 && (
        <p className="text-xs text-slate-400 text-center mt-4">
          {zeigeGeplante
            ? `${gefilterte.length} Anträge (inkl. geplante)`
            : `${gefilterte.length} erstellte Anträge angezeigt${geplanteAnzahl > 0 ? ` · ${geplanteAnzahl} geplant ausgeblendet` : ''}`}
        </p>
      )}

      <AusgeblendeteListe
        eintraege={gefilterteAusgeblendet}
        onRefetch={handleRefetch}
      />
    </div>
  )
}
