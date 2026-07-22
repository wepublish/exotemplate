import '@/styles/globals.css'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { ApolloProvider } from '@apollo/client/react'
import { Toaster } from 'sonner'
import { useRouter } from 'next/router'
import { makeClient } from '@/lib/apollo'
import Layout from '@/components/Layout'
import PortalLayout from '@/components/portal/PortalLayout'
import type { AppProps } from 'next/app'

// We.Publish-Designsystem: Inter als Arbeitsschrift, JetBrains Mono für
// Meta-Ebenen (Eyebrows, Labels, Tokens).
const appFont = Inter({ subsets: ['latin'], variable: '--font-app', display: 'swap' })
const monoFont = JetBrains_Mono({ subsets: ['latin'], variable: '--font-app-mono', display: 'swap' })

const client = makeClient()

/**
 * Rahmen-Wahl pro Route. Die Portal-Seiten (Medien-Sicht, /portal und
 * /portal/*) tragen ihren eigenen, schlankeren Rahmen (PortalLayout), KEINE
 * Operator-Navigation. /portal-steuerung ist dagegen eine Operator-Seite
 * (hinter Cloudflare Access) und bleibt bewusst in der normalen
 * Layout-Sidebar. /portal/login steht aussen vor jedem Rahmen (kein Nav,
 * keine Medium-Kopfzeile, vor dem Login ist beides unbekannt).
 *
 * WICHTIG: PortalLayout wird hier, genau wie Layout, von _app.tsx UM die
 * Seite gelegt, nicht von der Seite selbst importiert. Nur so ist die Seite
 * (z. B. src/pages/portal/index.tsx) ein echter Nachfahre von
 * PortalLayouts PortalMeContext.Provider und kann usePortalMe() sinnvoll
 * lesen. Würde die Seite <PortalLayout> stattdessen selbst rendern, wäre sie
 * die AHNIN dieses Providers, nicht seine Nachfahrin: useContext liefert
 * dann immer den Default-Wert (null), nie den echten Medium-Stand.
 */
export type Rahmen = 'operator' | 'portal' | 'ohne_rahmen'

// Exportiert für den Test (src/lib/portal-rahmen.test.ts).
export function waehleRahmen(pathname: string): Rahmen {
  if (pathname === '/portal/login') return 'ohne_rahmen'
  if (pathname === '/portal' || pathname.startsWith('/portal/')) return 'portal'
  return 'operator'
}

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter()
  const inhalt = <Component {...pageProps} />
  const rahmen = waehleRahmen(router.pathname)

  return (
    <ApolloProvider client={client}>
      <div className={`${appFont.variable} ${monoFont.variable}`}>
        {rahmen === 'portal' && <PortalLayout>{inhalt}</PortalLayout>}
        {rahmen === 'operator' && <Layout>{inhalt}</Layout>}
        {rahmen === 'ohne_rahmen' && inhalt}
      </div>
      <Toaster richColors position="bottom-right" />
    </ApolloProvider>
  )
}
