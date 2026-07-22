import Link from 'next/link'
import FreigabeZentrale from '@/components/FreigabeZentrale'

export default function FreigabePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/agent" className="text-sm text-slate-500 hover:text-slate-700">
        ← zurück zum Cockpit
      </Link>
      <h1 className="text-xl font-bold text-slate-900">Entwürfe freigeben und senden</h1>
      <p className="text-sm text-slate-500">
        Jeden Entwurf ansehen, bei Bedarf bearbeiten, dann senden. Erst dein Klick versendet.
      </p>
      <FreigabeZentrale />
    </div>
  )
}
