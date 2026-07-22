import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation } from '@apollo/client/react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { MEDIEN_LIST } from '@/graphql/medien'
import { SONDER_MATCHES, SONDER_APPLICATIONS } from '@/graphql/sonder'
import {
  zielLabel, zielBadgeClass, scoreFarbe, normTags, normBetrag, SONDER_GRUPPEN,
  sonderRefVonMatch, bauSonderApplicationDaten,
  type SonderMatch, type SonderApplicationSnap,
} from '@/graphql/sonder.helpers'
import {
  CREATE_APPLICATION, UPDATE_APPLICATION, STATUS_STATION,
} from '@/graphql/applications.mutations'
import { CREATE_LESSON } from '@/graphql/vorschlaege.mutations'
import {
  STATUS_FARBEN, STATUS_LABEL,
  BetragsRecherchePanel, BetragBadge, BetragBegruendung,
} from '@/components/MatchRow'
import { AusblendenDialog } from '@/components/AusblendenDialog'
import { GesuchPromptButton } from '@/components/GesuchPromptButton'
import { bauAusblendeNotiz, bauAusblendeLesson, type AusblendeGrund } from '@/lib/ausblenden'
import type { BetragsVorschlag } from '@/data/types'

interface MediumOpt {
  medium_id: string
  medium_name: string | null
}

export default function KirchenFoerdererPage() {
  const { data: medienData } = useQuery(MEDIEN_LIST)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const medien = (((medienData as any)?.medium_dna ?? []) as MediumOpt[])
    .filter(m => m.medium_id)

  const [medium, setMedium] = useState<string>('')
  // Default: neue_wege (Hauptfall), sonst erstes Medium.
  const selected =
    medium ||
    medien.find(m => m.medium_id === 'neue_wege')?.medium_id ||
    medien[0]?.medium_id ||
    ''

  const { data, loading } = useQuery(SONDER_MATCHES, {
    variables: { medium: selected },
    skip: !selected,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const treffer = ((data as any)?.sonder_match_results ?? []) as SonderMatch[]

  // Anträge aus dem Sonder-Matching (sonder_ref → Snapshot) für Funnel-Status
  const { data: appsData, refetch: refetchApps } = useQuery(SONDER_APPLICATIONS, {
    variables: { medium: selected },
    skip: !selected,
    fetchPolicy: 'cache-and-network',
  })
  const appByRef = useMemo<Map<string, SonderApplicationSnap>>(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: SonderApplicationSnap[] = ((appsData as any)?.applications ?? [])
    const map = new Map<string, SonderApplicationSnap>()
    for (const a of list) {
      // Liste ist -date_updated sortiert → der erste (jüngste) pro ref gewinnt
      if (a.sonder_ref && !map.has(a.sonder_ref)) map.set(a.sonder_ref, a)
    }
    return map
  }, [appsData])

  const [zeigeAusgeblendete, setZeigeAusgeblendete] = useState(false)
  const istAusgeblendet = (t: SonderMatch) => {
    const ref = sonderRefVonMatch(t)
    return ref ? appByRef.get(ref)?.status === 'ausgeblendet' : false
  }
  const ausgeblendeteAnzahl = treffer.filter(istAusgeblendet).length
  const sichtbare = zeigeAusgeblendete ? treffer : treffer.filter(t => !istAusgeblendet(t))

  // Frisch berechnete Beträge (Seiten-State, Key = sonder_ref); persistierte
  // kommen über SONDER_MATCHES.betrag_recherche — frisch gewinnt.
  const [betraege, setBetraege] = useState<Record<string, BetragsVorschlag>>({})
  const merkeBetrag = (ref: string, v: BetragsVorschlag) =>
    setBetraege(prev => ({ ...prev, [ref]: v }))

  return (
    <div className="max-w-4xl">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-xl font-semibold text-slate-800">Kirchen &amp; Förderer</h1>
        <Badge variant="outline" className="text-xs">Sonder-Matching</Badge>
      </div>
      <p className="mb-5 text-sm text-slate-500">
        Treffer aus den Sonderfall-Pools (Kirchen, öffentliche/private Förderer,
        Lotteriefonds, Sponsoren), getrennt vom Stiftungs-Matching. Math-basiert auf
        der Themen-DNA des Mediums.
      </p>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="w-full max-w-sm">
          <Select value={selected} onValueChange={setMedium}>
            <SelectTrigger>
              <SelectValue placeholder="Medium auswählen…" />
            </SelectTrigger>
            <SelectContent>
              {medien.map(m => (
                <SelectItem key={m.medium_id} value={m.medium_id}>
                  {m.medium_name || m.medium_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {ausgeblendeteAnzahl > 0 && (
          <button
            type="button"
            onClick={() => setZeigeAusgeblendete(v => !v)}
            className="text-xs text-slate-500 underline-offset-2 hover:underline"
          >
            {zeigeAusgeblendete
              ? 'Ausgeblendete verbergen'
              : `Ausgeblendete anzeigen (${ausgeblendeteAnzahl})`}
          </button>
        )}
      </div>

      {loading && <p className="text-sm text-slate-400">Lädt…</p>}
      {!loading && sichtbare.length === 0 && (
        <p className="text-sm text-slate-400">
          Keine Sonder-Treffer für dieses Medium.
        </p>
      )}

      {!loading && sichtbare.length > 0 && (
        <div className="space-y-6">
          {SONDER_GRUPPEN.map(g => {
            const items = sichtbare.filter(t => t.ziel_collection === g.coll)
            return (
              <Gruppe
                key={g.coll}
                titel={`${g.titel} (${items.length})`}
                treffer={items}
                medium={selected}
                appByRef={appByRef}
                betraege={betraege}
                onBetrag={merkeBetrag}
                onChanged={() => refetchApps()}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function Gruppe({
  titel, treffer, medium, appByRef, betraege, onBetrag, onChanged,
}: {
  titel: string
  treffer: SonderMatch[]
  medium: string
  appByRef: Map<string, SonderApplicationSnap>
  betraege: Record<string, BetragsVorschlag>
  onBetrag: (ref: string, v: BetragsVorschlag) => void
  onChanged: () => void
}) {
  if (treffer.length === 0) return null
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{titel}</h2>
      <div className="space-y-2">
        {treffer.map(t => {
          const ref = sonderRefVonMatch(t)
          return (
            <Zeile
              key={t.id}
              t={t}
              medium={medium}
              app={ref ? appByRef.get(ref) : undefined}
              betrag={ref ? betraege[ref] ?? normBetrag(t.betrag_recherche) : null}
              onBetrag={v => ref && onBetrag(ref, v)}
              onChanged={onChanged}
            />
          )
        })}
      </div>
    </section>
  )
}

function Zeile({
  t, medium, app, betrag, onBetrag, onChanged,
}: {
  t: SonderMatch
  medium: string
  app: SonderApplicationSnap | undefined
  betrag: BetragsVorschlag | null
  onBetrag: (v: BetragsVorschlag) => void
  onChanged: () => void
}) {
  const tags = normTags(t.top_tags)
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start gap-3">
        <span className={`shrink-0 rounded-md px-2 py-1 text-sm font-semibold tabular-nums ${scoreFarbe(t.score)}`}>
          {t.score ?? 0}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800">{t.ziel_name || '—'}</span>
            <Badge variant="outline" className={`text-[11px] ${zielBadgeClass(t.ziel_collection)}`}>
              {zielLabel(t.ziel_collection)}
            </Badge>
            {betrag && <BetragBadge betrag={betrag} />}
            {typeof t.schaerfe_ziel === 'number' && (
              <span className="text-xs text-slate-400">Schärfe {t.schaerfe_ziel}</span>
            )}
          </div>
          {tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {tags.map(tag => (
                <span key={tag} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                  {tag}
                </span>
              ))}
            </div>
          )}
          {t.begruendung && (
            <p className="mt-1.5 text-xs text-slate-500">{t.begruendung}</p>
          )}
          {betrag && (
            <div className="mt-2">
              <BetragBegruendung betrag={betrag} />
            </div>
          )}
          <SonderAktionen
            t={t}
            medium={medium}
            app={app}
            betrag={betrag}
            onBetrag={onBetrag}
            onChanged={onChanged}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Aktions-Bereich (analog AktionsBereich in MatchRow, über sonder_ref) ─────

function SonderAktionen({
  t, medium, app, betrag, onBetrag, onChanged,
}: {
  t: SonderMatch
  medium: string
  app: SonderApplicationSnap | undefined
  betrag: BetragsVorschlag | null
  onBetrag: (v: BetragsVorschlag) => void
  onChanged: () => void
}) {
  const [createApp, { loading: createLoading }] = useMutation(CREATE_APPLICATION)
  const [updateApp, { loading: updateLoading }] = useMutation(UPDATE_APPLICATION)
  const [createLesson] = useMutation(CREATE_LESSON)
  const [dialogOffen, setDialogOffen] = useState(false)

  const beschaeftigt = createLoading || updateLoading
  const ref = sonderRefVonMatch(t)
  const name = t.ziel_name || zielLabel(t.ziel_collection)
  const gesuchKnopf = t.ziel_id != null && t.ziel_collection ? (
    <GesuchPromptButton
      medium={medium}
      stiftungId={t.ziel_id}
      stiftungName={name}
      ziel={t.ziel_collection}
    />
  ) : null
  const betragPanel = t.ziel_id != null && t.ziel_collection ? (
    <BetragsRecherchePanel
      stiftungId={String(t.ziel_id)}
      medium={medium}
      ziel={t.ziel_collection}
      betrag={betrag}
      onComputed={onBetrag}
    />
  ) : null

  async function uebernehmen() {
    try {
      await createApp({ variables: { data: bauSonderApplicationDaten(t, medium) } })
      toast.success(`«${name}» in Anträge übernommen`)
      onChanged()
    } catch (err: unknown) {
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function ausblenden(grund: AusblendeGrund, freitext: string) {
    const bemerkung = bauAusblendeNotiz(name, grund.label, freitext)
    try {
      if (app && app.status !== 'ausgeblendet') {
        // Bestehenden Antrag ausblenden — UPDATE, Prozesshistorie bleibt erhalten.
        await updateApp({
          variables: {
            id: app.id,
            data: {
              status: 'ausgeblendet',
              station: STATUS_STATION['ausgeblendet'],
              bemerkung,
              zuletzt_geaendert_quelle: 'sonder-matching',
            },
          },
        })
      } else {
        // Marker-Antrag anlegen (Sonder-Anträge haben keine Outbox-Entwürfe —
        // der Paket-Builder arbeitet nur über match_results/stiftungen).
        await createApp({
          variables: { data: bauSonderApplicationDaten(t, medium, 'ausgeblendet', bemerkung) },
        })
      }
      // Lern-Loop: stiftung_id trägt den sonder_ref — der Gesuch-Prompt findet
      // die Lesson über denselben Schlüssel wieder.
      await createLesson({
        variables: {
          data: bauAusblendeLesson({
            mediumId: medium,
            stiftungId: ref ?? '',
            stiftungName: name,
            grundKey: grund.key,
            grundLabel: grund.label,
            freitext,
          }),
        },
      })
      toast.success(`«${name}» ausgeblendet`)
      setDialogOffen(false)
      onChanged()
    } catch (err: unknown) {
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function wiederEinblenden() {
    if (!app || app.status !== 'ausgeblendet') return
    try {
      await updateApp({
        variables: {
          id: app.id,
          data: {
            status: 'identifiziert',
            station: STATUS_STATION['identifiziert'],
            zuletzt_geaendert_quelle: 'sonder-matching',
          },
        },
      })
      toast.success(`«${name}» wieder eingeblendet`)
      onChanged()
    } catch (err: unknown) {
      toast.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Bereits im Funnel → Badge + Gesuch-Prompt + Ausblenden/Wieder-einblenden
  if (app) {
    const s = app.status ?? 'identifiziert'
    const farbe = STATUS_FARBEN[s] ?? STATUS_FARBEN.identifiziert
    const label = STATUS_LABEL[s] ?? s
    return (
      <>
        <div className="mt-2 flex flex-col gap-1.5 border-t border-slate-100 pt-2">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className={`text-[11px] ${farbe}`}>
              Im Funnel: {label}
            </Badge>
            {s !== 'ausgeblendet' && (
              <Link href="/applications" className="text-xs text-indigo-600 hover:underline">
                → Anträge
              </Link>
            )}
            {s !== 'ausgeblendet' && gesuchKnopf}
            {(s === 'identifiziert' || s === 'in_arbeit') && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs text-slate-500 border-slate-200 hover:bg-slate-50"
                disabled={beschaeftigt}
                onClick={() => setDialogOffen(true)}
              >
                Ausblenden
              </Button>
            )}
            {s === 'ausgeblendet' && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs text-slate-600 border-slate-200 hover:bg-slate-50"
                disabled={updateLoading}
                onClick={wiederEinblenden}
              >
                Wieder einblenden
              </Button>
            )}
          </div>
          {s === 'ausgeblendet' && app.bemerkung && (
            <p className="text-[11px] leading-relaxed text-slate-400 line-clamp-2">
              {app.bemerkung}
            </p>
          )}
          {s !== 'ausgeblendet' && betragPanel}
        </div>
        <AusblendenDialog
          offen={dialogOffen}
          stiftungName={name}
          beschaeftigt={beschaeftigt}
          onAbbrechen={() => setDialogOffen(false)}
          onBestaetigen={ausblenden}
        />
      </>
    )
  }

  // Noch nicht im Funnel → Übernehmen / Gesuch-Prompt / Ausblenden / Betrag
  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
        <Button
          size="sm"
          variant="default"
          className="h-8 bg-green-600 text-xs text-white hover:bg-green-700"
          disabled={beschaeftigt}
          onClick={uebernehmen}
        >
          In Anträge übernehmen
        </Button>
        {gesuchKnopf}
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs text-slate-600 border-slate-200 hover:bg-slate-50"
          disabled={beschaeftigt}
          onClick={() => setDialogOffen(true)}
        >
          Ausblenden
        </Button>
      </div>
      {betragPanel}
      <AusblendenDialog
        offen={dialogOffen}
        stiftungName={name}
        beschaeftigt={beschaeftigt}
        onAbbrechen={() => setDialogOffen(false)}
        onBestaetigen={ausblenden}
      />
    </>
  )
}
