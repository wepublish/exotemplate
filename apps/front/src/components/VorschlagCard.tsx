import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MediumLogo } from '@/components/MediumLogo'
import { GesuchPromptButton } from '@/components/GesuchPromptButton'
import { typMeta, fristAmpel } from '@/lib/vorschlaege'
import type { Vorschlag, VorschlagStatus } from '@/graphql/vorschlaege'

const AMPEL_KLASSE: Record<'rot' | 'amber' | 'gelb', string> = {
  rot: 'text-rose-600',
  amber: 'text-amber-600',
  gelb: 'text-yellow-600',
}
const PRIO_KLASSE: Record<'hoch' | 'mittel' | 'tief', string> = {
  hoch: 'bg-rose-500',
  mittel: 'bg-amber-400',
  tief: 'bg-slate-300',
}

export function VorschlagCard({
  vorschlag,
  onEntscheiden,
  onAnpassen,
}: {
  vorschlag: Vorschlag
  onEntscheiden: (v: Vorschlag, status: VorschlagStatus) => void
  onAnpassen: (v: Vorschlag) => void
}) {
  const meta = typMeta(vorschlag.typ)
  const ampel = fristAmpel(vorschlag.frist)
  return (
    <Card className={`relative overflow-hidden border-l-4 ${meta.akzent} p-4`}>
      <span
        className={`absolute left-0 top-0 h-full w-1 ${PRIO_KLASSE[vorschlag.prioritaet]}`}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium">{meta.label}</span>
            <MediumLogo slug={vorschlag.medium_id} name={vorschlag.medium_id} size={16} />
            <span>{vorschlag.medium_id}</span>
            {ampel && (
              <span className={`font-medium ${AMPEL_KLASSE[ampel.variant]}`}>
                Frist in {ampel.tage} Tagen
              </span>
            )}
          </div>
          <h3 className="mt-1 truncate font-semibold text-slate-900">{vorschlag.titel}</h3>
          {vorschlag.stiftung_name && (
            <p className="text-sm text-slate-700">{vorschlag.stiftung_name}</p>
          )}
          <p className="mt-1 text-sm text-slate-600">{vorschlag.beschreibung}</p>
          {vorschlag.begruendung && (
            <p className="mt-1 text-xs italic text-slate-500">{vorschlag.begruendung}</p>
          )}
          {vorschlag.artefakt_link && (
            <a
              href={vorschlag.artefakt_link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs text-sky-700 underline"
            >
              Vorbereitetes Artefakt öffnen
            </a>
          )}
          {vorschlag.typ === 'match' && vorschlag.stiftung_id && (
            <div className="mt-2">
              <GesuchPromptButton
                medium={vorschlag.medium_id}
                stiftungId={vorschlag.stiftung_id}
                stiftungName={vorschlag.stiftung_name}
              />
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <Button size="sm" onClick={() => onEntscheiden(vorschlag, 'freigegeben')}>
            Freigeben
          </Button>
          <Button size="sm" variant="outline" onClick={() => onAnpassen(vorschlag)}>
            Anpassen
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-slate-500"
            onClick={() => onEntscheiden(vorschlag, 'verneint')}
          >
            Verneinen
          </Button>
        </div>
      </div>
    </Card>
  )
}
