import { useState } from 'react'
import { CheckCircle2, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { MatchView } from '@/data/types'

const KONF_LABEL: Record<string, string> = {
  web: 'Web-Crawl (belastbar)',
  stammdaten: 'nur Stammdaten — vorsichtig',
  unbekannt: 'Datenbasis unbekannt',
}

function renderBar(val: number | null | undefined) {
  if (val === null || val === undefined) return <span className="text-slate-400 ml-2">n/a</span>
  const blocks = Math.round(val / 10)
  return (
    <span className="font-mono ml-2 tracking-tighter">
      <span className="text-indigo-600">{'█'.repeat(blocks)}</span>
      <span className="text-slate-200">{'░'.repeat(10 - blocks)}</span>
    </span>
  )
}

export function MatchRationale({ row }: { row: MatchView }) {
  const [expandedSnippets, setExpandedSnippets] = useState(false)

  const isVerified = row.konfidenz === 'web'
  const breakdown = row.breakdown ?? {}
  const topTags = row.tags ?? []

  const tagScore: number | undefined = breakdown?.components?.tag ?? breakdown?.tag_score
  const embScore: number | undefined = breakdown?.components?.embedding ?? breakdown?.embedding_score
  const llmScore: number | undefined = breakdown?.components?.llm ?? breakdown?.llm_score

  const snippets: { title: string; snippet: string; url: string }[] =
    breakdown?.stiftungs_web_snippets ?? []

  const fp = breakdown?.stiftungs_foerderpraxis ?? {}

  return (
    <div className="rounded-xl border border-violet-100 bg-white overflow-hidden shadow-sm">
      {/* Verifikations-Banner */}
      {isVerified ? (
        <div className="bg-emerald-50 px-4 py-2 border-b border-emerald-100 flex items-center gap-2 text-emerald-700 text-xs font-medium">
          <CheckCircle2 className="w-4 h-4" />
          {KONF_LABEL.web} · Schärfe {row.schaerfe}
        </div>
      ) : (
        <div className="bg-amber-50 px-4 py-2 border-b border-amber-100 flex items-center gap-2 text-amber-700 text-xs font-medium">
          <AlertTriangle className="w-4 h-4" />
          {KONF_LABEL[row.konfidenz] ?? KONF_LABEL.unbekannt} · Schärfe {row.schaerfe}
        </div>
      )}

      {/* Score-Breakdown */}
      <div className="p-4 bg-slate-50 border-b border-slate-200">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-bold text-slate-800 text-sm">Score-Breakdown</h3>
          <span className="font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded text-sm">
            SCORE {row.score}
          </span>
        </div>
        <div className="space-y-1.5 text-xs text-slate-700">
          {tagScore !== undefined && (
            <div className="flex items-center">
              <span className="w-32 font-medium">Tag-Resonanz</span>
              <span className="w-8 text-right">{tagScore}%</span>
              {renderBar(tagScore)}
            </div>
          )}
          {embScore !== undefined && (
            <div className="flex items-center">
              <span className="w-32 font-medium">Embedding-Resonanz</span>
              <span className="w-8 text-right">{embScore}%</span>
              {renderBar(embScore)}
            </div>
          )}
          {llmScore !== undefined && (
            <div className="flex items-center">
              <span className="w-32 font-medium">LLM-Resonanz</span>
              <span className="w-8 text-right">{llmScore}%</span>
              {renderBar(llmScore)}
            </div>
          )}
        </div>
      </div>

      {/* Sound-Feeling + Top-Tags */}
      <div className="p-4 border-b border-slate-100">
        {row.soundFeeling && (
          <p className="text-sm text-slate-800 leading-relaxed mb-4 italic">
            «{row.soundFeeling}»
          </p>
        )}
        {topTags.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Top-Tags (Resonanz)
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {topTags.slice(0, 12).map(t => (
                <Badge
                  key={t.tag_slug}
                  variant="outline"
                  className={[
                    'text-[10px] cursor-default',
                    t.gewicht === 3
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                      : 'text-slate-600',
                  ].join(' ')}
                  title={t.begruendung}
                >
                  {t.tag_slug} ({t.gewicht})
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Förderpraxis */}
      {(fp.durchschnitt || fp.min_betrag || fp.max_betrag || fp.geo_scope || fp.einreichmodalitaet) && (
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Förderpraxis
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-4 text-xs">
            <div className="flex">
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
              <div className="flex">
                <span className="w-24 text-slate-500">Geo-Scope:</span>
                <span className="font-medium text-slate-800">{fp.geo_scope.join(', ')}</span>
              </div>
            )}
            {fp.einreichmodalitaet && (
              <div className="flex col-span-1 md:col-span-2">
                <span className="w-24 text-slate-500">Einreichungen:</span>
                <span className="font-medium text-slate-800">{fp.einreichmodalitaet}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Web-Snippets */}
      {snippets.length > 0 && (
        <div className="p-4">
          <button
            onClick={() => setExpandedSnippets(e => !e)}
            className="flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            {expandedSnippets ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
            Was wird über die Stiftung berichtet ({snippets.length} Web-Treffer)
          </button>
          {expandedSnippets && (
            <div className="mt-3 space-y-3 pl-2 border-l-2 border-indigo-100">
              {snippets.map((snip, idx) => (
                <div key={idx} className="text-xs">
                  <p className="font-semibold text-slate-800">{snip.title}</p>
                  <p className="text-slate-600 my-1 italic">&ldquo;{snip.snippet}&rdquo;</p>
                  <a
                    href={snip.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-500 hover:underline break-all"
                  >
                    {snip.url}
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Metadata-Footer */}
      <div className="bg-slate-50 px-4 py-2 text-[10px] text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
        {breakdown?.computed_at && (
          <span>Berechnet: {new Date(breakdown.computed_at).toLocaleString('de-CH')}</span>
        )}
        {breakdown?.llm_provider && (
          <span className="font-semibold text-indigo-500">
            LLM: {breakdown.llm_provider} ({breakdown.llm_model})
          </span>
        )}
      </div>
    </div>
  )
}
