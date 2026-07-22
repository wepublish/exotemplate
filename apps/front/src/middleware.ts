import { NextResponse } from 'next/server'

/**
 * Portal-API-Cache-Schutz.
 *
 * Alle /api/portal/*-Antworten sind sitzungsspezifisch (an die Magic-Link-
 * Session eines einzelnen Mediums gebunden) und dürfen NIE in einen Edge-
 * oder Browser-Cache. Ohne diesen Header cachte Cloudflare authentifizierte
 * Antworten und lieferte eine Kopie an alle aus: das Portal zeigte veraltete/
 * leere Listen (frische Uploads erschienen nicht), und eingeloggte Daten
 * (z. B. /api/portal/me mit E-Mail und Medium) wurden öffentlich ausgeliefert.
 *
 * Die Middleware setzt den Header an EINER Stelle für alle bestehenden und
 * künftigen Portal-Routen, damit keine vergessen werden kann. Die eigentliche,
 * vollständige Absicherung ist zusätzlich eine Cloudflare-Cache-Regel, die
 * /api/* vom Edge-Cache ausnimmt; dieser Header ist die origin-seitige
 * Rückversicherung (Cloudflare respektiert no-store, verifiziert).
 */
export function middleware() {
  const res = NextResponse.next()
  res.headers.set('Cache-Control', 'no-store, must-revalidate')
  return res
}

export const config = {
  // Deckt sowohl die Portal-API (/api/portal/*) als auch die Portal-Seiten
  // (/portal, /portal/*) ab. Auch die Seiten-HTML wurde von Cloudflare
  // gecacht, wodurch der Browser altes JavaScript ohne Cache-Buster lud.
  matcher: ['/api/portal/:path*', '/portal', '/portal/:path*'],
}
