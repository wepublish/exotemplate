/**
 * /api/portal/marke/<datei> — liefert die We.Publish-Markenbilder fürs Portal.
 *
 * WARUM diese Route überhaupt existiert (Befund 28.07.2026):
 * Cloudflare Access schützt die Domain und lässt nur bestimmte Pfade durch,
 * darunter `/portal/*` und `/api/portal/*`. Dateien direkt unter `/` sind NICHT
 * freigegeben: ein Aufruf von `https://fundraising.wepublish.cloud/icon-192.png`
 * bekommt 302 auf den Access-Login, obwohl der Container lokal 200 liefert.
 * Ergebnis: im Medien-Portal war in Kopf- und Fusszeile ein kaputtes Bild zu
 * sehen (von Michael Scheurer am 28.07. gemeldet).
 *
 * Diese Route umgeht das, indem sie die Bilder unter dem bereits freigegebenen
 * Präfix ausliefert. Sie ist eine Krücke, nicht die Lösung. Die richtige
 * Korrektur ist eine Access-Bypass-Regel für die statischen Pfade
 * (`/icon-192.png`, `/logo*.png`, `/favicon*`, `/apple-touch-icon.png`) im
 * Cloudflare-Zero-Trust-Dashboard. Das Favicon lässt sich hier NICHT retten,
 * weil der Browser es fest unter `/favicon.ico` anfragt — dafür braucht es die
 * Access-Regel. Sobald die steht, kann diese Route weg und die Komponenten
 * zeigen wieder direkt auf `/icon-192.png`.
 */
import fs from 'fs'
import path from 'path'
import type { NextApiRequest, NextApiResponse } from 'next'

/** Nur diese Dateien, damit die Route kein Leseloch in den Container reisst. */
const ERLAUBT: Record<string, string> = {
  'icon-192.png': 'image/png',
  'logo.png': 'image/png',
  'logo-weiss.png': 'image/png',
  'favicon-32.png': 'image/png',
  'apple-touch-icon.png': 'image/png',
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD')
    return res.status(405).end()
  }

  const datei = Array.isArray(req.query.datei) ? req.query.datei[0] : req.query.datei
  const typ = datei ? ERLAUBT[datei] : undefined
  if (!datei || !typ) return res.status(404).end()

  try {
    // basename schneidet jeden Pfadanteil ab; zusammen mit der Whitelist ist
    // ein Ausbruch aus public/ nicht möglich.
    const p = path.join(process.cwd(), 'public', path.basename(datei))
    const bild = fs.readFileSync(p)
    res.setHeader('Content-Type', typ)
    res.setHeader('Content-Length', String(bild.length))
    // Markenbilder ändern sich praktisch nie; lange cachen ist hier richtig.
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable')
    return res.status(200).send(bild)
  } catch {
    return res.status(404).end()
  }
}
