import { useEffect, useState } from 'react'
import { MediumLogo } from './MediumLogo'
import type { MatchView, BetragsVorschlag } from '@/data/types'

// ─── Hilfen ─────────────────────────────────────────────────────────────────

const KONF_LABEL: Record<string, string> = {
  web: 'Web-Crawl (belastbar)',
  stammdaten: 'nur Stammdaten — vorsichtig',
  unbekannt: 'Datenbasis unbekannt',
}

function Balken({ val }: { val: number | null | undefined }) {
  if (val === null || val === undefined) return <span className="text-slate-400">n/a</span>
  return (
    <span className="inline-flex items-center gap-2 align-middle">
      <span className="inline-block h-2 w-28 rounded-full bg-slate-200 overflow-hidden align-middle">
        <span
          className="block h-full bg-indigo-500"
          style={{ width: `${Math.max(0, Math.min(100, val))}%` }}
        />
      </span>
      <span className="tabular-nums text-slate-700">{val}%</span>
    </span>
  )
}

// ─── Ein Stiftungs-Block ──────────────────────────────────────────────────────

function StiftungsBlock({
  row,
  rank,
  betrag,
}: {
  row: MatchView
  rank: number
  betrag?: BetragsVorschlag | null
}) {
  const breakdown = row.breakdown ?? {}
  const tagScore: number | undefined = breakdown?.components?.tag ?? breakdown?.tag_score
  const embScore: number | undefined = breakdown?.components?.embedding ?? breakdown?.embedding_score
  const llmScore: number | undefined = breakdown?.components?.llm ?? breakdown?.llm_score
  const snippets: { title: string; snippet: string; url: string }[] =
    breakdown?.stiftungs_web_snippets ?? []
  const fp = breakdown?.stiftungs_foerderpraxis ?? {}
  const topTags = [...(row.tags ?? [])].sort((a, b) => b.gewicht - a.gewicht)
  const hauptgrund = row.begruendung || topTags[0]?.begruendung

  return (
    <section className="pdf-block mb-6 break-inside-avoid rounded-lg border border-slate-300">
      {/* Kopfzeile */}
      <div className="flex items-baseline justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-sm font-bold text-slate-400">#{rank}</span>
          <span className="text-base font-bold text-slate-900">{row.name}</span>
        </div>
        <div className="flex items-baseline gap-3 whitespace-nowrap text-xs">
          <span className="font-bold text-indigo-700">Score {row.score}%</span>
          <span className="text-slate-500">
            {KONF_LABEL[row.konfidenz] ?? KONF_LABEL.unbekannt} · Schärfe {row.schaerfe}
          </span>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3 text-xs text-slate-700">
        {row.website && <p className="text-slate-400 break-all">{row.website}</p>}

        {/* Empfohlener Betrag */}
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2">
          {betrag ? (
            <>
              <p className="text-sm font-semibold text-emerald-800">
                {betrag.suggested_amount > 0
                  ? `Empfohlener Antragsbetrag: CHF ${betrag.suggested_amount.toLocaleString('de-CH')}`
                  : 'Kein konkreter Betrag empfehlbar'}
              </p>
              {betrag.reasoning && (
                <p className="mt-1 leading-relaxed text-slate-600">{betrag.reasoning}</p>
              )}
            </>
          ) : (
            <p className="text-slate-400 italic">Betrag noch nicht berechnet</p>
          )}
        </div>

        {/* Hauptbegründung */}
        {hauptgrund && (
          <p className="leading-relaxed text-slate-800">{hauptgrund}</p>
        )}

        {/* Score-Breakdown */}
        {(tagScore !== undefined || embScore !== undefined || llmScore !== undefined) && (
          <div>
            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Score-Breakdown
            </h4>
            <div className="space-y-1">
              {tagScore !== undefined && (
                <div className="flex items-center gap-3">
                  <span className="w-40 text-slate-600">Tag-Resonanz</span>
                  <Balken val={tagScore} />
                </div>
              )}
              {embScore !== undefined && (
                <div className="flex items-center gap-3">
                  <span className="w-40 text-slate-600">Embedding-Resonanz</span>
                  <Balken val={embScore} />
                </div>
              )}
              {llmScore !== undefined && (
                <div className="flex items-center gap-3">
                  <span className="w-40 text-slate-600">LLM-Resonanz</span>
                  <Balken val={llmScore} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sound-Feeling */}
        {row.soundFeeling && (
          <p className="italic leading-relaxed text-slate-800">«{row.soundFeeling}»</p>
        )}

        {/* Top-Tags */}
        {topTags.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Top-Tags (Resonanz)
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {topTags.slice(0, 14).map(t => (
                <span
                  key={t.tag_slug}
                  className={[
                    'rounded border px-1.5 py-0.5 text-[10px]',
                    t.gewicht === 3
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 text-slate-600',
                  ].join(' ')}
                >
                  {t.tag_slug} ({t.gewicht})
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Förderpraxis */}
        {(fp.durchschnitt || fp.min_betrag || fp.max_betrag || fp.geo_scope?.length || fp.einreichmodalitaet) && (
          <div>
            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Förderpraxis
            </h4>
            <div className="grid grid-cols-1 gap-y-1 sm:grid-cols-2">
              <div className="flex gap-2">
                <span className="w-24 text-slate-500">Fördersumme:</span>
                <span className="font-medium text-slate-800">
                  {fp.durchschnitt
                    ? `Ø CHF ${fp.durchschnitt.toLocaleString('de-CH')}`
                    : fp.min_betrag || fp.max_betrag
                      ? `${fp.min_betrag ?? 0} – ${fp.max_betrag ?? '?'} CHF`
                      : 'unbekannt'}
                </span>
              </div>
              {fp.geo_scope?.length > 0 && (
                <div className="flex gap-2">
                  <span className="w-24 text-slate-500">Geo-Scope:</span>
                  <span className="font-medium text-slate-800">{fp.geo_scope.join(', ')}</span>
                </div>
              )}
              {fp.einreichmodalitaet && (
                <div className="flex gap-2 sm:col-span-2">
                  <span className="w-24 text-slate-500">Einreichungen:</span>
                  <span className="font-medium text-slate-800">{fp.einreichmodalitaet}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Web-Belege */}
        {snippets.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Was über die Stiftung berichtet wird ({snippets.length} Web-Treffer)
            </h4>
            <div className="space-y-2 border-l-2 border-indigo-100 pl-3">
              {snippets.map((snip, idx) => (
                <div key={idx}>
                  <p className="font-semibold text-slate-800">{snip.title}</p>
                  <p className="my-0.5 italic text-slate-600">«{snip.snippet}»</p>
                  <p className="break-all text-indigo-500">{snip.url}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Dokument ──────────────────────────────────────────────────────────────────

interface PdfDokumentProps {
  mediumSlug: string
  mediumName: string
  rows: MatchView[]
  betraege: Record<string, BetragsVorschlag>
}

/**
 * Druck-Dokument der Förderstiftungen-Liste (Entscheidgrundlage fürs Medium).
 * Auf dem Bildschirm ausgeblendet (`hidden`), nur im Druck sichtbar (`print:block`).
 * Kopf mit wepublish-Logo (Betreiber) + Medien-Logo; pro Stiftung die vollen
 * Infos inkl. bereits berechnetem Betrag.
 */
export function PdfDokument({ mediumSlug, mediumName, rows, betraege }: PdfDokumentProps) {
  // Datum erst nach Mount setzen → keine SSR-Hydration-Diskrepanz.
  const [datum, setDatum] = useState('')
  useEffect(() => {
    setDatum(new Date().toLocaleDateString('de-CH', { day: '2-digit', month: 'long', year: 'numeric' }))
  }, [])

  return (
    <div className="print-document hidden text-slate-900 print:block">
      {/* Kopf mit beiden Logos */}
      <header className="mb-5 flex items-center justify-between gap-4 border-b-2 border-slate-800 pb-4">
        <div className="flex flex-col gap-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="We.Publish" className="h-7 w-auto object-contain" />
          <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-indigo-600">
            Fundraising as a Service
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Medium</p>
            <p className="text-base font-bold text-slate-900">{mediumName}</p>
          </div>
          <MediumLogo slug={mediumSlug} name={mediumName} size={44} />
        </div>
      </header>

      {/* Titel */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-900">Förderstiftungen — Entscheidgrundlage</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Top {rows.length} Matchings für {mediumName}
          {datum && <> · Stand {datum}</>}
        </p>
      </div>

      {/* Stiftungen */}
      {rows.map((r, i) => (
        <StiftungsBlock key={r.id} row={r} rank={i + 1} betrag={betraege[r.stiftungId]} />
      ))}

      {/* Fuss */}
      <footer className="mt-6 border-t border-slate-200 pt-3 text-[10px] leading-relaxed text-slate-400">
        Erstellt mit Fundraising as a Service, betrieben von der We.Publish Foundation. Die
        Betragsvorschläge sind LLM-gestützte Schätzungen auf Basis der Förderpraxis und dienen als
        Orientierung, nicht als verbindliche Zusage.
      </footer>
    </div>
  )
}
