/**
 * Medien-Onboarding — Wissensspeicher
 *
 * Erlaubt für jedes aktive Medium:
 *   - Dokumente hochladen (Datei → Directus-Files + Text-Extraktion + medium_knowledge)
 *   - Texte/URLs manuell hinzufügen (medium_knowledge)
 *   - Wissens-Einträge nach Kategorie sehen + löschen
 *   - Knowledge-Score (5 Kategorien-Abdeckung)
 *   - Onboarding-Felder aktualisieren (website, wepublish_api_url, mailchimp_archive_url)
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useApolloClient } from '@apollo/client/react'
import { UploadCloud, Plus, Trash2, Loader2, CheckCircle2, Globe, ChevronDown, ChevronUp, FileText, Link, BookOpen, Sparkles, AlertCircle, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  MEDIEN_REGISTER,
  MEDIEN_MIT_DNA,
  CREATE_MEDIUM,
  KNOWLEDGE_FOR_MEDIUM,
  CREATE_KNOWLEDGE,
  DELETE_KNOWLEDGE,
  UPDATE_MEDIUM_FELDER,
} from '@/graphql/onboarding'
import { slugify } from '@/graphql/projekte'
import { tenant } from '../../config/tenant'
import {
  berechneKnowledgeScore,
  kategorieLabelFromKey,
  SCORE_KATEGORIEN,
  type KnowledgeEintrag,
} from '@/lib/knowledge-score'
import ArbeitsDnaPdf from '@/components/ArbeitsDnaPdf'
import DnaGenerieren from '@/components/DnaGenerieren'
import { MediumLogo } from '@/components/MediumLogo'
import { MailEntwurfButton } from '@/components/MailEntwurfButton'
import { OnboardingSlackButton } from '@/components/OnboardingSlackButton'
import { bauWillkommensmail } from '@/lib/mail-vorlagen'
import type { ArbeitsDnaGespeichert } from '@/pages/api/medium-knowledge/working-dna'

// ─── Typen ────────────────────────────────────────────────────────────────────

interface FaasMedium {
  id: number
  slug: string
  name: string
  website: string | null
  wepublish_api_url: string | null
  mailchimp_archive_url: string | null
  kontakt_emails: string[] | null
  slack_channel: string | null
  antragsteller_typ: string | null
  arbeits_dna: ArbeitsDnaGespeichert | null
  arbeits_dna_stand: string | null
}

interface KnowledgeItem {
  id: number
  medium_id: string
  category: string
  title: string
  content: string | null
  file_id: string | null
  source_url: string | null
  published_date: string | null
  tags: unknown
  auto_scraped: boolean
  date_created: string
}

// ─── Kategorie-Optionen ───────────────────────────────────────────────────────

const KATEGORIE_OPTIONEN: Array<{ value: string; label: string }> = [
  { value: 'previous_application', label: 'Früheres Gesuch' },
  { value: 'tax_exemption', label: 'Gemeinnützigkeitsnachweis' },
  { value: 'budget', label: 'Budget' },
  { value: 'published_article', label: 'Artikel' },
  { value: 'newsletter', label: 'Newsletter' },
  { value: 'testimonial', label: 'Testimonial' },
  { value: 'general_info', label: 'Allgemeine Infos' },
]

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function gruppiereNachKategorie(items: KnowledgeItem[]): Record<string, KnowledgeItem[]> {
  const result: Record<string, KnowledgeItem[]> = {}
  for (const item of items) {
    const cat = item.category || 'general_info'
    if (!result[cat]) result[cat] = []
    result[cat].push(item)
  }
  return result
}

function formatDatum(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return iso
  }
}

// ─── Knowledge-Score-Anzeige ──────────────────────────────────────────────────

function KnowledgeScoreBlock({ items }: { items: KnowledgeItem[] }) {
  const score = berechneKnowledgeScore(items as KnowledgeEintrag[])

  const farbe =
    score.prozent >= 80
      ? 'bg-emerald-500'
      : score.prozent >= 60
      ? 'bg-amber-400'
      : 'bg-slate-300'

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
          Matching-Bereitschaft
        </h3>
        <span className="text-sm font-bold text-slate-800">
          {score.punkte}/{score.maxPunkte}
        </span>
      </div>

      {/* Fortschrittsbalken */}
      <div className="w-full bg-slate-100 rounded-full h-2 mb-3">
        <div
          className={`${farbe} h-2 rounded-full transition-all duration-500`}
          style={{ width: `${score.prozent}%` }}
        />
      </div>

      {/* Kategorie-Status */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {SCORE_KATEGORIEN.map(dim => {
          const vorhanden =
            items.some(i => i.category === dim.key) ||
            (dim.extraKey ? items.some(i => i.category === dim.extraKey) : false)
          return (
            <div key={dim.key} className="flex items-center gap-2 text-xs">
              {vorhanden ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
              ) : (
                <div className="w-3.5 h-3.5 rounded-full border border-slate-300 flex-shrink-0" />
              )}
              <span className={vorhanden ? 'text-slate-700' : 'text-slate-400'}>
                {dim.label}
              </span>
            </div>
          )
        })}
      </div>

      {score.fehlend.length > 0 && (
        <p className="text-[10px] text-slate-400 mt-2">
          Fehlend: {score.fehlend.join(', ')}
        </p>
      )}
    </div>
  )
}

// ─── Upload-Dropzone ──────────────────────────────────────────────────────────

interface UploadDropzoneProps {
  mediumId: string
  onErfolg: () => void
}

function UploadDropzone({ mediumId, onErfolg }: UploadDropzoneProps) {
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [kategorie, setKategorie] = useState('general_info')
  const [titel, setTitel] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function uploadDatei(datei: File) {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', datei)
      form.append('medium_id', mediumId)
      form.append('category', kategorie)
      if (titel.trim()) form.append('title', titel.trim())

      const res = await fetch('/api/medium-knowledge/upload', {
        method: 'POST',
        body: form,
      })
      const json = await res.json() as { id?: number; category?: string; title?: string; chars?: number; error?: string }

      if (!res.ok || json.error) {
        toast.error(`Upload fehlgeschlagen: ${json.error ?? `HTTP ${res.status}`}`)
        return
      }

      toast.success(`«${json.title}» gespeichert (${(json.chars ?? 0).toLocaleString('de-CH')} Zeichen)`)
      setTitel('')
      onErfolg()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Upload fehlgeschlagen: ${msg}`)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const datei = e.dataTransfer.files[0]
    if (datei) uploadDatei(datei)
  }

  function handleDateiWahl(e: React.ChangeEvent<HTMLInputElement>) {
    const datei = e.target.files?.[0]
    if (datei) uploadDatei(datei)
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
        Dokument hochladen
      </h3>

      <div className="flex gap-2 flex-wrap">
        <Select value={kategorie} onValueChange={setKategorie}>
          <SelectTrigger className="w-48 text-xs h-8">
            <SelectValue placeholder="Kategorie" />
          </SelectTrigger>
          <SelectContent>
            {KATEGORIE_OPTIONEN.map(opt => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          placeholder="Titel (optional)"
          value={titel}
          onChange={e => setTitel(e.target.value)}
          className="text-xs h-8 flex-1 min-w-32"
        />
      </div>

      {/* Dropzone */}
      <div
        className={[
          'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
          dragOver
            ? 'border-indigo-400 bg-indigo-50'
            : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white',
          uploading ? 'pointer-events-none opacity-60' : '',
        ].join(' ')}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-2 text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
            <span className="text-xs">Wird hochgeladen…</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <UploadCloud className="w-7 h-7" />
            <span className="text-xs font-medium">
              Datei hier ablegen oder klicken
            </span>
            <span className="text-[10px]">
              DOCX, XLSX, PDF, TXT, CSV, MD · max. 50 MB
            </span>
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

// ─── Manuell hinzufügen ───────────────────────────────────────────────────────

interface ManuellerEintragProps {
  mediumId: string
  onErfolg: () => void
}

function ManuellerEintrag({ mediumId, onErfolg }: ManuellerEintragProps) {
  const [offen, setOffen] = useState(false)
  const [kategorie, setKategorie] = useState('general_info')
  const [titel, setTitel] = useState('')
  const [inhalt, setInhalt] = useState('')
  const [url, setUrl] = useState('')

  const [createKnowledge, { loading }] = useMutation(CREATE_KNOWLEDGE)

  async function handleSpeichern() {
    if (!titel.trim() && !inhalt.trim() && !url.trim()) {
      toast.error('Bitte mindestens einen Titel, Text oder URL angeben.')
      return
    }

    try {
      await createKnowledge({
        variables: {
          data: {
            medium_id: mediumId,
            category: kategorie,
            title: titel.trim() || url.trim() || inhalt.slice(0, 80),
            content: inhalt.trim() || null,
            source_url: url.trim() || null,
            file_id: null,
            auto_scraped: false,
          },
        },
      })
      toast.success('Eintrag gespeichert.')
      setTitel('')
      setInhalt('')
      setUrl('')
      setOffen(false)
      onErfolg()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Fehler: ${msg}`)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <button
        type="button"
        className="flex items-center justify-between w-full text-xs font-semibold text-slate-700 uppercase tracking-wider"
        onClick={() => setOffen(v => !v)}
      >
        <span className="flex items-center gap-2">
          <Plus className="w-3.5 h-3.5" />
          Manuell hinzufügen
        </span>
        {offen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {offen && (
        <div className="mt-3 space-y-2">
          <Select value={kategorie} onValueChange={setKategorie}>
            <SelectTrigger className="text-xs h-8">
              <SelectValue placeholder="Kategorie" />
            </SelectTrigger>
            <SelectContent>
              {KATEGORIE_OPTIONEN.map(opt => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            placeholder="Titel"
            value={titel}
            onChange={e => setTitel(e.target.value)}
            className="text-xs h-8"
          />

          <Input
            placeholder="URL (optional)"
            value={url}
            onChange={e => setUrl(e.target.value)}
            className="text-xs h-8 font-mono"
          />

          <Textarea
            placeholder="Text (optional)"
            value={inhalt}
            onChange={e => setInhalt(e.target.value)}
            className="text-xs min-h-[80px]"
          />

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOffen(false)}
              className="text-xs"
            >
              Abbrechen
            </Button>
            <Button
              size="sm"
              onClick={handleSpeichern}
              disabled={loading}
              className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Speichern
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Scrape-Block ─────────────────────────────────────────────────────────────

interface ScrapeBlockProps {
  mediumId: string
  onErfolg: () => void
}

function ScrapeBlock({ mediumId, onErfolg }: ScrapeBlockProps) {
  const [url, setUrl] = useState('')
  const [kategorie, setKategorie] = useState('published_article')
  const [loading, setLoading] = useState(false)

  async function handleScrape() {
    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      toast.error('Bitte eine URL eingeben.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/medium-knowledge/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medium_id: mediumId, url: trimmedUrl, category: kategorie }),
      })
      const json = await res.json() as { id?: number; title?: string; chars?: number; error?: string }
      if (!res.ok || json.error) {
        toast.error(`Scraping fehlgeschlagen: ${json.error ?? `HTTP ${res.status}`}`)
        return
      }
      toast.success(
        `«${json.title}» gespeichert (${(json.chars ?? 0).toLocaleString('de-CH')} Zeichen)`
      )
      setUrl('')
      onErfolg()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Scraping fehlgeschlagen: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-2">
        <Link className="w-3.5 h-3.5" />
        Webseite scrapen
      </h3>

      <Select value={kategorie} onValueChange={setKategorie}>
        <SelectTrigger className="text-xs h-8">
          <SelectValue placeholder="Kategorie" />
        </SelectTrigger>
        <SelectContent>
          {KATEGORIE_OPTIONEN.map(opt => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex gap-2">
        <Input
          placeholder="https://…"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void handleScrape() }}
          className="text-xs h-8 font-mono flex-1"
        />
        <Button
          size="sm"
          onClick={() => { void handleScrape() }}
          disabled={loading || !url.trim()}
          className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white h-8 shrink-0"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Scrapen'}
        </Button>
      </div>
    </div>
  )
}

// ─── We.Publish-Ingest-Block ──────────────────────────────────────────────────

interface WepublishIngestBlockProps {
  mediumId: string
  hatApiUrl: boolean
  onErfolg: () => void
}

function WepublishIngestBlock({ mediumId, hatApiUrl, onErfolg }: WepublishIngestBlockProps) {
  const [loading, setLoading] = useState(false)

  async function handleIngest() {
    setLoading(true)
    try {
      const res = await fetch('/api/medium-knowledge/wepublish-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medium_id: mediumId }),
      })
      const json = await res.json() as {
        artikel_neu?: number
        newsletter_neu?: number
        uebersprungen?: number
        error?: string
      }
      if (!res.ok || json.error) {
        toast.error(`We.Publish-Ingest fehlgeschlagen: ${json.error ?? `HTTP ${res.status}`}`)
        return
      }
      const { artikel_neu = 0, newsletter_neu = 0, uebersprungen = 0 } = json
      toast.success(
        `${artikel_neu} Artikel + ${newsletter_neu} Newsletter neu · ${uebersprungen} übersprungen`
      )
      if (artikel_neu + newsletter_neu > 0) {
        onErfolg()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`We.Publish-Ingest fehlgeschlagen: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-2">
        <BookOpen className="w-3.5 h-3.5" />
        Aus We.Publish laden
      </h3>

      {!hatApiUrl ? (
        <p className="text-[11px] text-slate-400">
          Keine We.Publish-API-URL hinterlegt. Bitte oben in den Onboarding-Feldern ergänzen.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-500">
            Lädt bis zu 100 Artikel + 50 Newsletter via We.Publish-API.
            Bereits vorhandene Einträge werden übersprungen.
          </p>
          <Button
            size="sm"
            onClick={() => { void handleIngest() }}
            disabled={loading}
            className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white w-full"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                Lädt…
              </>
            ) : (
              'Artikel + Newsletter laden'
            )}
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Onboarding-Felder ────────────────────────────────────────────────────────

interface OnboardingFelderProps {
  medium: FaasMedium
  onAktualisiert: () => void
}

function OnboardingFelder({ medium, onAktualisiert }: OnboardingFelderProps) {
  const [website, setWebsite] = useState(medium.website ?? '')
  const [wepublishUrl, setWepublishUrl] = useState(medium.wepublish_api_url ?? '')
  const [mailchimpUrl, setMailchimpUrl] = useState(medium.mailchimp_archive_url ?? '')
  const [kontaktEmails, setKontaktEmails] = useState(
    (medium.kontakt_emails ?? []).join(', ')
  )
  const [slackChannel, setSlackChannel] = useState(medium.slack_channel ?? '')
  const [speichern, setSpeichern] = useState(false)

  const [updateMedium] = useMutation(UPDATE_MEDIUM_FELDER)

  async function handleSpeichern() {
    setSpeichern(true)
    try {
      const emailListe = kontaktEmails
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      await updateMedium({
        variables: {
          id: String(medium.id),
          data: {
            website: website.trim() || null,
            wepublish_api_url: wepublishUrl.trim() || null,
            mailchimp_archive_url: mailchimpUrl.trim() || null,
            kontakt_emails: emailListe.length > 0 ? emailListe : null,
            slack_channel: slackChannel.trim() || null,
          },
        },
      })
      toast.success('Onboarding-Felder gespeichert.')
      onAktualisiert()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Fehler: ${msg}`)
    } finally {
      setSpeichern(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-2">
        <Globe className="w-3.5 h-3.5" />
        Onboarding-Felder
      </h3>

      <div className="space-y-2">
        <div>
          <label className="block text-[10px] text-slate-500 mb-0.5">Website</label>
          <Input
            value={website}
            onChange={e => setWebsite(e.target.value)}
            placeholder="https://…"
            className="text-xs h-8 font-mono"
          />
        </div>
        <div>
          <label className="block text-[10px] text-slate-500 mb-0.5">We.Publish API URL</label>
          <Input
            value={wepublishUrl}
            onChange={e => setWepublishUrl(e.target.value)}
            placeholder="https://api.…/graphql"
            className="text-xs h-8 font-mono"
          />
        </div>
        <div>
          <label className="block text-[10px] text-slate-500 mb-0.5">Mailchimp-Archiv URL</label>
          <Input
            value={mailchimpUrl}
            onChange={e => setMailchimpUrl(e.target.value)}
            placeholder="https://mailchi.mp/…"
            className="text-xs h-8 font-mono"
          />
        </div>
        <div>
          <label className="block text-[10px] text-slate-500 mb-0.5">Kontakt-Mails (Allowlist)</label>
          <Input
            value={kontaktEmails}
            onChange={e => setKontaktEmails(e.target.value)}
            placeholder="redaktion@medium.ch, chef@medium.ch"
            className="text-xs h-8 font-mono"
          />
          <p className="text-[9px] text-slate-400 mt-0.5">
            Nur an diese Adressen kann das System Mails senden (ab Phase 3). Stiftungen werden nie direkt angeschrieben.
          </p>
        </div>
        <div>
          <label className="block text-[10px] text-slate-500 mb-0.5">Slack-Kanal</label>
          <Input
            value={slackChannel}
            onChange={e => setSlackChannel(e.target.value)}
            placeholder="#p-faas-…"
            className="text-xs h-8 font-mono"
          />
          <p className="text-[9px] text-slate-400 mt-0.5">
            Ziel für Slack-Entwürfe (Nachfassen, Datensuppe-Erinnerung).
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={handleSpeichern}
          disabled={speichern}
          className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
        >
          {speichern ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
          Speichern
        </Button>
      </div>
    </div>
  )
}

// ─── Wissens-Liste ────────────────────────────────────────────────────────────

interface WissensListeProps {
  items: KnowledgeItem[]
  loading: boolean
  onDelete: (id: number) => void
  loescheId: number | null
}

function WissensListe({ items, loading, onDelete, loescheId }: WissensListeProps) {
  const gruppiert = gruppiereNachKategorie(items)
  const kategorien = Object.keys(gruppiert).sort()

  if (loading && items.length === 0) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  if (!loading && items.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p className="text-xs">Noch keine Wissens-Einträge.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {kategorien.map(kat => (
        <div key={kat}>
          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {kategorieLabelFromKey(kat)}
            </h4>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {gruppiert[kat].length}
            </Badge>
          </div>

          <div className="space-y-1.5">
            {gruppiert[kat].map(item => (
              <div
                key={item.id}
                className="flex items-start gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2 hover:border-slate-200 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-slate-800 truncate">
                      {item.title}
                    </span>
                    {item.auto_scraped && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 text-slate-400 border-slate-200">
                        auto
                      </Badge>
                    )}
                    {item.file_id && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 text-indigo-500 border-indigo-200">
                        Datei
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {item.source_url && (
                      <a
                        href={item.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-indigo-500 hover:underline truncate max-w-[200px]"
                      >
                        {item.source_url}
                      </a>
                    )}
                    <span className="text-[10px] text-slate-400">
                      {formatDatum(item.date_created)}
                    </span>
                    {item.content && (
                      <span className="text-[10px] text-slate-300">
                        {item.content.length.toLocaleString('de-CH')} Z.
                      </span>
                    )}
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="w-6 h-6 flex-shrink-0 text-slate-300 hover:text-red-500 hover:bg-red-50"
                  onClick={() => onDelete(item.id)}
                  disabled={loescheId === item.id}
                  title="Löschen"
                >
                  {loescheId === item.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Trash2 className="w-3 h-3" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Arbeits-DNA-Block ────────────────────────────────────────────────────────

interface ArbeitsDnaBlockProps {
  medium: FaasMedium
  onAktualisiert: () => void
}

function ArbeitsDnaBlock({ medium, onAktualisiert }: ArbeitsDnaBlockProps) {
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [jobFehler, setJobFehler] = useState<string | null>(null)
  const [sekunden, setSekunden] = useState(0)

  // Polling-Intervall
  const pollenRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stoppePolling = useCallback(() => {
    if (pollenRef.current !== null) {
      clearInterval(pollenRef.current)
      pollenRef.current = null
    }
  }, [])

  // Polling starten sobald job_id bekannt
  useEffect(() => {
    if (!jobId || jobStatus !== 'running') return

    const startzeit = Date.now()

    pollenRef.current = setInterval(async () => {
      setSekunden(Math.round((Date.now() - startzeit) / 1000))
      try {
        const res = await fetch(`/api/medium-knowledge/working-dna?job_id=${encodeURIComponent(jobId)}`)
        const json = await res.json() as {
          status?: string
          error?: string
        }
        if (json.status === 'done') {
          stoppePolling()
          setJobStatus('done')
          // Medien-Daten neu laden damit arbeits_dna angezeigt wird
          onAktualisiert()
        } else if (json.status === 'error') {
          stoppePolling()
          setJobStatus('error')
          setJobFehler(json.error ?? 'Unbekannter Fehler')
          toast.error(`Arbeits-DNA fehlgeschlagen: ${json.error ?? 'Fehler'}`)
        }
      } catch {
        // Netzwerkfehler beim Pollen → ignorieren, weiter pollen
      }
    }, 5_000)

    return () => stoppePolling()
  }, [jobId, jobStatus, stoppePolling, onAktualisiert])

  async function handleGenerieren() {
    setJobStatus('running')
    setJobFehler(null)
    setSekunden(0)
    try {
      const res = await fetch('/api/medium-knowledge/working-dna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medium_id: medium.slug }),
      })
      const json = await res.json() as { job_id?: string; error?: string }
      if (!res.ok || !json.job_id) {
        setJobStatus('error')
        const msg = json.error ?? `HTTP ${res.status}`
        setJobFehler(msg)
        toast.error(`Arbeits-DNA: ${msg}`)
        return
      }
      setJobId(json.job_id)
    } catch (err) {
      setJobStatus('error')
      const msg = err instanceof Error ? err.message : String(err)
      setJobFehler(msg)
      toast.error(`Arbeits-DNA: ${msg}`)
    }
  }

  const dna = medium.arbeits_dna

  // Dimensionen-Definition für die Anzeige
  const dimensionen: Array<{ label: string; wert: string[] }> = dna
    ? [
        { label: 'Kernthemen', wert: dna.core_themes ?? [] },
        { label: 'Redaktionelle Haltung', wert: dna.editorial_stance ?? [] },
        { label: 'Gesellschaftliche Wirkung', wert: dna.societal_impact ?? [] },
        { label: 'Zielgruppen', wert: dna.target_groups ?? [] },
        {
          label: 'Geografischer Fokus',
          wert: dna.geographic_focus ? [dna.geographic_focus] : [],
        },
        { label: 'Finanzierungsmodell', wert: dna.funding_model_hints ?? [] },
        { label: 'Matching-Keywords', wert: dna.funding_keywords ?? [] },
        { label: 'Stärken für Anträge', wert: dna.grant_strengths ?? [] },
        { label: 'Passende Stiftungsthemen', wert: dna.matching_foundation_themes ?? [] },
      ]
    : []

  const scoreFarbe =
    dna && dna.score >= 70
      ? 'text-emerald-600'
      : dna && dna.score >= 45
      ? 'text-amber-600'
      : 'text-slate-400'

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
          Arbeits-DNA
        </h3>
        {dna && (
          <span className={`text-xs font-bold ${scoreFarbe}`}>
            {dna.score}/100
          </span>
        )}
      </div>

      {/* Bestehende DNA anzeigen */}
      {dna && (
        <div className="space-y-3">
          {/* Generierungsdatum */}
          {medium.arbeits_dna_stand && (
            <p className="text-[10px] text-slate-400">
              Generiert:{' '}
              {new Date(medium.arbeits_dna_stand).toLocaleDateString('de-CH', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
              {' · '}
              {dna.korpus_count ?? 0} Einträge im Korpus
            </p>
          )}

          {/* DNA-Zusammenfassung */}
          {dna.dna_summary && (
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Zusammenfassung
              </p>
              <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                {dna.dna_summary}
              </p>
            </div>
          )}

          {/* Dimensionen als Chip-Listen */}
          <div className="space-y-2">
            {dimensionen.map(dim =>
              dim.wert.length > 0 ? (
                <div key={dim.label}>
                  <p className="text-[9px] font-semibold text-indigo-600 uppercase tracking-wider mb-1">
                    {dim.label}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {dim.wert.map((item, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-[10px] px-2 py-0.5"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null
            )}
          </div>

          {/* PDF-Export */}
          <div className="pt-1">
            <ArbeitsDnaPdf
              mediumName={medium.name}
              website={medium.website}
              arbeitsDna={dna}
              slug={medium.slug}
            />
          </div>
        </div>
      )}

      {/* Kein DNA vorhanden + Generieren-Button */}
      {!dna && jobStatus === 'idle' && (
        <p className="text-[11px] text-slate-400">
          Noch keine Arbeits-DNA. Sammle Wissens-Einträge und generiere das Profil.
        </p>
      )}

      {/* Fehlermeldung */}
      {jobStatus === 'error' && jobFehler && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-2.5 text-[11px] text-red-700">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{jobFehler}</span>
        </div>
      )}

      {/* Aktions-Zeile */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          onClick={() => { void handleGenerieren() }}
          disabled={jobStatus === 'running'}
          className={[
            'text-xs',
            dna
              ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white',
          ].join(' ')}
        >
          {jobStatus === 'running' ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              generiert … (läuft seit {sekunden}s)
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              {dna ? 'Neu generieren' : 'Arbeits-DNA generieren'}
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

// ─── Finale-DNA-Block (v3-Messung aus Arbeits-DNA) ───────────────────────────

interface FinalesDnaBlockProps {
  medium: FaasMedium
}

interface FinalesDnaVersion {
  id: number
  version: number
  schaerfe_prozent: number
  tag_count: number
  sound_feeling: string
  tags: { tag_slug: string; gewicht: number; begruendung: string }[]
  hatte_crawl: boolean
  warnung?: string
}

interface FinalesDnaJobPayload {
  id: string
  medium_id: string
  status: 'running' | 'done' | 'error'
  startedAt: number
  result?: FinalesDnaVersion
  error?: string
}

function FinalesDnaBlock({ medium }: FinalesDnaBlockProps) {
  const [jobStatus, setJobStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [gemesseneVersion, setGemesseneVersion] = useState<FinalesDnaVersion | null>(null)
  const [jobFehler, setJobFehler] = useState<string | null>(null)
  const [sekunden, setSekunden] = useState(0)
  const [aktivierung, setAktivierung] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [aktivierungsFehler, setAktivierungsFehler] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sekundenRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const jobIdRef = useRef<string | null>(null)

  function stoppePolling() {
    if (pollRef.current !== null) { clearInterval(pollRef.current); pollRef.current = null }
    if (sekundenRef.current !== null) { clearInterval(sekundenRef.current); sekundenRef.current = null }
  }

  // Polling aufräumen bei Unmount
  useEffect(() => () => stoppePolling(), [])

  async function handleMessen() {
    // Arbeits-DNA ist der Standard-Korpus (Stufe 1). Fehlt sie (etablierte Medien
    // wie wepublish/cueltuer), misst die Route aus der bestehenden DNA — v3-Migration.
    // Kein harter Block mehr; der Server entscheidet die Korpusquelle.
    setJobStatus('running')
    setGemesseneVersion(null)
    setJobFehler(null)
    setSekunden(0)
    setAktivierung('idle')
    setAktivierungsFehler(null)
    stoppePolling()

    // ── Job anstossen ────────────────────────────────────────────────────────
    let jobId: string
    try {
      const res = await fetch('/api/measure-medium-dna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ medium_id: medium.slug }),
      })
      const json = await res.json() as { job_id?: string; error?: string }
      if (!res.ok || json.error) {
        const msg = json.error ?? `HTTP ${res.status}`
        setJobStatus('error')
        setJobFehler(msg)
        toast.error(`Messung fehlgeschlagen: ${msg}`)
        return
      }
      if (!json.job_id) {
        setJobStatus('error')
        setJobFehler('Kein job_id erhalten')
        return
      }
      jobId = json.job_id
      jobIdRef.current = jobId
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setJobStatus('error')
      setJobFehler(msg)
      toast.error(`Messung konnte nicht gestartet werden: ${msg}`)
      return
    }

    // ── Sekunden-Zähler ──────────────────────────────────────────────────────
    sekundenRef.current = setInterval(() => setSekunden(s => s + 1), 1_000)

    // ── Polling alle 5s ──────────────────────────────────────────────────────
    pollRef.current = setInterval(async () => {
      const currentId = jobIdRef.current
      if (!currentId) return
      try {
        const res = await fetch(`/api/measure-medium-dna?job_id=${encodeURIComponent(currentId)}`)
        if (res.status === 404) {
          stoppePolling()
          setJobStatus('error')
          setJobFehler('Status nicht mehr verfügbar (Server neugestartet?) — bitte neu messen.')
          return
        }
        if (!res.ok) return // Transient — weiter pollen

        const job = await res.json() as FinalesDnaJobPayload
        if (job.status === 'done') {
          stoppePolling()
          setJobStatus('done')
          if (job.result) {
            setGemesseneVersion(job.result)
            toast.success(
              `v3-DNA gemessen: Schärfe ${job.result.schaerfe_prozent} %, ${job.result.tag_count} Tags.`
            )
          }
        } else if (job.status === 'error') {
          stoppePolling()
          setJobStatus('error')
          setJobFehler(job.error ?? 'Unbekannter Fehler')
          toast.error(`Messung fehlgeschlagen: ${job.error ?? 'Fehler'}`)
        }
      } catch {
        // Netzwerkfehler beim Pollen → ignorieren, weiter pollen
      }
    }, 5_000)
  }

  async function handleAktivieren() {
    if (!gemesseneVersion) return
    setAktivierung('running')
    setAktivierungsFehler(null)
    try {
      const res = await fetch('/api/activate-medium-dna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: gemesseneVersion.id }),
      })
      const json = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || json.error) {
        setAktivierung('error')
        setAktivierungsFehler(json.error ?? `HTTP ${res.status}`)
        toast.error(`Aktivierung fehlgeschlagen: ${json.error ?? res.status}`)
        return
      }
      setAktivierung('done')
      toast.success(`v${gemesseneVersion.version} ist jetzt aktiv — Medium erscheint in Medien und ist matchbar.`)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setAktivierung('error')
      setAktivierungsFehler(msg)
      toast.error(`Aktivierung fehlgeschlagen: ${msg}`)
    }
  }

  const hatArbeitsDna = Boolean(medium.arbeits_dna)

  const topTags = gemesseneVersion
    ? [...gemesseneVersion.tags]
        .sort((a, b) => b.gewicht - a.gewicht)
        .slice(0, 8)
    : []

  return (
    <div className="rounded-xl border border-indigo-100 bg-white p-4 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-indigo-500" />
          Finale DNA (v3)
        </h3>
        {gemesseneVersion && (
          <span className="text-xs font-bold text-indigo-600">
            Schärfe {gemesseneVersion.schaerfe_prozent} %
          </span>
        )}
      </div>

      {/* Hinweis je nach Korpusquelle */}
      {!hatArbeitsDna && jobStatus === 'idle' && !gemesseneVersion && (
        <p className="text-[11px] text-slate-500">
          Keine Arbeits-DNA vorhanden — die finale v3-DNA wird aus der bestehenden DNA des Mediums gemessen (v3-Migration). Für ein frisches Profil zuerst oben die Arbeits-DNA generieren.
        </p>
      )}

      {hatArbeitsDna && jobStatus === 'idle' && !gemesseneVersion && (
        <p className="text-[11px] text-slate-500">
          Misst die finale v3-DNA aus der Arbeits-DNA — nach der Besprechung mit dem Medium durchführen. Danach erscheint das Medium in «Medien» und wird matchbar.
        </p>
      )}

      {/* Fehlermeldung Messung */}
      {jobStatus === 'error' && jobFehler && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-2.5 text-[11px] text-red-700">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{jobFehler}</span>
        </div>
      )}

      {/* Mess-Ergebnis */}
      {gemesseneVersion && (
        <div className="space-y-3">
          <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-3 space-y-2">
            <div className="flex items-center gap-4 text-xs text-slate-700">
              <span>Version: <strong>v{gemesseneVersion.version}</strong></span>
              <span>Tags: <strong>{gemesseneVersion.tag_count}</strong></span>
              {gemesseneVersion.hatte_crawl && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 text-indigo-600 border-indigo-200">
                  Web-Crawl
                </Badge>
              )}
            </div>

            {gemesseneVersion.sound_feeling && (
              <p className="text-[11px] text-slate-600 leading-relaxed">
                {gemesseneVersion.sound_feeling.slice(0, 300)}
                {gemesseneVersion.sound_feeling.length > 300 ? ' …' : ''}
              </p>
            )}

            {topTags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {topTags.map(t => (
                  <span
                    key={t.tag_slug}
                    className={[
                      'inline-flex items-center rounded-full text-[10px] px-2 py-0.5 border',
                      t.gewicht === 3
                        ? 'bg-indigo-100 border-indigo-200 text-indigo-800'
                        : t.gewicht === 2
                        ? 'bg-slate-100 border-slate-200 text-slate-700'
                        : 'bg-white border-slate-200 text-slate-500',
                    ].join(' ')}
                    title={t.begruendung}
                  >
                    {t.tag_slug}
                    <span className="ml-0.5 opacity-60">·{t.gewicht}</span>
                  </span>
                ))}
              </div>
            )}

            {gemesseneVersion.warnung && (
              <p className="text-[10px] text-amber-700 bg-amber-50 rounded px-2 py-1">
                {gemesseneVersion.warnung}
              </p>
            )}
          </div>

          {/* Aktivieren */}
          {aktivierung !== 'done' && (
            <div className="space-y-2">
              <Button
                size="sm"
                onClick={() => { void handleAktivieren() }}
                disabled={aktivierung === 'running'}
                className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white w-full"
              >
                {aktivierung === 'running' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                    Wird aktiviert…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                    Diese Version aktiv schalten
                  </>
                )}
              </Button>
              <p className="text-[10px] text-slate-400 text-center">
                Danach erscheint das Medium in «Medien» und wird matchbar.
              </p>
              {aktivierung === 'error' && aktivierungsFehler && (
                <p className="text-[11px] text-red-600 bg-red-50 rounded px-2 py-1">
                  {aktivierungsFehler}
                </p>
              )}
            </div>
          )}

          {aktivierung === 'done' && (
            <div className="flex items-center gap-2 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
              Aktiv — das Medium erscheint jetzt in «Medien» und ist matchbar.
            </div>
          )}
        </div>
      )}

      {/* Aktions-Zeile */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          onClick={() => { void handleMessen() }}
          disabled={jobStatus === 'running'}
          className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
          title={!hatArbeitsDna ? 'Misst aus der bestehenden DNA (v3-Migration)' : undefined}
        >
          {jobStatus === 'running' ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              misst … ({sekunden}s)
            </>
          ) : (
            <>
              <Zap className="w-3.5 h-3.5 mr-1.5" />
              {gemesseneVersion ? 'Neu messen' : 'Finale v3-DNA messen'}
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

// ─── Hauptseite ───────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const [ausgewaehltesMediumSlug, setAusgewaehltesMediumSlug] = useState<string>('')
  const [loescheId, setLoescheId] = useState<number | null>(null)

  const apolloClient = useApolloClient()

  // ── Medien-Register laden ─────────────────────────────────────────────────
  const { data: medienData, loading: medienLaden } = useQuery(MEDIEN_REGISTER, {
    fetchPolicy: 'cache-and-network',
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const medien: FaasMedium[] = (medienData as any)?.faas_medien ?? []

  // Onboarding ist NUR für neue Medien: Medien mit aktiver gemessener DNA sind
  // bereits onboardet (→ Medien-Tab) und erscheinen hier NICHT.
  const { data: dnaData, loading: dnaLaden } = useQuery(MEDIEN_MIT_DNA, { fetchPolicy: 'cache-and-network' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dnaSlugs = new Set<string>(((dnaData as any)?.medium_dna ?? []).map((d: any) => d.medium_id))
  const inOnboarding = medien.filter(m => !dnaSlugs.has(m.slug))
  const ausgewaehltesMedium = medien.find(m => m.slug === ausgewaehltesMediumSlug) ?? null

  // Automatisch erstes IN-ONBOARDING-Medium vorauswählen (nicht die etablierten).
  // Erst wenn BEIDE Abfragen da sind: beim Erst-Render ist dnaSlugs sonst noch
  // leer, inOnboarding enthält dann alle Medien und die Auswahl fällt auf ein
  // bereits onboardetes Medium (z.B. bajour), das gar nicht im Dropdown steht.
  if (!medienLaden && !dnaLaden && inOnboarding.length > 0) {
    const auswahlImOnboarding = inOnboarding.some(m => m.slug === ausgewaehltesMediumSlug)
    if (!auswahlImOnboarding) {
      setAusgewaehltesMediumSlug(inOnboarding[0].slug)
    }
  }

  // ── Neues Medium aufnehmen ────────────────────────────────────────────────
  const [createMedium] = useMutation(CREATE_MEDIUM)
  const [neuName, setNeuName] = useState('')
  const [neuWebsite, setNeuWebsite] = useState('')
  async function neuesMediumAnlegen() {
    const n = neuName.trim()
    if (!n) return
    const slug = slugify(n)
    // Duplikat-Schutz: der Slug ist in Directus nicht unique. Ohne diesen
    // Check entstuende beim erneuten «Aufnehmen» eines bestehenden Namens
    // eine zweite Zeile mit demselben Slug (Engine, Portal und Waechter
    // wuerden dann auf zwei Medien schreiben). Stattdessen das bestehende
    // Medium auswaehlen.
    const bestehend = medien.find(m => m.slug === slug)
    if (bestehend) {
      setAusgewaehltesMediumSlug(slug)
      setNeuName('')
      setNeuWebsite('')
      toast.info(
        dnaSlugs.has(slug)
          ? `«${bestehend.name}» existiert schon und ist bereits onboardet (siehe Medien-Tab).`
          : `«${bestehend.name}» existiert schon — unten ausgewählt, du kannst direkt weitermachen.`
      )
      return
    }
    // We.Publish-API nach dem Standard-Muster vorbelegen (editierbar in den
    // Onboarding-Feldern). Abweichungen wie «cultur» (cueltuer) oder «eenews»
    // (ee-news, ohne /v1) korrigiert man dort von Hand.
    const apiUrlVorschlag = `https://api-${slug}.wepublish.cloud/v1`
    try {
      await createMedium({
        variables: {
          data: {
            name: n,
            slug,
            mandant: tenant.key,
            is_active: true,
            website: neuWebsite.trim() || null,
            wepublish_api_url: apiUrlVorschlag,
          },
        },
      })
      toast.success(`Medium «${n}» aufgenommen · API-URL vorbelegt (${apiUrlVorschlag}) — bei Abweichung in den Feldern anpassen`)
      setNeuName('')
      setNeuWebsite('')
      await apolloClient.refetchQueries({ include: [MEDIEN_REGISTER, MEDIEN_MIT_DNA] })
      setAusgewaehltesMediumSlug(slug)
    } catch (err) {
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ── Knowledge-Einträge laden ──────────────────────────────────────────────
  const { data: wissensData, loading: wissensLaden, refetch: refetchWissen } = useQuery(
    KNOWLEDGE_FOR_MEDIUM,
    {
      variables: { medium: ausgewaehltesMediumSlug },
      skip: !ausgewaehltesMediumSlug,
      fetchPolicy: 'cache-and-network',
    }
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wissensItems: KnowledgeItem[] = (wissensData as any)?.medium_knowledge ?? []

  const [deleteKnowledge] = useMutation(DELETE_KNOWLEDGE)

  async function handleLoeschen(id: number) {
    setLoescheId(id)
    try {
      await deleteKnowledge({ variables: { id: String(id) } })
      toast.success('Eintrag gelöscht.')
      await refetchWissen()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Löschen fehlgeschlagen: ${msg}`)
    } finally {
      setLoescheId(null)
    }
  }

  function handleAktualisiert() {
    // Apollo-Cache für faas_medien invalidieren → frische Daten beim nächsten Render
    void apolloClient.refetchQueries({ include: [MEDIEN_REGISTER] })
  }

  return (
    <div>
      {/* Abschnitt-Header */}
      <div className="mb-4">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Neue Medien aufnehmen
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Hier nimmst du NEUE Medien auf: Material erfassen → Arbeits-DNA → finale DNA messen.
          Bereits onboardete Medien (mit gemessener DNA) findest du im Medien-Tab.
        </p>
      </div>

      {/* Neues Medium aufnehmen */}
      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-600 shrink-0">Neues Medium:</span>
        <Input
          placeholder="Name (z.B. Hauptstadt)"
          value={neuName}
          onChange={e => setNeuName(e.target.value)}
          className="w-48 text-sm"
        />
        <Input
          placeholder="Website (optional)"
          value={neuWebsite}
          onChange={e => setNeuWebsite(e.target.value)}
          className="w-56 text-sm"
        />
        <Button size="sm" onClick={neuesMediumAnlegen} disabled={!neuName.trim()}>
          Aufnehmen
        </Button>
      </div>

      {/* Auswahl der Medien IN Onboarding (ohne gemessene DNA) */}
      <div className="mb-6 flex items-center gap-3">
        {medienLaden && medien.length === 0 ? (
          <div className="h-9 w-64 bg-slate-100 rounded-md animate-pulse" />
        ) : inOnboarding.length === 0 ? (
          <p className="text-sm text-slate-400">
            Kein Medium in Onboarding. Alle aktiven Medien haben eine gemessene DNA — neue oben aufnehmen.
          </p>
        ) : (
          <>
            {ausgewaehltesMedium && (
              <MediumLogo slug={ausgewaehltesMedium.slug} name={ausgewaehltesMedium.name} size={36} />
            )}
            <Select value={ausgewaehltesMediumSlug} onValueChange={setAusgewaehltesMediumSlug}>
              <SelectTrigger className="w-64 text-sm">
                <SelectValue placeholder="Medium in Onboarding…" />
              </SelectTrigger>
              <SelectContent>
                {inOnboarding.map(m => (
                  <SelectItem key={m.slug} value={m.slug} className="text-sm">
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {ausgewaehltesMedium && (
              (() => {
                const mail = bauWillkommensmail({ mediumName: ausgewaehltesMedium.name })
                return (
                  <>
                    <MailEntwurfButton
                      betreff={mail.betreff}
                      text={mail.text}
                      // Erste Adresse aus der Kontakt-Allowlist als Empfänger
                      // vorbelegen; ist keine erfasst, öffnet das Mail-Programm
                      // ohne Empfänger.
                      an={ausgewaehltesMedium.kontakt_emails?.[0]}
                      label="Willkommensmail"
                      titel={`Willkommensmail – ${ausgewaehltesMedium.name}`}
                    />
                    <OnboardingSlackButton
                      mediumSlug={ausgewaehltesMedium.slug}
                      mediumName={ausgewaehltesMedium.name}
                      website={ausgewaehltesMedium.website}
                    />
                  </>
                )
              })()
            )}
          </>
        )}
      </div>

      {/* Kein Medium ausgewählt */}
      {!ausgewaehltesMedium && !medienLaden && (
        <div className="text-center py-16 text-slate-400">
          <p className="text-sm">Kein Medium ausgewählt.</p>
        </div>
      )}

      {/* Haupt-Layout */}
      {ausgewaehltesMedium && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Linke Spalte: Score + Onboarding-Felder + Upload + Manuell */}
          <div className="space-y-4">
            <KnowledgeScoreBlock items={wissensItems} />

            <OnboardingFelder
              // key erzwingt Remount beim Medienwechsel: die Feld-States werden
              // per useState aus dem Medium initialisiert und würden sonst die
              // Werte des vorherigen Mediums behalten (Gefahr: Fremddaten-Save).
              key={ausgewaehltesMedium.slug}
              medium={ausgewaehltesMedium}
              onAktualisiert={handleAktualisiert}
            />

            {/* Empfohlener Weg: EIN Knopf zieht alle Quellen → eine aktive DNA. */}
            <DnaGenerieren
              slug={ausgewaehltesMediumSlug}
              name={ausgewaehltesMedium.name}
              website={ausgewaehltesMedium.website}
              onFertig={() => { void refetchWissen(); handleAktualisiert() }}
            />

            {/* Manuell ergänzen (optional) — einzelne Quellen + Schritte von Hand. */}
            <details className="group rounded-xl border border-slate-200 bg-slate-50/50">
              <summary className="cursor-pointer list-none px-4 py-2.5 text-xs font-semibold text-slate-600 flex items-center justify-between">
                <span>Manuell ergänzen (optional)</span>
                <ChevronDown className="w-4 h-4 text-slate-400 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="px-3 pb-3 space-y-4">
                <p className="text-[11px] text-slate-400 px-1">
                  Normalerweise nicht nötig — der Knopf oben sammelt We.Publish, Datensuppe und Web-Crawl
                  automatisch. Hier kannst du einzelne Quellen von Hand hinzufügen oder die Schritte separat ausführen.
                </p>

                <UploadDropzone
                  mediumId={ausgewaehltesMediumSlug}
                  onErfolg={() => { void refetchWissen() }}
                />

                <ManuellerEintrag
                  mediumId={ausgewaehltesMediumSlug}
                  onErfolg={() => { void refetchWissen() }}
                />

                <ScrapeBlock
                  mediumId={ausgewaehltesMediumSlug}
                  onErfolg={() => { void refetchWissen() }}
                />

                <WepublishIngestBlock
                  mediumId={ausgewaehltesMediumSlug}
                  hatApiUrl={Boolean(ausgewaehltesMedium.wepublish_api_url)}
                  onErfolg={() => { void refetchWissen() }}
                />

                <ArbeitsDnaBlock
                  medium={ausgewaehltesMedium}
                  onAktualisiert={handleAktualisiert}
                />

                <FinalesDnaBlock
                  medium={ausgewaehltesMedium}
                />
              </div>
            </details>
          </div>

          {/* Rechte Spalte (2/3): Wissens-Liste */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-slate-700">
                Wissens-Einträge
              </h3>
              <span className="text-xs text-slate-400">
                {wissensItems.length.toLocaleString('de-CH')} Einträge
              </span>
            </div>

            <WissensListe
              items={wissensItems}
              loading={wissensLaden}
              onDelete={handleLoeschen}
              loescheId={loescheId}
            />
          </div>
        </div>
      )}
    </div>
  )
}
