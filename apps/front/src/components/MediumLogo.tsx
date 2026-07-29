/**
 * MediumLogo — Medien-Favicon, souverän gecacht.
 *
 * Lädt das Logo über /api/medium-logo?medium=<slug> (gleicher Origin).
 * Der Browser kommuniziert nie direkt mit Fremd-Domains.
 * Bei Ladefehler → Initial-Avatar (Initialen aus name, emerald-Hintergrund).
 */

import { useState } from 'react'

// ─── Typen ────────────────────────────────────────────────────────────────────

interface MediumLogoProps {
  slug: string
  name: string
  /** Seiten-/Pixelgrösse des Containers (Default 40px). */
  size?: number
  /**
   * Cache-Buster: ändert sich der Wert, lädt der Browser das Bild neu. Nach
   * einem Logo-Wechsel übergeben die Aufrufer hier die neue Datei-id (oder
   * einen Zeitstempel) — sonst zeigt der Browser-Cache weiter das alte Logo
   * (Befund 29.07.2026, siehe LOGO_CACHE_CONTROL in api/medium-logo.ts).
   */
  version?: string | null
}

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

/** Zwei Initialen aus dem Medienname. */
function initialenAus(name: string): string {
  return name.trim().slice(0, 2).toUpperCase()
}

// ─── Komponente ───────────────────────────────────────────────────────────────

/**
 * Rendert das Medien-Logo über die server-seitige Route.
 * Fallback bei Fehler oder während des Ladens: Initialen-Avatar.
 */
export function MediumLogo({ slug, name, size = 40, version }: MediumLogoProps) {
  const [gescheitert, setGescheitert] = useState(false)
  const [geladen, setGeladen] = useState(false)

  const url = version
    ? `/api/medium-logo?medium=${encodeURIComponent(slug)}&v=${encodeURIComponent(version)}`
    : `/api/medium-logo?medium=${encodeURIComponent(slug)}`

  // Grössen-Klassen für den Container
  const containerStyle: React.CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
  }

  // Fallback: Initial-Avatar (emerald, wie bestehende FaaS-Designsprache)
  if (gescheitert) {
    return (
      <div
        style={containerStyle}
        className="rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 font-semibold text-sm"
        aria-label={name}
      >
        {initialenAus(name)}
      </div>
    )
  }

  return (
    <div style={containerStyle} className="relative rounded-xl overflow-hidden flex-shrink-0">
      {/* Platzhalter während des Ladens */}
      {!geladen && (
        <div
          style={containerStyle}
          className="absolute inset-0 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 font-semibold text-sm"
          aria-hidden="true"
        >
          {initialenAus(name)}
        </div>
      )}

      <img
        src={url}
        alt={`${name} Logo`}
        style={{ width: size, height: size }}
        className={[
          'rounded-xl object-contain',
          geladen ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
        onLoad={() => setGeladen(true)}
        onError={() => setGescheitert(true)}
        draggable={false}
      />
    </div>
  )
}
