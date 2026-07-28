import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  // Cloudflare cached sonst API-Antworten (beobachtet 28.07.2026 an
  // /api/zugangsverwaltung: neuer Portal-Zugang erschien im Cockpit nicht,
  // Origin war korrekt). Alle API-Routen sind nutzer-/zustandsabhaengig,
  // keine darf je aus einem Zwischenspeicher kommen. Einzelne Routen setzen
  // no-store bereits selbst (einloesen, wissen) – dieser Header deckt den Rest.
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
      {
        // Edge-Ausschluss unabhaengig vom Browser: Cloudflare wertet
        // Cloudflare-CDN-Cache-Control mit hoechster Prioritaet aus, Browser
        // ignorieren ihn. Haelt den Edge auch dann draussen, wenn im
        // Dashboard eine Cache-Regel steht oder eine Route ihr Cache-Control
        // lockert. /api/medium-logo ist ausgenommen: dessen 24h-Edge-Cache
        // ist gewollt (medium-logo.ts setzt public, max-age=86400 selbst).
        source: "/api/:path((?!medium-logo).*)",
        headers: [
          { key: "Cloudflare-CDN-Cache-Control", value: "no-store" },
        ],
      },
      {
        // Security-Grundschutz (gemessen fehlten alle drei Header komplett).
        // HSTS bewusst NICHT hier: das gehoert an den Cloudflare-Edge, wo es
        // zentral verwaltet und notfalls zurueckgenommen werden kann.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
