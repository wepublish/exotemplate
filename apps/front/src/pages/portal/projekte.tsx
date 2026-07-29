import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, Loader2, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { SchrittInfo } from '@/components/portal/SchrittInfo'
import { TrefferKarte } from '@/components/portal/TrefferKarte'
import { ConsentDialog } from '@/components/portal/ConsentDialog'
import { RueckmeldungDialog } from '@/components/RueckmeldungDialog'
import { PORTAL_TEXTE } from '@/lib/portal-texte'
import {
  PROJEKT_ZUSTAND_LABEL,
  projektZustand,
  PROJEKT_BESCHREIBUNG_MIN,
  PROJEKT_NAME_MIN,
  type ProjektZeile,
} from '@/lib/portal-projekte'
import type { PortalTreffer } from '@/lib/portal-treffer'

/**
 * /portal/projekte: das Medium eröffnet eigene Projekte, lässt deren Profil
 * messen und die passenden Stiftungen suchen — ohne Umweg über We.Publish
 * (Wunsch Jolanda 29.07.2026).
 *
 * Der Mess- und Match-Lauf ist derselbe wie im Cockpit (Spark, ~5–6 Minuten).
 * Die Seite pollt danach die Liste: sobald Treffer da sind, wechselt der
 * Zustand von «wird gemessen» auf «Treffer bereit».
 */

const POLL_MS = 20_000

const ZUSTAND_FARBE: Record<string, string> = {
  neu: 'border-slate-200 bg-slate-50 text-slate-500',
  wird_gemessen: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  bereit: 'border-amber-200 bg-amber-50 text-amber-700',
  treffer_da: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}

export default function PortalProjekteSeite() {
  const [projekte, setProjekte] = useState<ProjektZeile[] | null>(null)
  const [laufend, setLaufend] = useState<Set<number>>(new Set())

  const [name, setName] = useState('')
  const [beschreibung, setBeschreibung] = useState('')
  const [legtAn, setLegtAn] = useState(false)

  const [offenesProjekt, setOffenesProjekt] = useState<number | null>(null)
  const [treffer, setTreffer] = useState<PortalTreffer[]>([])
  const [trefferLaedt, setTrefferLaedt] = useState(false)

  // Gesuch für einen Projekt-Treffer anfordern (29.07.2026): identischer
  // Consent-Weg wie bei den Medium-Treffern, nur mit projekt_id im Body.
  const [aktionLaeuft, setAktionLaeuft] = useState(false)
  const [consentTreffer, setConsentTreffer] = useState<PortalTreffer | null>(null)
  const [consentText, setConsentText] = useState('')
  const [consentVoll, setConsentVoll] = useState(true)
  const [bestaetigenLaeuft, setBestaetigenLaeuft] = useState(false)
  const [rueckmeldungTreffer, setRueckmeldungTreffer] = useState<PortalTreffer | null>(null)
  const [rueckmeldungLaeuft, setRueckmeldungLaeuft] = useState(false)

  const laden = useCallback(() => {
    fetch(`/api/portal/projekte?cb=${Date.now()}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`projekte: Status ${res.status}`)
        const daten = (await res.json()) as { projekte: ProjektZeile[] }
        setProjekte(daten.projekte)
        // Ein Lauf gilt als fertig, sobald Treffer da sind: dann verschwindet
        // der Spinner von selbst, ohne dass die Seite den Job-Status kennt.
        setLaufend((prev) => {
          const neu = new Set(prev)
          for (const p of daten.projekte) if (p.treffer > 0) neu.delete(p.id)
          return neu
        })
      })
      .catch(() => setProjekte([]))
  }, [])

  useEffect(() => {
    laden()
  }, [laden])

  // Solange ein Lauf offen ist, in Ruhe nachfragen (der Lauf dauert Minuten).
  useEffect(() => {
    if (laufend.size === 0) return
    const timer = setInterval(laden, POLL_MS)
    return () => clearInterval(timer)
  }, [laufend, laden])

  async function anlegen() {
    setLegtAn(true)
    try {
      const res = await fetch('/api/portal/projekte', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, beschreibung }),
      })
      const json = (await res.json()) as { id?: number; error?: string }
      if (!res.ok || json.error) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        return
      }
      toast.success(PORTAL_TEXTE['projekte.angelegt'])
      setName('')
      setBeschreibung('')
      laden()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setLegtAn(false)
    }
  }

  async function messen(p: ProjektZeile) {
    setLaufend((prev) => new Set(prev).add(p.id))
    try {
      const res = await fetch('/api/portal/projekt-messen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projekt_id: p.id }),
      })
      const json = (await res.json()) as { status?: string; note?: string; error?: string }
      if (!res.ok || json.error) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        setLaufend((prev) => {
          const neu = new Set(prev)
          neu.delete(p.id)
          return neu
        })
        return
      }
      if (json.status === 'inactive' || json.status === 'error') {
        toast.error(json.note ?? 'Der Mess-Dienst ist gerade nicht erreichbar.')
        setLaufend((prev) => {
          const neu = new Set(prev)
          neu.delete(p.id)
          return neu
        })
        return
      }
      toast.success(PORTAL_TEXTE['projekte.messung_gestartet'])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  async function archivieren(p: ProjektZeile) {
    try {
      const res = await fetch(`/api/portal/projekte?id=${p.id}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error(`Fehlgeschlagen (${res.status})`)
        return
      }
      toast.success(PORTAL_TEXTE['projekte.entfernt'])
      if (offenesProjekt === p.id) setOffenesProjekt(null)
      laden()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  function toggleTreffer(p: ProjektZeile) {
    if (offenesProjekt === p.id) {
      setOffenesProjekt(null)
      return
    }
    setOffenesProjekt(p.id)
    setTreffer([])
    setTrefferLaedt(true)
    fetch(`/api/portal/projekt-treffer?projekt_id=${p.id}&cb=${Date.now()}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`projekt-treffer: Status ${res.status}`)
        const daten = (await res.json()) as { treffer: PortalTreffer[] }
        setTreffer(daten.treffer)
      })
      .catch(() => toast.error(PORTAL_TEXTE['fehler.daten_nicht_verfuegbar']))
      .finally(() => setTrefferLaedt(false))
  }

  function schliesseConsentDialog() {
    setConsentTreffer(null)
    setConsentText('')
    setAktionLaeuft(false)
  }

  async function handleAnschreiben(t: PortalTreffer, consentBestaetigt = false) {
    if (offenesProjekt === null) return
    setAktionLaeuft(true)
    setBestaetigenLaeuft(true)
    try {
      const res = await fetch('/api/portal/anschreiben', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stiftung_id: t.stiftungId,
          projekt_id: offenesProjekt,
          ...(consentBestaetigt ? { consent_bestaetigt: true } : {}),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        consent_noetig?: boolean
        consent_kurz?: boolean
        text?: string
        bereits_vorhanden?: boolean
      }
      if (res.status === 409 && (json.consent_noetig || json.consent_kurz)) {
        setConsentTreffer(t)
        setConsentVoll(!!json.consent_noetig)
        setConsentText(json.text ?? '')
        return
      }
      if (res.status === 409 && json.bereits_vorhanden) {
        toast.error(PORTAL_TEXTE['projekte.gesuch_bereits_vorhanden'])
        setAktionLaeuft(false)
        return
      }
      if (!res.ok) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        setAktionLaeuft(false)
        return
      }
      toast.success(PORTAL_TEXTE['projekte.gesuch_angefordert'])
      schliesseConsentDialog()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      setAktionLaeuft(false)
    } finally {
      setBestaetigenLaeuft(false)
    }
  }

  async function handleRueckmeldung(notiz: string) {
    if (!rueckmeldungTreffer) return
    setRueckmeldungLaeuft(true)
    try {
      const res = await fetch('/api/portal/match-rueckmeldung', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stiftung_id: rueckmeldungTreffer.stiftungId,
          stiftung_name: rueckmeldungTreffer.name,
          notiz,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(json.error ?? `Fehlgeschlagen (${res.status})`)
        return
      }
      toast.success(PORTAL_TEXTE['treffer.rueckmeldung_gesendet'])
      setRueckmeldungTreffer(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setRueckmeldungLaeuft(false)
    }
  }

  const kannAnlegen = name.trim().length >= PROJEKT_NAME_MIN && beschreibung.trim().length >= PROJEKT_BESCHREIBUNG_MIN

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Projekte</h1>
      </div>

      <SchrittInfo titel={PORTAL_TEXTE['projekte.info_titel']}>
        <p>{PORTAL_TEXTE['projekte.info_text']}</p>
        <p>{PORTAL_TEXTE['projekte.info_wozu']}</p>
      </SchrittInfo>

      {/* Anlegen */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">{PORTAL_TEXTE['projekte.neu_titel']}</h2>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">{PORTAL_TEXTE['projekte.name_label']}</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Klimaserie 2026" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">{PORTAL_TEXTE['projekte.beschreibung_label']}</label>
          <Textarea
            value={beschreibung}
            onChange={(e) => setBeschreibung(e.target.value)}
            className="min-h-[110px]"
            placeholder="Worum geht es, was ist das Ziel, wen erreicht es, was kostet es grob?"
          />
          <p className="mt-1 text-[11px] text-slate-400">
            {beschreibung.trim().length} Zeichen (mindestens {PROJEKT_BESCHREIBUNG_MIN})
          </p>
        </div>
        <Button onClick={() => void anlegen()} disabled={legtAn || !kannAnlegen}>
          {legtAn ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          {PORTAL_TEXTE['projekte.anlegen_knopf']}
        </Button>
      </div>

      {/* Liste */}
      <div className="space-y-3">
        {projekte === null && <p className="text-sm text-slate-400">Wird geladen …</p>}
        {projekte !== null && projekte.length === 0 && (
          <p className="text-sm text-slate-400">{PORTAL_TEXTE['projekte.liste_leer']}</p>
        )}

        {(projekte ?? []).map((p) => {
          const zeile: ProjektZeile = { ...p, laeuft: laufend.has(p.id) }
          const zustand = projektZustand(zeile)
          const offen = offenesProjekt === p.id
          return (
            <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">{p.name}</p>
                    <Badge variant="outline" className={`text-[10px] ${ZUSTAND_FARBE[zustand]}`}>
                      {zustand === 'wird_gemessen' && <Loader2 className="mr-1 inline h-2.5 w-2.5 animate-spin" />}
                      {PROJEKT_ZUSTAND_LABEL[zustand]}
                    </Badge>
                    {p.treffer > 0 && <span className="text-xs text-slate-400">{p.treffer} Treffer</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-500">{p.beschreibung}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 text-slate-400 hover:text-red-600"
                  onClick={() => void archivieren(p)}
                  title={PORTAL_TEXTE['projekte.entfernen_knopf']}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => void messen(zeile)} disabled={zeile.laeuft}>
                  {zeile.laeuft ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                  {p.hatDna ? PORTAL_TEXTE['projekte.neu_messen_knopf'] : PORTAL_TEXTE['projekte.messen_knopf']}
                </Button>
                {p.treffer > 0 && (
                  <Button size="sm" variant="outline" onClick={() => toggleTreffer(p)}>
                    <ChevronDown className={`mr-1.5 h-4 w-4 transition-transform ${offen ? 'rotate-180' : ''}`} />
                    {offen ? PORTAL_TEXTE['projekte.treffer_zu'] : PORTAL_TEXTE['projekte.treffer_auf']}
                  </Button>
                )}
              </div>

              {zeile.laeuft && <p className="text-xs text-indigo-700">{PORTAL_TEXTE['projekte.laeuft_hinweis']}</p>}

              {offen && (
                <div className="space-y-3 border-t border-slate-100 pt-3">
                  {trefferLaedt && <p className="text-sm text-slate-400">Wird geladen …</p>}
                  {!trefferLaedt && treffer.length === 0 && (
                    <p className="text-sm text-slate-400">{PORTAL_TEXTE['projekte.treffer_leer']}</p>
                  )}
                  {treffer.map((t) => (
                    <TrefferKarte
                      key={t.stiftungId}
                      treffer={t}
                      disabled={aktionLaeuft}
                      onAnschreiben={(gewaehlt) => void handleAnschreiben(gewaehlt)}
                      // «Nicht relevant» blendet einen MEDIUM-Treffer aus; für
                      // Projekt-Treffer ist die Rückmeldung der richtige Weg,
                      // weil sie das Matching verbessert statt nur zu verbergen.
                      onNichtRelevant={setRueckmeldungTreffer}
                      onRueckmeldung={setRueckmeldungTreffer}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <ConsentDialog
        open={!!consentTreffer}
        onOpenChange={(open) => !open && schliesseConsentDialog()}
        voll={consentVoll}
        text={consentText}
        bestaetigenLaeuft={bestaetigenLaeuft}
        onBestaetigen={() => {
          if (consentTreffer) void handleAnschreiben(consentTreffer, true)
        }}
      />

      <RueckmeldungDialog
        offen={!!rueckmeldungTreffer}
        stiftungName={rueckmeldungTreffer?.name ?? ''}
        hinweis={PORTAL_TEXTE['treffer.rueckmeldung_hinweis']}
        beschaeftigt={rueckmeldungLaeuft}
        onAbbrechen={() => setRueckmeldungTreffer(null)}
        onBestaetigen={(notiz) => void handleRueckmeldung(notiz)}
      />
    </div>
  )
}
