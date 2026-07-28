import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MAIL_EINLADUNG, MAIL_NEUER_LINK, fuelleVorlage, type MailVorlage } from '@/lib/portal-texte'

/**
 * /portal-steuerung: Operator-Seite (hinter Cloudflare Access): Zugänge
 * anlegen und verwalten, Login-Links erzeugen, Matching pro Medium
 * freischalten. Datenquelle: fetch auf /api/zugangsverwaltung (GET/POST) und
 * /api/matching-freischalten (POST), analog zum Fetch-Stil der Roadmap-Seite
 * (kein Apollo, die beiden Routen sind kuratierte REST-Endpunkte, kein
 * roher GraphQL-Proxy).
 */

// ─── Typen der API-Antwort ────────────────────────────────────────────────────

type PortalMedium = {
  slug: string
  name: string
  dnaAktiv: boolean
  dnaFreigabe: string | null
  dnaFreigabeVon: string | null
  freigeschaltet: string | null
  freigeschaltetVon: string | null
}

type PortalZugang = {
  id: string
  email: string
  mediumSlug: string
  status: string
  letzterLink: string | null
  letzterLinkTs: string | null
  letzterLogin: string | null
  eingeladenAm: string | null
}

type UebersichtAntwort = { medien: PortalMedium[]; zugaenge: PortalZugang[] }

type LinkErgebnis = { vorlage: MailVorlage; link: string; mediumName: string }

const STATUS_LABEL: Record<string, string> = {
  eingeladen: 'Eingeladen',
  aktiv: 'Aktiv',
  gesperrt: 'Gesperrt',
}

/** Kompaktes Datum + Uhrzeit für Freigabe-/Login-Zeitstempel. Leer bei null. */
function formatZeit(iso: string | null): string {
  if (!iso) return ''
  const datum = new Date(iso)
  if (Number.isNaN(datum.getTime())) return iso
  return datum.toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ─── Hauptseite ──────────────────────────────────────────────────────────────

export default function PortalSteuerungPage() {
  const [daten, setDaten] = useState<UebersichtAntwort | null>(null)
  const [laden, setLaden] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [beschaeftigt, setBeschaeftigt] = useState(false)

  const [linkErgebnis, setLinkErgebnis] = useState<LinkErgebnis | null>(null)
  const [freischaltMedium, setFreischaltMedium] = useState<PortalMedium | null>(null)
  const [resetMedium, setResetMedium] = useState<PortalMedium | null>(null)

  const lade = useCallback(async () => {
    setLaden(true)
    setFehler(null)
    try {
      // Cache-Buster wie auf den Portal-Seiten: Cloudflare hielt gecachte
      // Antworten dieser Route fest (cf-cache-status HIT, 28.07.2026), neue
      // Zugaenge erschienen sonst nicht. no-store-Header allein raeumt einen
      // bereits liegenden Edge-Eintrag nicht weg.
      const res = await fetch(`/api/zugangsverwaltung?cb=${Date.now()}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `Fehler ${res.status}`)
      setDaten(json as UebersichtAntwort)
    } catch (err: unknown) {
      setFehler(err instanceof Error ? err.message : String(err))
    } finally {
      setLaden(false)
    }
  }, [])

  useEffect(() => {
    lade()
  }, [lade])

  async function post(body: Record<string, unknown>): Promise<{ ok: boolean; json: Record<string, unknown> }> {
    setBeschaeftigt(true)
    try {
      const res = await fetch('/api/zugangsverwaltung', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      return { ok: res.ok, json }
    } finally {
      setBeschaeftigt(false)
    }
  }

  async function zugangAnlegen(email: string, mediumSlug: string) {
    const { ok, json } = await post({ aktion: 'anlegen', email, medium_slug: mediumSlug })
    if (!ok) {
      toast.error(String(json?.error ?? 'Anlegen fehlgeschlagen.'))
      return
    }
    const medium = daten?.medien.find((m) => m.slug === mediumSlug)
    setLinkErgebnis({ vorlage: MAIL_EINLADUNG, link: String(json.link ?? ''), mediumName: medium?.name ?? mediumSlug })
    toast.success('Zugang angelegt.')
    await lade()
  }

  async function neuerLink(zugang: PortalZugang) {
    const { ok, json } = await post({ aktion: 'link', id: zugang.id })
    if (!ok) {
      toast.error(String(json?.error ?? 'Link konnte nicht erzeugt werden.'))
      return
    }
    const medium = daten?.medien.find((m) => m.slug === zugang.mediumSlug)
    setLinkErgebnis({ vorlage: MAIL_NEUER_LINK, link: String(json.link ?? ''), mediumName: medium?.name ?? zugang.mediumSlug })
    toast.success('Neuer Link erzeugt.')
    await lade()
  }

  async function sperrenEntsperren(zugang: PortalZugang) {
    const aktion = zugang.status === 'gesperrt' ? 'entsperren' : 'sperren'
    const { ok, json } = await post({ aktion, id: zugang.id })
    if (!ok) {
      toast.error(String(json?.error ?? 'Fehlgeschlagen.'))
      return
    }
    toast.success(aktion === 'sperren' ? 'Zugang gesperrt.' : 'Zugang entsperrt.')
    await lade()
  }

  async function matchingFreischalten(medium: PortalMedium) {
    setBeschaeftigt(true)
    try {
      const res = await fetch('/api/matching-freischalten', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medium_slug: medium.slug }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(String(json?.error ?? 'Freischaltung fehlgeschlagen.'))
        return
      }
      toast.success(`Matching für ${medium.name} freigeschaltet.`)
      setFreischaltMedium(null)
      await lade()
    } finally {
      setBeschaeftigt(false)
    }
  }

  async function mediumZuruecksetzen(medium: PortalMedium) {
    setBeschaeftigt(true)
    try {
      const res = await fetch('/api/medium-zuruecksetzen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medium_slug: medium.slug }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(String(json?.error ?? 'Zurücksetzen fehlgeschlagen.'))
        return
      }
      toast.success(`${medium.name} zurückgesetzt.`)
      setResetMedium(null)
      await lade()
    } finally {
      setBeschaeftigt(false)
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
          <span className="text-slate-300">{'// '}</span>
          Portal-Steuerung
        </p>
        <h1 className="text-2xl font-extrabold text-slate-900 mt-1">Medien-Portal verwalten</h1>
        <p className="text-sm text-slate-500 mt-1">
          Zugänge anlegen, Login-Links erzeugen und das Matching pro Medium freischalten, sobald die DNA freigegeben ist.
        </p>
      </div>

      {fehler && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">{fehler}</div>
      )}

      {laden && !daten && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 rounded-xl border border-slate-200 bg-white animate-pulse" />
          ))}
        </div>
      )}

      {daten && (
        <div className="space-y-6">
          <ZugangAnlegenFormular medien={daten.medien} beschaeftigt={beschaeftigt} onAnlegen={zugangAnlegen} />

          {daten.medien.length === 0 ? (
            <p className="text-sm text-slate-400">Keine aktiven Medien für diesen Mandanten.</p>
          ) : (
            <div className="space-y-4">
              {daten.medien.map((medium) => (
                <MediumKarte
                  key={medium.slug}
                  medium={medium}
                  zugaenge={daten.zugaenge.filter((z) => z.mediumSlug === medium.slug)}
                  beschaeftigt={beschaeftigt}
                  onFreischalten={() => setFreischaltMedium(medium)}
                  onZuruecksetzen={() => setResetMedium(medium)}
                  onNeuerLink={neuerLink}
                  onSperrenEntsperren={sperrenEntsperren}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <LinkErgebnisDialog ergebnis={linkErgebnis} onSchliessen={() => setLinkErgebnis(null)} />

      <Dialog open={!!freischaltMedium} onOpenChange={(open) => { if (!open) setFreischaltMedium(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Matching freischalten</DialogTitle>
            <DialogDescription>
              Schaltet das Matching für <strong>{freischaltMedium?.name}</strong> frei und stösst den Erst-Match an. Das
              Medium sieht danach seine Treffer im Portal.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 gap-2">
            <Button variant="outline" size="sm" disabled={beschaeftigt} onClick={() => setFreischaltMedium(null)}>
              Abbrechen
            </Button>
            <Button
              size="sm"
              disabled={beschaeftigt}
              onClick={() => freischaltMedium && matchingFreischalten(freischaltMedium)}
            >
              Freischalten
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetMedium} onOpenChange={(open) => { if (!open) setResetMedium(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Medium zurücksetzen</DialogTitle>
            <DialogDescription>
              Setzt <strong>{resetMedium?.name}</strong> komplett auf den Anfang zurück. Entfernt werden Logo, hochgeladene
              Unterlagen, die DNA sowie DNA-Freigabe und Matching-Freischaltung. Die Portal-Zugänge bleiben bestehen. Das
              lässt sich nicht rückgängig machen.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 gap-2">
            <Button variant="outline" size="sm" disabled={beschaeftigt} onClick={() => setResetMedium(null)}>
              Abbrechen
            </Button>
            <Button
              size="sm"
              disabled={beschaeftigt}
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => resetMedium && mediumZuruecksetzen(resetMedium)}
            >
              Ja, zurücksetzen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Medium-Karte ─────────────────────────────────────────────────────────────

function MediumKarte({
  medium,
  zugaenge,
  beschaeftigt,
  onFreischalten,
  onZuruecksetzen,
  onNeuerLink,
  onSperrenEntsperren,
}: {
  medium: PortalMedium
  zugaenge: PortalZugang[]
  beschaeftigt: boolean
  onFreischalten: () => void
  onZuruecksetzen: () => void
  onNeuerLink: (zugang: PortalZugang) => void
  onSperrenEntsperren: (zugang: PortalZugang) => void
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="font-semibold text-slate-800">{medium.name}</p>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <Badge
              variant="outline"
              className={medium.dnaAktiv ? 'text-emerald-700 border-emerald-200 bg-emerald-50 text-[10px]' : 'text-slate-500 border-slate-200 text-[10px]'}
            >
              {medium.dnaAktiv ? 'DNA aktiv' : 'Keine aktive DNA'}
            </Badge>
            {medium.dnaFreigabe ? (
              <Badge variant="outline" className="text-indigo-700 border-indigo-200 bg-indigo-50 text-[10px]">
                Vom Medium freigegeben {formatZeit(medium.dnaFreigabe)}
                {medium.dnaFreigabeVon ? ` · ${medium.dnaFreigabeVon}` : ''}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-slate-500 border-slate-200 text-[10px]">
                DNA noch nicht freigegeben
              </Badge>
            )}
          </div>
        </div>

        <div className="text-right">
          {medium.freigeschaltet ? (
            <Badge variant="outline" className="text-emerald-700 border-emerald-200 bg-emerald-50 text-[10px]">
              Matching frei seit {formatZeit(medium.freigeschaltet)}
              {medium.freigeschaltetVon ? ` · ${medium.freigeschaltetVon}` : ''}
            </Badge>
          ) : (
            <Button size="sm" disabled={!medium.dnaFreigabe || beschaeftigt} onClick={onFreischalten}>
              Matching freischalten
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Zugänge ({zugaenge.length})</p>
          <Button
            size="sm"
            variant="outline"
            disabled={beschaeftigt}
            className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
            onClick={onZuruecksetzen}
          >
            Zurücksetzen
          </Button>
        </div>
        {zugaenge.length === 0 ? (
          <p className="text-sm text-slate-400">Noch kein Zugang angelegt.</p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
            {zugaenge.map((zugang) => (
              <ZugangZeile
                key={zugang.id}
                zugang={zugang}
                beschaeftigt={beschaeftigt}
                onNeuerLink={() => onNeuerLink(zugang)}
                onSperrenEntsperren={() => onSperrenEntsperren(zugang)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Zugangs-Zeile ────────────────────────────────────────────────────────────

function ZugangZeile({
  zugang,
  beschaeftigt,
  onNeuerLink,
  onSperrenEntsperren,
}: {
  zugang: PortalZugang
  beschaeftigt: boolean
  onNeuerLink: () => void
  onSperrenEntsperren: () => void
}) {
  const gesperrt = zugang.status === 'gesperrt'
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="font-medium text-slate-700 truncate">{zugang.email}</p>
        <p className="text-xs text-slate-400">
          {STATUS_LABEL[zugang.status] ?? zugang.status}
          {zugang.letzterLogin ? ` · zuletzt angemeldet ${formatZeit(zugang.letzterLogin)}` : ' · noch nie angemeldet'}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" variant="outline" disabled={beschaeftigt} onClick={onNeuerLink}>
          Neuer Link
        </Button>
        <Button size="sm" variant="outline" disabled={beschaeftigt} onClick={onSperrenEntsperren}>
          {gesperrt ? 'Entsperren' : 'Sperren'}
        </Button>
      </div>
    </div>
  )
}

// ─── Formular «Zugang anlegen» ────────────────────────────────────────────────

function ZugangAnlegenFormular({
  medien,
  beschaeftigt,
  onAnlegen,
}: {
  medien: PortalMedium[]
  beschaeftigt: boolean
  onAnlegen: (email: string, mediumSlug: string) => void
}) {
  const [email, setEmail] = useState('')
  const [mediumSlug, setMediumSlug] = useState('')

  useEffect(() => {
    if (!mediumSlug && medien[0]) setMediumSlug(medien[0].slug)
  }, [medien, mediumSlug])

  function absenden() {
    const emailGetrimmt = email.trim()
    if (!emailGetrimmt || !mediumSlug) return
    onAnlegen(emailGetrimmt, mediumSlug)
    setEmail('')
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
      <p className="font-semibold text-slate-800 mb-3">Zugang anlegen</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <Input
            type="email"
            placeholder="name@medium.ch"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="w-56">
          <Select value={mediumSlug} onValueChange={setMediumSlug}>
            <SelectTrigger>
              <SelectValue placeholder="Medium" />
            </SelectTrigger>
            <SelectContent>
              {medien.map((m) => (
                <SelectItem key={m.slug} value={m.slug}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button disabled={beschaeftigt || !email.trim() || !mediumSlug} onClick={absenden}>
          Zugang anlegen
        </Button>
      </div>
    </div>
  )
}

// ─── Link-Ergebnis-Dialog ─────────────────────────────────────────────────────

function LinkErgebnisDialog({
  ergebnis,
  onSchliessen,
}: {
  ergebnis: LinkErgebnis | null
  onSchliessen: () => void
}) {
  function kopiereLink() {
    if (!ergebnis) return
    navigator.clipboard?.writeText(ergebnis.link)
    toast.success('Link kopiert.')
  }

  function kopiereMailVorlage() {
    if (!ergebnis) return
    const gefuellt = fuelleVorlage(ergebnis.vorlage, { medium: ergebnis.mediumName, link: ergebnis.link })
    navigator.clipboard?.writeText(`Betreff: ${gefuellt.betreff}\n\n${gefuellt.text}`)
    toast.success('Mail-Vorlage kopiert. {name} noch von Hand ersetzen.')
  }

  return (
    <Dialog open={!!ergebnis} onOpenChange={(open) => { if (!open) onSchliessen() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Zugangslink erzeugt</DialogTitle>
          <DialogDescription>
            Für {ergebnis?.mediumName}. Der Link ist einmal gültig, 24 Stunden lang.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={ergebnis?.link ?? ''}
            className="text-xs font-mono"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button size="sm" variant="outline" onClick={kopiereLink}>
            Kopieren
          </Button>
        </div>

        <DialogFooter className="mt-2 gap-2">
          <Button size="sm" variant="outline" onClick={kopiereMailVorlage}>
            Mail-Vorlage kopieren
          </Button>
          <Button size="sm" onClick={onSchliessen}>
            Schliessen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
