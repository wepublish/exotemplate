import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { UploadCloud, Link as LinkIcon, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MediumLogo } from '@/components/MediumLogo'
import { PORTAL_TEXTE } from '@/lib/portal-texte'
import { kategorieLabelFromKey } from '@/lib/knowledge-score'

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

interface WissenAntwort {
  eintraege: WissensEintrag[]
  zaehler: WissensZaehler
  score: number
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
  const fileRef = useRef<HTMLInputElement>(null)

  async function uploadDatei(datei: File) {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', datei)
      const res = await fetch('/api/portal/upload', { method: 'POST', body: form })
      const json = (await res.json()) as { title?: string; chars?: number; error?: string }
      if (!res.ok || json.error) {
        toast.error(json.error ?? `Hochladen fehlgeschlagen (${res.status})`)
        return
      }
      toast.success(`«${json.title}» gespeichert.`)
      onErfolg()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const datei = e.dataTransfer.files[0]
    if (datei) void uploadDatei(datei)
  }

  function handleDateiWahl(e: React.ChangeEvent<HTMLInputElement>) {
    const datei = e.target.files?.[0]
    if (datei) void uploadDatei(datei)
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
            <span className="text-xs">Wird hochgeladen …</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <UploadCloud className="h-7 w-7" />
            <span className="text-xs font-medium">Datei hier ablegen oder klicken</span>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
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

function FragebogenBlock({ onErfolg }: { onErfolg: () => void }) {
  const [selbstbeschrieb, setSelbstbeschrieb] = useState('')
  const [fokus, setFokus] = useState('')
  const [nogos, setNogos] = useState('')
  const [speichert, setSpeichert] = useState(false)

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
      const json = (await res.json()) as { id?: number; error?: string }
      if (!res.ok || json.error) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        return
      }
      toast.success('Danke, eure Antworten sind gespeichert.')
      setSelbstbeschrieb('')
      setFokus('')
      setNogos('')
      onErfolg()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSpeichert(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
      <h2 className="text-sm font-semibold text-slate-900">{PORTAL_TEXTE['unterlagen.fragebogen_titel']}</h2>
      <p className="text-sm text-slate-500">{PORTAL_TEXTE['unterlagen.fragebogen_intro']}</p>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            {PORTAL_TEXTE['unterlagen.fragebogen_selbstbeschrieb_label']}
          </label>
          <Textarea value={selbstbeschrieb} onChange={(e) => setSelbstbeschrieb(e.target.value)} className="min-h-[90px]" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            {PORTAL_TEXTE['unterlagen.fragebogen_fokus_label']}
          </label>
          <Textarea value={fokus} onChange={(e) => setFokus(e.target.value)} className="min-h-[90px]" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            {PORTAL_TEXTE['unterlagen.fragebogen_nogos_label']}
          </label>
          <Textarea value={nogos} onChange={(e) => setNogos(e.target.value)} className="min-h-[90px]" />
        </div>
      </div>

      <Button onClick={() => void handleAbsenden()} disabled={speichert}>
        {speichert ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
        Absenden
      </Button>
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
  const wepublishEintraege = eintraege.filter((e) => e.quelle === 'We.Publish')
  const hatEintraege = eintraege.length > 0
  const hatLogo = logoStatus?.hatLogo ?? false
  const kannWeiter = hatEintraege && hatLogo

  return (
    <div className="space-y-6">
      <div>
        {/* Kurzes Seiten-Label, kein Fliesstext-Satz: analog STATION_LABEL bewusst nicht in PORTAL_TEXTE. */}
        <h1 className="text-xl font-bold text-slate-900">Unterlagen</h1>
        <p className="mt-1 text-sm text-slate-500">{PORTAL_TEXTE['unterlagen.intro']}</p>
      </div>

      {status === 'fehler' && <p className="text-sm text-slate-500">{PORTAL_TEXTE['fehler.daten_nicht_verfuegbar']}</p>}

      <LogoBlock hatLogo={hatLogo} slug={logoStatus?.slug ?? null} name={logoStatus?.name ?? ''} onErfolg={ladeLogoStatus} />

      <div className="grid gap-4 sm:grid-cols-2">
        <UploadBlock onErfolg={laden} />
        <UrlBlock onErfolg={laden} />
      </div>

      <FragebogenBlock onErfolg={laden} />

      {/* Wissens-Stand */}
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

        {status === 'bereit' && !hatEintraege && (
          <p className="text-sm text-slate-400">{PORTAL_TEXTE['unterlagen.liste_leer']}</p>
        )}

        {hatEintraege && (
          <ul className="space-y-2">
            {eintraege.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2"
              >
                <p className="min-w-0 truncate text-sm font-medium text-slate-800">{e.title}</p>
                <p className="shrink-0 whitespace-nowrap text-xs text-slate-400">
                  {kategorieLabelFromKey(e.category)} · {e.quelle} · {formatDatum(e.datum)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {wepublishEintraege.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <h2 className="text-sm font-semibold text-slate-900">{PORTAL_TEXTE['unterlagen.wepublish_titel']}</h2>
          <ul className="space-y-1.5">
            {wepublishEintraege.map((e) => (
              <li key={e.id} className="text-sm text-slate-600">
                {e.title} <span className="text-xs text-slate-400">· {formatDatum(e.datum)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
