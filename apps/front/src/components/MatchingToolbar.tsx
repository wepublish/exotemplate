import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Printer, Sparkles } from 'lucide-react'

type Phase = 'idle' | 'running' | 'done'

export const PRINT_OPTIONS = [5, 10, 25, 50] as const

interface MatchingToolbarProps {
  /** Anzahl Treffer, die «Als PDF» druckt. */
  printN: number
  onPrintN: (n: number) => void
  onPrint: () => void
}

/**
 * Toolbar der Förderstiftungen-Liste.
 *
 * «Matching starten» ist bewusst ein Deko-/Show-Element: das Matching läuft
 * im Hintergrund ohnehin stündlich (Cron auf dem Spark). Der Knopf simuliert
 * eine sichtbare Aktualisierung mit einer kurzen Zauber-Animation — gedacht
 * für Vorführungen vor Medien. Er löst KEINEN echten Lauf aus.
 *
 * «Als PDF» druckt die obersten N Treffer (5/10/25/50, via Auswahl daneben).
 */
export function MatchingToolbar({ printN, onPrintN, onPrint }: MatchingToolbarProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    return () => timers.current.forEach(clearTimeout)
  }, [])

  function runMatching() {
    if (phase === 'running') return
    setPhase('running')
    timers.current.push(
      setTimeout(() => {
        setPhase('done')
        timers.current.push(setTimeout(() => setPhase('idle'), 1800))
      }, 2600)
    )
  }

  return (
    <div className="flex flex-wrap gap-2 mb-4 no-print items-center">
      <Button
        variant="default"
        size="sm"
        onClick={runMatching}
        disabled={phase === 'running'}
        className="bg-indigo-600 hover:bg-indigo-700 text-white transition-transform active:scale-95 disabled:opacity-100"
      >
        <Sparkles
          className={`w-4 h-4 mr-1.5 ${phase === 'running' ? 'animate-spin' : ''}`}
        />
        {phase === 'running'
          ? 'Matching läuft…'
          : phase === 'done'
            ? 'Aktualisiert'
            : 'Matching starten'}
      </Button>

      <div className="flex items-center gap-2 ml-auto md:ml-0">
        <Select
          value={String(printN)}
          onValueChange={v => onPrintN(Number(v))}
        >
          <SelectTrigger className="w-[7.5rem]" aria-label="Anzahl Treffer für PDF">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRINT_OPTIONS.map(n => (
              <SelectItem key={n} value={String(n)}>
                {n} Matchings
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="secondary" size="sm" onClick={onPrint}>
          <Printer className="w-4 h-4 mr-1.5" />
          Als PDF
        </Button>
      </div>
    </div>
  )
}
