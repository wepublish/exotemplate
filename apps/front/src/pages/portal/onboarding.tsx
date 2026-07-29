import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { UploadCloud, Link as LinkIcon, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MediumLogo } from '@/components/MediumLogo'
import { SchrittInfo } from '@/components/portal/SchrittInfo'
import { UnterlagenListe } from '@/components/portal/UnterlagenListe'
import { PORTAL_TEXTE } from '@/lib/portal-texte'
import {
  FOERDERHISTORIE_TYPEN,
  foerderhistorieTypLabel,
  formatBetragChf,
  type FoerderhistorieTyp,
  type FoerderhistorieZeile,
} from '@/lib/foerderhistorie'

/**
 * /portal/onboarding (Unterlagen): Selbstservice-Seite, auf der ein Medium
 * seine Unterlagen selbst einspielt: Logo hochladen (Pflicht-Erststep),
 * Dokument hochladen, URL hinzufügen, Fragebogen ausfüllen, und seinen
 * Wissens-Stand sieht.
 *
 * Alle Schreib-Wege laufen über eigene Portal-Routen (/api/portal/logo,
 * /api/portal/upload, /api/portal/scrape, /api/portal/wissen POST), die das
 * Medium ausschliesslich aus der Session nehmen, nie aus einem Formularfeld.
 * Der Lese-Weg (/api/portal/wissen GET) liefert Liste, Zähler und
 * Vollständigkeits-Score in einem Aufruf; der Logo-Stand kommt eigenständig
 * aus /api/portal/me (hatLogo + medium), damit «weiter zur DNA» sofort nach
 * einem erfolgreichen Upload freigeschaltet erscheint, ohne auf einen vollen
 * Seiten-Reload zu warten (dieselbe Unabhängigkeit von der PortalLayout-
 * Context wie beim bestehenden hatUnterlagen-Stand).
 *
 * KEIN eigenes <PortalLayout>-Wrapping (siehe src/pages/portal/index.tsx):
 * _app.tsx legt den Rahmen für alle /portal/*-Seiten bereits um.
 */

// ─── Typen ────────────────────────────────────────────────────────────────────

type WissensQuelle = 'We.Publish' | 'von euch'

interface WissensEintrag {
  id: number
  title: string
  category: string
  quelle: WissensQuelle
  datum: string
}

interface WissensZaehler {
  published_article: number
  newsletter: number
  previous_application: number
  general_info: number
}

interface FragebogenFelderAnsicht {
  selbstbeschrieb: string
  fokus: string
  nogos: string
}

interface WissenAntwort {
  eintraege: WissensEintrag[]
  zaehler: WissensZaehler
  score: number
  fragebogen: { felder: FragebogenFelderAnsicht; gespeichertAm: string } | null
}

type LadeStatus = 'laden' | 'bereit' | 'fehler'

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function formatDatum(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return iso
  }
}

// ─── Logo-Block (Pflicht-Erststep, ganz oben auf der Seite) ───────────────────

interface LogoBlockProps {
  hatLogo: boolean
  slug: string | null
  name: string
  onErfolg: () => void
}

function LogoBlock({ hatLogo, slug, name, onErfolg }: LogoBlockProps) {
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function uploadLogo(datei: File) {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', datei)
      const res = await fetch('/api/portal/logo', { method: 'POST', body: form })
      const json = (await res.json()) as { logoUrl?: string; error?: string }
      if (!res.ok || json.error) {
        toast.error(json.error ?? `Hochladen fehlgeschlagen (${res.status})`)
        return
      }
      toast.success('Logo gespeichert.')
      onErfolg()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function handleDateiWahl(e: React.ChangeEvent<HTMLInputElement>) {
    const datei = e.target.files?.[0]
    if (datei) void uploadLogo(datei)
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
      <h2 className="text-sm font-semibold text-slate-900">{PORTAL_TEXTE['logo.titel']}</h2>
      <p className="text-sm text-slate-500">{PORTAL_TEXTE['logo.hinweis']}</p>

      <div className="flex items-center gap-4">
        {hatLogo && slug ? (
          <MediumLogo slug={slug} name={name} size={64} />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-slate-200 px-1 text-center text-[10px] leading-tight text-slate-400">
            {PORTAL_TEXTE['logo.kein_logo']}
          </div>
        )}

        <Button onClick={() => fileRef.current?.click()} disabled={uploading} variant={hatLogo ? 'outline' : 'default'} size="sm">
          {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          {PORTAL_TEXTE['logo.hochladen_knopf']}
        </Button>
      </div>

      <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleDateiWahl} />
    </div>
  )
}

// ─── Upload-Block ─────────────────────────────────────────────────────────────

function UploadBlock({ onErfolg }: { onErfolg: () => void }) {
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [fortschritt, setFortschritt] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Mehrere Dateien in einem Vorgang (Wunsch 29.07.2026): die Route nimmt
  // eine Datei pro Request, der Client lädt sequenziell hoch — ein Fehler
  // bei Datei 3 lässt Datei 1 und 2 gespeichert und wird einzeln gemeldet.
  async function uploadDateien(dateien: File[]) {
    if (dateien.length === 0) return
    setUploading(true)
    let gespeichert = 0
    try {
      for (const [index, datei] of dateien.entries()) {
        setFortschritt(dateien.length > 1 ? `${index + 1}/${dateien.length}` : '')
        try {
          const form = new FormData()
          form.append('file', datei)
          const res = await fetch('/api/portal/upload', { method: 'POST', body: form })
          const json = (await res.json()) as { title?: string; chars?: number; error?: string }
          if (!res.ok || json.error) {
            toast.error(`${datei.name}: ${json.error ?? `Hochladen fehlgeschlagen (${res.status})`}`)
            continue
          }
          gespeichert++
        } catch (err) {
          toast.error(`${datei.name}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (gespeichert === 1 && dateien.length === 1) {
        toast.success(`«${dateien[0].name}» gespeichert.`)
      } else if (gespeichert > 0) {
        toast.success(`${gespeichert} von ${dateien.length} Dateien gespeichert.`)
      }
      if (gespeichert > 0) onErfolg()
    } finally {
      setUploading(false)
      setFortschritt('')
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    void uploadDateien(Array.from(e.dataTransfer.files))
  }

  function handleDateiWahl(e: React.ChangeEvent<HTMLInputElement>) {
    void uploadDateien(Array.from(e.target.files ?? []))
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
      <h2 className="text-sm font-semibold text-slate-900">{PORTAL_TEXTE['unterlagen.upload_titel']}</h2>
      <p className="text-sm text-slate-500">{PORTAL_TEXTE['unterlagen.upload_hinweis']}</p>

      <div
        className={[
          'rounded-lg border-2 border-dashed p-6 text-center transition-colors cursor-pointer',
          dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white',
          uploading ? 'pointer-events-none opacity-60' : '',
        ].join(' ')}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-2 text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            <span className="text-xs">Wird hochgeladen {fortschritt ? `(${fortschritt}) ` : ''}…</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <UploadCloud className="h-7 w-7" />
            <span className="text-xs font-medium">Dateien hier ablegen oder klicken</span>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".docx,.xlsx,.xls,.pdf,.txt,.csv,.md"
        className="hidden"
        onChange={handleDateiWahl}
      />
    </div>
  )
}

// ─── URL-Block ────────────────────────────────────────────────────────────────

function UrlBlock({ onErfolg }: { onErfolg: () => void }) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleHinzufuegen() {
    const wert = url.trim()
    if (!wert) {
      toast.error('Bitte eine URL eingeben.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/portal/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: wert }),
      })
      const json = (await res.json()) as { title?: string; error?: string }
      if (!res.ok || json.error) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        return
      }
      toast.success(`«${json.title}» gespeichert.`)
      setUrl('')
      onErfolg()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <LinkIcon className="h-4 w-4" />
        {PORTAL_TEXTE['unterlagen.url_titel']}
      </h2>
      <p className="text-sm text-slate-500">{PORTAL_TEXTE['unterlagen.url_hinweis']}</p>

      <div className="flex gap-2">
        <Input
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleHinzufuegen()
          }}
          className="flex-1"
        />
        <Button onClick={() => void handleHinzufuegen()} disabled={loading || !url.trim()} className="shrink-0">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Hinzufügen'}
        </Button>
      </div>
    </div>
  )
}

// ─── Fragebogen-Block ─────────────────────────────────────────────────────────

/**
 * Die drei Fragen. Gespeicherte Antworten kommen als `gespeichert` herein
 * (aus /api/portal/wissen GET) und befüllen die Felder vor — das Medium sieht
 * damit, dass die Antworten wirklich liegen, und kann sie später bearbeiten
 * (Wunsch 29.07.2026). Ein Absenden überschreibt den bestehenden Eintrag.
 */
function FragebogenBlock({
  gespeichert,
  onErfolg,
}: {
  gespeichert: { felder: FragebogenFelderAnsicht; gespeichertAm: string } | null
  onErfolg: () => void
}) {
  const [selbstbeschrieb, setSelbstbeschrieb] = useState('')
  const [fokus, setFokus] = useState('')
  const [nogos, setNogos] = useState('')
  const [speichert, setSpeichert] = useState(false)
  const [geaendert, setGeaendert] = useState(false)

  // Vorbefüllen, sobald die gespeicherten Antworten geladen sind — aber nie
  // über eine begonnene Bearbeitung hinweg (sonst überschreibt ein Reload der
  // Liste, etwa nach einem Upload, gerade getippten Text).
  useEffect(() => {
    if (geaendert) return
    setSelbstbeschrieb(gespeichert?.felder.selbstbeschrieb ?? '')
    setFokus(gespeichert?.felder.fokus ?? '')
    setNogos(gespeichert?.felder.nogos ?? '')
  }, [gespeichert, geaendert])

  function aendere(setter: (wert: string) => void) {
    return (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setGeaendert(true)
      setter(e.target.value)
    }
  }

  async function handleAbsenden() {
    if (!selbstbeschrieb.trim() && !fokus.trim() && !nogos.trim()) {
      toast.error('Bitte füllt mindestens ein Feld aus.')
      return
    }
    setSpeichert(true)
    try {
      const res = await fetch('/api/portal/wissen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fragebogen: { selbstbeschrieb, fokus, nogos } }),
      })
      const json = (await res.json()) as { id?: number; error?: string; aktualisiert?: boolean }
      if (!res.ok || json.error) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        return
      }
      toast.success(
        json.aktualisiert
          ? PORTAL_TEXTE['unterlagen.fragebogen_aktualisiert']
          : PORTAL_TEXTE['unterlagen.fragebogen_gespeichert'],
      )
      // Felder NICHT leeren: die Antworten bleiben stehen, damit sichtbar ist,
      // was gespeichert wurde, und ein zweiter Durchgang daran anschliesst.
      setGeaendert(false)
      onErfolg()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSpeichert(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{PORTAL_TEXTE['unterlagen.fragebogen_titel']}</h2>
        {gespeichert && !geaendert && (
          <span className="text-xs text-emerald-700">
            {PORTAL_TEXTE['unterlagen.fragebogen_stand']} {formatDatum(gespeichert.gespeichertAm)}
          </span>
        )}
        {geaendert && <span className="text-xs text-amber-700">{PORTAL_TEXTE['unterlagen.fragebogen_ungespeichert']}</span>}
      </div>
      <p className="text-sm text-slate-500">{PORTAL_TEXTE['unterlagen.fragebogen_intro']}</p>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            {PORTAL_TEXTE['unterlagen.fragebogen_selbstbeschrieb_label']}
          </label>
          <Textarea value={selbstbeschrieb} onChange={aendere(setSelbstbeschrieb)} className="min-h-[90px]" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            {PORTAL_TEXTE['unterlagen.fragebogen_fokus_label']}
          </label>
          <Textarea value={fokus} onChange={aendere(setFokus)} className="min-h-[90px]" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            {PORTAL_TEXTE['unterlagen.fragebogen_nogos_label']}
          </label>
          <Textarea value={nogos} onChange={aendere(setNogos)} className="min-h-[90px]" />
        </div>
      </div>

      <Button onClick={() => void handleAbsenden()} disabled={speichert}>
        {speichert ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
        {gespeichert ? PORTAL_TEXTE['unterlagen.fragebogen_knopf_aendern'] : PORTAL_TEXTE['unterlagen.fragebogen_knopf']}
      </Button>
    </div>
  )
}

// ─── Förderhistorie-Block (bisherige Förderungen + Ausschlüsse) ───────────────

interface StiftungsVorschlag {
  id: string
  name: string
  sitz: string | null
}

/**
 * Erfassung der Förderhistorie und der Ausschlüsse (Design 2026-07-29):
 * Typeahead gegen /api/portal/stiftung-suche (verknüpft die Stiftung, wenn
 * gefunden — nur dann können Treffer-Filter und Engine wirken), Freitext-Name
 * als Fallback. `onWissenGeaendert` lädt die Unterlagen-Liste neu, weil
 * erhalten/abgelehnt-Einträge serverseitig einen Wissens-Eintrag miterzeugen.
 */
function FoerderhistorieBlock({ onWissenGeaendert }: { onWissenGeaendert: () => void }) {
  const [eintraege, setEintraege] = useState<FoerderhistorieZeile[] | null>(null)
  const [typ, setTyp] = useState<FoerderhistorieTyp>('erhalten')
  const [stiftungName, setStiftungName] = useState('')
  const [stiftungId, setStiftungId] = useState<string | null>(null)
  const [vorschlaege, setVorschlaege] = useState<StiftungsVorschlag[]>([])
  const [jahr, setJahr] = useState('')
  const [betrag, setBetrag] = useState('')
  const [zweck, setZweck] = useState('')
  const [ausschluss, setAusschluss] = useState(false)
  const [grund, setGrund] = useState('')
  const [speichert, setSpeichert] = useState(false)
  const [entferntId, setEntferntId] = useState<number | null>(null)
  const sucheTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const laden = useCallback(() => {
    fetch(`/api/portal/foerderhistorie?cb=${Date.now()}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`foerderhistorie: Status ${res.status}`)
        const daten = (await res.json()) as { eintraege: FoerderhistorieZeile[] }
        setEintraege(daten.eintraege)
      })
      .catch((err: unknown) => {
        console.error('Unterlagen: /api/portal/foerderhistorie nicht erreichbar', err)
        setEintraege([])
      })
  }, [])

  useEffect(() => {
    laden()
  }, [laden])

  // Typeahead: erst ab 2 Zeichen, entprellt; eine gewählte Stiftung (stiftungId
  // gesetzt) unterdrückt die Suche, bis der Name wieder verändert wird.
  function handleNameEingabe(wert: string) {
    setStiftungName(wert)
    setStiftungId(null)
    if (sucheTimer.current) clearTimeout(sucheTimer.current)
    const begriff = wert.trim()
    if (begriff.length < 2) {
      setVorschlaege([])
      return
    }
    sucheTimer.current = setTimeout(() => {
      fetch(`/api/portal/stiftung-suche?q=${encodeURIComponent(begriff)}&cb=${Date.now()}`, { cache: 'no-store' })
        .then(async (res) => {
          if (!res.ok) return
          const daten = (await res.json()) as { treffer: StiftungsVorschlag[] }
          setVorschlaege(daten.treffer)
        })
        .catch(() => setVorschlaege([]))
    }, 250)
  }

  function waehleVorschlag(v: StiftungsVorschlag) {
    setStiftungName(v.name)
    setStiftungId(v.id)
    setVorschlaege([])
  }

  function formularLeeren() {
    setStiftungName('')
    setStiftungId(null)
    setVorschlaege([])
    setJahr('')
    setBetrag('')
    setZweck('')
    setAusschluss(false)
    setGrund('')
  }

  async function handleSpeichern() {
    if (stiftungName.trim().length < 2) {
      toast.error('Bitte den Namen der Stiftung angeben.')
      return
    }
    setSpeichert(true)
    try {
      const res = await fetch('/api/portal/foerderhistorie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          typ,
          stiftung_id: stiftungId,
          stiftung_name: stiftungName,
          jahr: jahr.trim() || null,
          betrag: betrag.trim() || null,
          zweck: zweck.trim() || null,
          ausgeschlossen: typ === 'ausgeschlossen' ? true : ausschluss,
          ausschluss_grund: grund.trim() || null,
        }),
      })
      const json = (await res.json()) as { id?: number; error?: string }
      if (!res.ok || json.error) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        return
      }
      toast.success(PORTAL_TEXTE['foerderhistorie.gespeichert'])
      formularLeeren()
      laden()
      onWissenGeaendert()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSpeichert(false)
    }
  }

  async function handleEntfernen(id: number) {
    setEntferntId(id)
    try {
      const res = await fetch(`/api/portal/foerderhistorie?id=${id}`, { method: 'DELETE' })
      const json = (await res.json()) as { status?: string; error?: string }
      if (!res.ok || json.error) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        return
      }
      toast.success(PORTAL_TEXTE['foerderhistorie.entfernt'])
      laden()
      onWissenGeaendert()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setEntferntId(null)
    }
  }

  const mitFoerderFeldern = typ !== 'ausgeschlossen'

  function eintragBeschreibung(e: FoerderhistorieZeile): string {
    const teile = [foerderhistorieTypLabel(e.typ)]
    if (e.jahr) teile.push(String(e.jahr))
    if (e.betrag !== null) teile.push(formatBetragChf(e.betrag))
    if (e.typ !== 'ausgeschlossen' && e.ausgeschlossen) teile.push('kommt nicht mehr in Frage')
    return teile.join(' · ')
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{PORTAL_TEXTE['foerderhistorie.titel']}</h2>
        <p className="mt-1 text-sm text-slate-500">{PORTAL_TEXTE['foerderhistorie.intro']}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FOERDERHISTORIE_TYPEN.map((t) => (
          <Button
            key={t.key}
            type="button"
            size="sm"
            variant={typ === t.key ? 'default' : 'outline'}
            onClick={() => setTyp(t.key)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      <div className="space-y-3">
        <div className="relative">
          <label className="mb-1 block text-xs font-medium text-slate-600">
            {PORTAL_TEXTE['foerderhistorie.stiftung_label']}
          </label>
          <Input
            value={stiftungName}
            onChange={(e) => handleNameEingabe(e.target.value)}
            placeholder="Name der Stiftung"
          />
          <p className="mt-1 text-[11px] text-slate-400">{PORTAL_TEXTE['foerderhistorie.stiftung_hinweis']}</p>
          {vorschlaege.length > 0 && stiftungId === null && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-md">
              {vorschlaege.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-indigo-50"
                    onClick={() => waehleVorschlag(v)}
                  >
                    <span className="min-w-0 truncate font-medium text-slate-800">{v.name}</span>
                    {v.sitz && <span className="shrink-0 text-xs text-slate-400">{v.sitz}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {mitFoerderFeldern && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                {PORTAL_TEXTE['foerderhistorie.jahr_label']}
              </label>
              <Input value={jahr} onChange={(e) => setJahr(e.target.value)} inputMode="numeric" placeholder="z.B. 2024" />
            </div>
            {typ === 'erhalten' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  {PORTAL_TEXTE['foerderhistorie.betrag_label']}
                </label>
                <Input value={betrag} onChange={(e) => setBetrag(e.target.value)} inputMode="numeric" placeholder="z.B. 20000" />
              </div>
            )}
          </div>
        )}

        {mitFoerderFeldern && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              {PORTAL_TEXTE['foerderhistorie.zweck_label']}
            </label>
            <Input value={zweck} onChange={(e) => setZweck(e.target.value)} placeholder="z.B. Recherchefonds Lokaljournalismus" />
          </div>
        )}

        {mitFoerderFeldern && (
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={ausschluss}
              onChange={(e) => setAusschluss(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            {PORTAL_TEXTE['foerderhistorie.ausschluss_haken']}
          </label>
        )}

        {(ausschluss || typ === 'ausgeschlossen') && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              {PORTAL_TEXTE['foerderhistorie.ausschluss_grund_label']}
            </label>
            <Textarea value={grund} onChange={(e) => setGrund(e.target.value)} className="min-h-[60px]" />
          </div>
        )}
      </div>

      <Button onClick={() => void handleSpeichern()} disabled={speichert || stiftungName.trim().length < 2}>
        {speichert ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
        {PORTAL_TEXTE['foerderhistorie.hinzufuegen_knopf']}
      </Button>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {PORTAL_TEXTE['foerderhistorie.liste_titel']}
        </h3>
        {eintraege === null && <p className="text-sm text-slate-400">Wird geladen …</p>}
        {eintraege !== null && eintraege.length === 0 && (
          <p className="text-sm text-slate-400">{PORTAL_TEXTE['foerderhistorie.liste_leer']}</p>
        )}
        {eintraege !== null && eintraege.length > 0 && (
          <ul className="space-y-2">
            {eintraege.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{e.stiftungName}</p>
                  <p className="text-xs text-slate-400">{eintragBeschreibung(e)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-slate-400 hover:text-red-600"
                  onClick={() => void handleEntfernen(e.id)}
                  disabled={entferntId === e.id}
                  title={PORTAL_TEXTE['foerderhistorie.entfernen_knopf']}
                >
                  {entferntId === e.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ─── Hauptseite ───────────────────────────────────────────────────────────────

interface LogoStatus {
  hatLogo: boolean
  slug: string
  name: string
}

export default function PortalUnterlagenSeite() {
  const [wissen, setWissen] = useState<WissenAntwort | null>(null)
  const [status, setStatus] = useState<LadeStatus>('laden')
  const [logoStatus, setLogoStatus] = useState<LogoStatus | null>(null)

  const laden = useCallback(() => {
    fetch(`/api/portal/wissen?cb=${Date.now()}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`wissen: Status ${res.status}`)
        const daten = (await res.json()) as WissenAntwort
        setWissen(daten)
        setStatus('bereit')
      })
      .catch((err: unknown) => {
        console.error('Unterlagen: /api/portal/wissen nicht erreichbar', err)
        setStatus('fehler')
      })
  }, [])

  // Eigenständiger Lesepfad für den Logo-Stand (statt der PortalLayout-
  // Context): so zeigt «weiter zur DNA» sofort den freigeschalteten Zustand,
  // sobald der Upload unten erfolgreich war, ohne auf einen Reload zu warten.
  const ladeLogoStatus = useCallback(() => {
    fetch(`/api/portal/me?cb=${Date.now()}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`me: Status ${res.status}`)
        const daten = (await res.json()) as { medium: { slug: string; name: string }; hatLogo: boolean }
        setLogoStatus({ hatLogo: daten.hatLogo, slug: daten.medium.slug, name: daten.medium.name })
      })
      .catch((err: unknown) => {
        console.error('Unterlagen: /api/portal/me nicht erreichbar', err)
      })
  }, [])

  useEffect(() => {
    laden()
    ladeLogoStatus()
  }, [laden, ladeLogoStatus])

  const eintraege = wissen?.eintraege ?? []
  const hatEintraege = eintraege.length > 0
  const hatLogo = logoStatus?.hatLogo ?? false
  const kannWeiter = hatEintraege && hatLogo

  return (
    <div className="space-y-6">
      <div>
        {/* Kurzes Seiten-Label, kein Fliesstext-Satz: analog STATION_LABEL bewusst nicht in PORTAL_TEXTE. */}
        <h1 className="text-xl font-bold text-slate-900">1. Unterlagen</h1>
      </div>

      <SchrittInfo schritt="1" titel={PORTAL_TEXTE['schritt1.titel']}>
        <p>{PORTAL_TEXTE['schritt1.text']}</p>
        <p>{PORTAL_TEXTE['schritt1.wozu']}</p>
      </SchrittInfo>

      {/* Was schon da ist, steht OBEN (Wunsch Ramona 29.07.2026): vorher war
          unklar, wohin Uploads und URLs verschwinden. Mit Vollständigkeits-
          Balken, damit sichtbar ist, was noch fehlt. */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">{PORTAL_TEXTE['unterlagen.liste_titel']}</h2>
          {wissen && <span className="text-sm font-medium text-indigo-600">{wissen.score} %</span>}
        </div>

        {wissen && (
          <div className="h-2 w-full rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full bg-indigo-500 transition-all duration-500"
              style={{ width: `${wissen.score}%` }}
            />
          </div>
        )}

        {status === 'laden' && <p className="text-sm text-slate-400">Wird geladen …</p>}
        {status !== 'laden' && (
          <UnterlagenListe
            eintraege={eintraege.map((e) => ({ ...e, datum: formatDatum(e.datum) }))}
            onGeaendert={laden}
          />
        )}
      </div>

      {status === 'fehler' && <p className="text-sm text-slate-500">{PORTAL_TEXTE['fehler.daten_nicht_verfuegbar']}</p>}

      <LogoBlock hatLogo={hatLogo} slug={logoStatus?.slug ?? null} name={logoStatus?.name ?? ''} onErfolg={ladeLogoStatus} />

      <div className="grid gap-4 sm:grid-cols-2">
        <UploadBlock onErfolg={laden} />
        <UrlBlock onErfolg={laden} />
      </div>

      <FragebogenBlock gespeichert={wissen?.fragebogen ?? null} onErfolg={laden} />

      <FoerderhistorieBlock onWissenGeaendert={laden} />

      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 space-y-3">
        <p className="text-sm text-indigo-900">{PORTAL_TEXTE['unterlagen.dna_knopf_hinweis']}</p>
        {kannWeiter ? (
          <Link href="/portal/dna">
            <Button className="w-full sm:w-auto">{PORTAL_TEXTE['unterlagen.dna_knopf']}</Button>
          </Link>
        ) : (
          <Button
            disabled
            title={!hatLogo ? PORTAL_TEXTE['unterlagen.dna_knopf_gesperrt_logo'] : PORTAL_TEXTE['unterlagen.dna_knopf_gesperrt']}
            className="w-full sm:w-auto"
          >
            {PORTAL_TEXTE['unterlagen.dna_knopf']}
          </Button>
        )}
      </div>
    </div>
  )
}
