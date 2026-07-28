import { NextResponse } from 'next/server'

/**
 * Cache-Schutz für alles Sitzungs- und Zustandsabhängige.
 *
 * Alle /api/portal/*-Antworten sind sitzungsspezifisch (an die Magic-Link-
 * Session eines einzelnen Mediums gebunden) und dürfen NIE in einen Edge-
 * oder Browser-Cache. Ohne diesen Header cachte Cloudflare authentifizierte
 * Antworten und lieferte eine Kopie an alle aus: das Portal zeigte veraltete/
 * leere Listen (frische Uploads erschienen nicht), und eingeloggte Daten
 * (z. B. /api/portal/me mit E-Mail und Medium) wurden öffentlich ausgeliefert.
 *
 * Seit 28.07.2026 gilt dasselbe für die Operator-SEITEN: gemessen sendeten
 * alle 17 Cockpit-HTML-Seiten gar keinen Cache-Control-Header, und die Zone
 * hat eine Cache-Everything-Regel (nachgewiesen an cf-cache-status HIT auf
 * endungslosen Pfaden). Nach einem Deploy konnte eine eingeloggte Operatorin
 * so altes HTML mit alten JS-Chunk-Hashes bekommen — derselbe Fehler, der
 * fürs Portal längst behoben war.
 *
 * Cloudflare-CDN-Cache-Control wirkt NUR auf den Cloudflare-Edge (höchste
 * Prioritaet, Browser ignorieren ihn) und hält den Edge auch dann draussen,
 * wenn im Dashboard eine Cache-Regel steht oder später eine Route ihren
 * Cache-Control-Header lockert. Wer im Dashboard je einen Cache für diese
 * Pfade einrichten will, muss diesen Header zuerst hier entfernen.
 */
export function middleware() {
  const res = NextResponse.next()
  res.headers.set('Cache-Control', 'no-store, must-revalidate')
  res.headers.set('Cloudflare-CDN-Cache-Control', 'no-store')
  return res
}

export const config = {
  // Vier Muster: Portal-API, Portal-Seiten, und als letztes alle Seiten-HTMLs
  // (jeder Pfad ohne Punkt, ohne /api- und ohne /_next-Präfix — trifft also
  // auch «/»). BEWUSST NICHT dabei: /api/:path* pauschal — die Operator-API
  // deckt next.config.ts ab, und /api/medium-logo hat einen gewollten
  // 24-Stunden-Cache, den ein pauschales no-store hier töten würde.
  matcher: ['/api/portal/:path*', '/portal', '/portal/:path*', '/((?!api|_next|.*\\.).*)'],
}
