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
    ];
  },
};

export default nextConfig;
