import { useState } from 'react'
import Link from 'next/link'
import SichtungsStapel from '@/components/SichtungsStapel'
import SichtungsListe from '@/components/SichtungsListe'
import { Button } from '@/components/ui/button'

export default function SichtenPage() {
  const [modus, setModus] = useState<'karte' | 'liste'>('karte')

  return (
    <div className={`mx-auto space-y-4 ${modus === 'liste' ? 'max-w-5xl' : 'max-w-2xl'}`}>
      <Link href="/agent" className="text-sm text-slate-500 hover:text-slate-700">
        ← zurück zum Cockpit
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Förderpakete sichten</h1>
          <p className="text-sm text-slate-500">
            {modus === 'karte'
              ? 'Pro Karte entscheiden: passt (übernehmen), später, oder passt nicht (verwerfen).'
              : 'Mehrere Pakete anhaken und gemeinsam übernehmen oder verwerfen.'}
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={modus === 'karte' ? 'default' : 'outline'}
            className="text-xs"
            onClick={() => setModus('karte')}
          >
            Karten
          </Button>
          <Button
            size="sm"
            variant={modus === 'liste' ? 'default' : 'outline'}
            className="text-xs"
            onClick={() => setModus('liste')}
          >
            Liste
          </Button>
        </div>
      </div>
      {modus === 'karte' ? <SichtungsStapel /> : <SichtungsListe />}
    </div>
  )
}
