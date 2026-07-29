import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FileDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { GesuchEditor } from '@/components/portal/GesuchEditor'
import { PORTAL_TEXTE } from '@/lib/portal-texte'
import { SchrittInfo } from '@/components/portal/SchrittInfo'
import type { GesuchPortalStatus, GesuchVersion } from '@/lib/portal-status'

/**
 * /portal/gesuche: Status, Editor, Versionen und Meldungen der Gesuche des
 * Mediums (Task 10).
 *
 * Lädt GET /api/portal/gesuche beim Mount. Pro Gesuch eine Karte: Name,
 * Status-Badge, fünfteilige Statusspur (angefordert → in_arbeit → bereit →
 * final → abgeschickt), darunter je nach Status:
 *   - angefordert/in_arbeit: nur der «wir sind dran»-Hinweis, sonst nichts
 *     (die API liefert `text`/`beilagen` erst ab 'bereit', erkennbar an
 *     `g.text !== null`, siehe /api/portal/gesuche).
 *   - bereit/final/abgeschickt/zusage/absage: GesuchEditor (Text bleibt bis
 *     'final' editierbar, danach nur noch Referenz), Beilagen-Downloads,
 *     Word-Export (Task 12, /api/portal/gesuch-export),
 *     «Abgeschickt melden» (solange status bereit/final) bzw. bei bereits
 *     abgeschicktem Gesuch die Angaben + «Antwort melden» (Zusage/Absage).
 *
 * `speichernLaeuft`/`finalLaeuft` sind PRO Gesuch (Record<id, boolean>),
 * damit ein laufender Speichervorgang bei einem Gesuch die Karten der
 * anderen nicht sperrt (mehrere Gesuche können gleichzeitig offen sein).
 *
 * KEIN eigenes <PortalLayout>-Wrapping (siehe src/pages/portal/index.tsx):
 * _app.tsx legt den Rahmen für alle /portal/*-Seiten bereits um.
 */

type PortalGesuch = {
  id: string
  stiftungName: string
  status: GesuchPortalStatus
  angefordertAm: string | null
  freigegebenAm: string | null
  text: string | null
  versionen: GesuchVersion[]
  beilagen: Array<{ fileId: string; name: string }>
  abgeschicktAm: string | null
  betragEingereicht: number | null
}

type LadeStatus = 'laden' | 'bereit' | 'fehler'

// Kurze Status-Wörter, keine Fliesstext-Sätze, darum nicht in PORTAL_TEXTE
// (analog STATUS_LABEL in TrefferKarte.tsx).
const STATUS_LABEL: Record<GesuchPortalStatus, string> = {
  angefordert: 'Angefordert',
  in_arbeit: 'In Arbeit',
  bereit: 'Bereit',
  final: 'Final',
  abgeschickt: 'Abgeschickt',
  zusage: 'Zusage',
  absage: 'Absage',
}

const STATUS_FARBE: Record<GesuchPortalStatus, string> = {
  angefordert: 'border-slate-200 bg-slate-100 text-slate-500',
  in_arbeit: 'border-amber-200 bg-amber-100 text-amber-700',
  bereit: 'border-indigo-200 bg-indigo-100 text-indigo-700',
  final: 'border-indigo-200 bg-indigo-100 text-indigo-700',
  abgeschickt: 'border-sky-200 bg-sky-100 text-sky-700',
  zusage: 'border-emerald-200 bg-emerald-100 text-emerald-800',
  absage: 'border-rose-200 bg-rose-100 text-rose-700',
}

// Statusspur: 5 Stufen. zusage/absage gelten als "abgeschickt und weiter"
// (letzte Stufe erreicht), der Ausgang selbst steht separat im Status-Badge.
const SPUR_STUFEN: Array<{ key: 'angefordert' | 'in_arbeit' | 'bereit' | 'final' | 'abgeschickt'; label: string }> = [
  { key: 'angefordert', label: 'Angefordert' },
  { key: 'in_arbeit', label: 'In Arbeit' },
  { key: 'bereit', label: 'Bereit' },
  { key: 'final', label: 'Final' },
  { key: 'abgeschickt', label: 'Abgeschickt' },
]

function spurIndex(status: GesuchPortalStatus): number {
  if (status === 'zusage' || status === 'absage') return SPUR_STUFEN.length - 1
  const i = SPUR_STUFEN.findIndex((s) => s.key === status)
  return i === -1 ? 0 : i
}

function StatusSpur({ status }: { status: GesuchPortalStatus }) {
  const index = spurIndex(status)
  return (
    <div className="flex items-center">
      {SPUR_STUFEN.map((stufe, i) => (
        <div key={stufe.key} className="flex flex-1 items-center">
          <div className="flex flex-col items-center gap-1">
            <div className={['h-2 w-2 shrink-0 rounded-full', i <= index ? 'bg-indigo-500' : 'bg-slate-200'].join(' ')} />
            <span className={`whitespace-nowrap text-[9px] ${i <= index ? 'text-indigo-700' : 'text-slate-400'}`}>{stufe.label}</span>
          </div>
          {i < SPUR_STUFEN.length - 1 && <div className={`mx-1 h-px flex-1 ${i < index ? 'bg-indigo-300' : 'bg-slate-100'}`} />}
        </div>
      ))}
    </div>
  )
}

function formatDatum(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return iso
  }
}

export default function PortalGesucheSeite() {
  const [gesuche, setGesuche] = useState<PortalGesuch[]>([])
  const [status, setStatus] = useState<LadeStatus>('laden')

  // Pro Gesuch (Record<id, boolean>): ein laufender Vorgang bei einem
  // Gesuch soll die Karten der anderen nicht sperren.
  const [speichernLaeuft, setSpeichernLaeuft] = useState<Record<string, boolean>>({})
  const [finalLaeuft, setFinalLaeuft] = useState<Record<string, boolean>>({})

  const [abgeschicktFuer, setAbgeschicktFuer] = useState<PortalGesuch | null>(null)
  const [abgeschicktDatum, setAbgeschicktDatum] = useState('')
  const [abgeschicktBetrag, setAbgeschicktBetrag] = useState('')
  const [abgeschicktLaeuft, setAbgeschicktLaeuft] = useState(false)

  const [antwortFuer, setAntwortFuer] = useState<PortalGesuch | null>(null)
  const [antwortModus, setAntwortModus] = useState<'zusage' | 'absage'>('zusage')
  const [antwortBetrag, setAntwortBetrag] = useState('')
  const [antwortGrund, setAntwortGrund] = useState('')
  const [antwortLaeuft, setAntwortLaeuft] = useState(false)

  const ladeGesuche = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/gesuche?cb=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`gesuche: Status ${res.status}`)
      const json = (await res.json()) as { gesuche: PortalGesuch[] }
      setGesuche(json.gesuche ?? [])
      setStatus('bereit')
    } catch (err) {
      console.error('Gesuche: /api/portal/gesuche nicht erreichbar', err)
      setStatus('fehler')
    }
  }, [])

  useEffect(() => {
    void ladeGesuche()
  }, [ladeGesuche])

  async function handleSpeichern(gesuchId: string, text: string) {
    setSpeichernLaeuft((prev) => ({ ...prev, [gesuchId]: true }))
    try {
      const res = await fetch('/api/portal/gesuch-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: gesuchId, text }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        return
      }
      toast.success('Gespeichert.')
      void ladeGesuche()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSpeichernLaeuft((prev) => ({ ...prev, [gesuchId]: false }))
    }
  }

  async function handleAlsFinalMarkieren(gesuchId: string) {
    setFinalLaeuft((prev) => ({ ...prev, [gesuchId]: true }))
    try {
      const res = await fetch('/api/portal/gesuch-aktion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: gesuchId, aktion: 'final' }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        return
      }
      toast.success('Als final markiert.')
      void ladeGesuche()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setFinalLaeuft((prev) => ({ ...prev, [gesuchId]: false }))
    }
  }

  function oeffneAbgeschicktDialog(g: PortalGesuch) {
    setAbgeschicktFuer(g)
    setAbgeschicktDatum(new Date().toISOString().slice(0, 10))
    setAbgeschicktBetrag(g.betragEingereicht != null ? String(g.betragEingereicht) : '')
  }

  function schliesseAbgeschicktDialog() {
    setAbgeschicktFuer(null)
    setAbgeschicktDatum('')
    setAbgeschicktBetrag('')
  }

  async function handleAbgeschicktMelden() {
    if (!abgeschicktFuer) return
    setAbgeschicktLaeuft(true)
    try {
      const res = await fetch('/api/portal/gesuch-aktion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: abgeschicktFuer.id,
          aktion: 'abgeschickt',
          datum: abgeschicktDatum || undefined,
          betrag: abgeschicktBetrag || undefined,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        return
      }
      toast.success('Danke für die Rückmeldung.')
      schliesseAbgeschicktDialog()
      void ladeGesuche()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setAbgeschicktLaeuft(false)
    }
  }

  function oeffneAntwortDialog(g: PortalGesuch) {
    setAntwortFuer(g)
    setAntwortModus('zusage')
    setAntwortBetrag('')
    setAntwortGrund('')
  }

  function schliesseAntwortDialog() {
    setAntwortFuer(null)
    setAntwortBetrag('')
    setAntwortGrund('')
  }

  async function handleAntwortMelden() {
    if (!antwortFuer) return
    setAntwortLaeuft(true)
    try {
      const res = await fetch('/api/portal/gesuch-aktion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          antwortModus === 'zusage'
            ? { id: antwortFuer.id, aktion: 'zusage', betrag: antwortBetrag || undefined }
            : { id: antwortFuer.id, aktion: 'absage', grund: antwortGrund },
        ),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        return
      }
      toast.success('Danke für die Rückmeldung.')
      schliesseAntwortDialog()
      void ladeGesuche()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setAntwortLaeuft(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        {/* Kurzes Seiten-Label, kein Fliesstext-Satz: analog STATION_LABEL bewusst nicht in PORTAL_TEXTE. */}
        <h1 className="text-xl font-bold text-slate-900">4. Gesuche</h1>
      </div>

      <SchrittInfo schritt="4" titel={PORTAL_TEXTE['schritt4.titel']}>
        <p>{PORTAL_TEXTE['schritt4.text']}</p>
        <p>{PORTAL_TEXTE['schritt4.wozu']}</p>
      </SchrittInfo>

      {status === 'laden' && <p className="text-sm text-slate-400">Wird geladen …</p>}
      {status === 'fehler' && <p className="text-sm text-slate-500">{PORTAL_TEXTE['fehler.daten_nicht_verfuegbar']}</p>}

      {status === 'bereit' && gesuche.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <p className="text-sm text-slate-500">{PORTAL_TEXTE['gesuche.leer']}</p>
        </div>
      )}

      {status === 'bereit' && gesuche.length > 0 && (
        <div className="space-y-4">
          {gesuche.map((g) => {
            // Die Route liefert text/beilagen NUR ab Status 'bereit' (siehe
            // GESUCH_STATUS_AB_BEREIT, portal-status.ts): text !== null ist
            // darum das clientseitige Signal, ohne die Gating-Menge hier zu
            // duplizieren.
            const istAbBereit = g.text !== null
            const bearbeitbar = g.status === 'bereit' || g.status === 'final'
            return (
              <Card key={g.id} className="space-y-4 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{g.stiftungName}</p>
                  <Badge variant="outline" className={`text-[11px] ${STATUS_FARBE[g.status]}`}>
                    {STATUS_LABEL[g.status]}
                  </Badge>
                </div>

                <StatusSpur status={g.status} />

                {!istAbBereit && <p className="text-sm text-slate-500">{PORTAL_TEXTE['gesuche.in_arbeit']}</p>}

                {istAbBereit && (
                  <div className="space-y-4">
                    <p className="text-sm text-slate-500">{PORTAL_TEXTE['gesuche.bereit']}</p>

                    <GesuchEditor
                      text={g.text ?? ''}
                      versionen={g.versionen}
                      bearbeitbar={bearbeitbar}
                      istFinalMarkiert={g.status !== 'bereit'}
                      onSpeichern={(text) => void handleSpeichern(g.id, text)}
                      onAlsFinalMarkieren={() => void handleAlsFinalMarkieren(g.id)}
                      speichernLaeuft={!!speichernLaeuft[g.id]}
                      finalLaeuft={!!finalLaeuft[g.id]}
                    />

                    {g.beilagen.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-slate-500">Beilagen</p>
                        <ul className="space-y-1">
                          {g.beilagen.map((b) => (
                            <li key={b.fileId}>
                              <a
                                href={`/api/portal/beilage?app=${encodeURIComponent(g.id)}&file=${encodeURIComponent(b.fileId)}`}
                                className="text-xs text-indigo-600 hover:text-indigo-800"
                              >
                                {b.name}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <Button asChild variant="outline" size="sm">
                        <a href={`/api/portal/gesuch-export?id=${encodeURIComponent(g.id)}`}>
                          <FileDown className="h-3.5 w-3.5" />
                          Word-Export
                        </a>
                      </Button>
                    </div>

                    {bearbeitbar && (
                      <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                        <p className="text-sm text-indigo-900">{PORTAL_TEXTE['gesuche.abgeschickt_frage']}</p>
                        <Button size="sm" onClick={() => oeffneAbgeschicktDialog(g)}>
                          {PORTAL_TEXTE['gesuche.abgeschickt_knopf']}
                        </Button>
                      </div>
                    )}

                    {g.status === 'abgeschickt' && (
                      <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-4">
                        <p className="text-sm text-sky-900">
                          Eingereicht am {g.abgeschicktAm ? formatDatum(g.abgeschicktAm) : 'unbekannt'}
                          {g.betragEingereicht != null ? ` · CHF ${g.betragEingereicht.toLocaleString('de-CH')}` : ''}
                        </p>
                        <Button size="sm" onClick={() => oeffneAntwortDialog(g)}>
                          {PORTAL_TEXTE['gesuche.antwort_knopf']}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Abgeschickt-melden-Dialog */}
      <Dialog open={!!abgeschicktFuer} onOpenChange={(open) => !open && schliesseAbgeschicktDialog()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{PORTAL_TEXTE['gesuche.abgeschickt_knopf']}</DialogTitle>
            <DialogDescription>{PORTAL_TEXTE['gesuche.abgeschickt_frage']}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs text-slate-500">Datum</p>
              <Input type="date" value={abgeschicktDatum} onChange={(e) => setAbgeschicktDatum(e.target.value)} />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-slate-500">Betrag (CHF)</p>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="z. B. 20000"
                value={abgeschicktBetrag}
                onChange={(e) => setAbgeschicktBetrag(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={schliesseAbgeschicktDialog} disabled={abgeschicktLaeuft}>
              Abbrechen
            </Button>
            <Button size="sm" disabled={abgeschicktLaeuft} onClick={() => void handleAbgeschicktMelden()}>
              {abgeschicktLaeuft && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {PORTAL_TEXTE['gesuche.abgeschickt_knopf']}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Antwort-melden-Dialog (Zusage/Absage) */}
      <Dialog open={!!antwortFuer} onOpenChange={(open) => !open && schliesseAntwortDialog()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{PORTAL_TEXTE['gesuche.antwort_knopf']}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={antwortModus === 'zusage' ? 'default' : 'outline'}
                onClick={() => setAntwortModus('zusage')}
              >
                Zusage
              </Button>
              <Button
                type="button"
                size="sm"
                variant={antwortModus === 'absage' ? 'default' : 'outline'}
                onClick={() => setAntwortModus('absage')}
              >
                Absage
              </Button>
            </div>
            {antwortModus === 'zusage' ? (
              <div className="space-y-1">
                <p className="text-xs text-slate-500">Zugesagter Betrag (CHF)</p>
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder="z. B. 20000"
                  value={antwortBetrag}
                  onChange={(e) => setAntwortBetrag(e.target.value)}
                />
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-slate-500">Grund</p>
                <Textarea value={antwortGrund} onChange={(e) => setAntwortGrund(e.target.value)} className="min-h-[80px] text-sm" />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={schliesseAntwortDialog} disabled={antwortLaeuft}>
              Abbrechen
            </Button>
            <Button size="sm" disabled={antwortLaeuft} onClick={() => void handleAntwortMelden()}>
              {antwortLaeuft && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {PORTAL_TEXTE['gesuche.antwort_knopf']}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
