/**
 * portal-logo.ts: reine Bildtyp-Erkennung für den Portal-Logo-Upload
 * (/api/portal/logo, src/pages/portal/onboarding.tsx).
 *
 * Eigenes Modul statt direkt in der Route definiert (Muster wie
 * medium-logo.ts/portal-status.ts): die Route importiert `formidable`, das
 * unter dem jsdom-Jest-Environment dieses Projekts `TextEncoder` global
 * voraussetzt und dort nicht verfügbar ist. Reine Logik ohne IO gehört
 * ohnehin nach `src/lib/`, nicht in die Route selbst.
 */

export type PortalLogoTyp = 'png' | 'jpg'

/**
 * Erkennt PNG (`89 50 4E 47`) oder JPEG (`FF D8 FF`) an den Magic Bytes.
 * Alles andere (u. a. .ico, .svg, .gif, .bmp) ergibt null: die Route lehnt
 * den Upload dann mit 422 ab, statt eine Datei zu speichern, die der
 * Word-Export ohnehin nicht einbetten könnte (vgl. erkenneBildTyp in
 * gesuch-docx.ts, dort werden GIF/BMP zusätzlich akzeptiert, hier bewusst
 * nicht: der Pflicht-Erststep verlangt PNG/JPG).
 */
export function erkenneLogoTyp(buffer: Buffer): PortalLogoTyp | null {
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  return null
}
