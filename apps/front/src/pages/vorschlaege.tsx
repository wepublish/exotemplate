import { useEffect } from 'react'
import { useRouter } from 'next/router'

// Die Vorschläge sind in die Assistent-Seite (/agent) integriert.
// Diese Route bleibt als Weiterleitung erhalten (alte Links/Bookmarks).
export default function VorschlaegeRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/agent')
  }, [router])
  return <p className="p-8 text-sm text-slate-400">Weiterleitung zum Assistenten …</p>
}
