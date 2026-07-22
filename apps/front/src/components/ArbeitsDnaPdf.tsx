/**
 * ArbeitsDnaPdf.tsx — PDF-Export für die Arbeits-DNA (Stufe 1).
 *
 * Clientseitig mit jsPDF. Wird nur bei vorhandener arbeits_dna aktiviert.
 * Logo aus /logo.png (selbst gehostet, public/).
 *
 * Aufbau:
 *   - Kopf: Logo + Medienname + Website + Datum + Score
 *   - Zusammenfassung: dna_summary als Fliesstext
 *   - Dimensionen: je ein Abschnitt (Kernthemen, Redaktionelle Haltung, …)
 *   - Fusszeile: «Fundraising as a Service · We.Publish» + Seitenzahl
 */

import { useState } from 'react'
import { FileDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ArbeitsDnaGespeichert } from '@/pages/api/medium-knowledge/working-dna'

// ─── Typen ────────────────────────────────────────────────────────────────────

interface ArbeitsDnaPdfProps {
  mediumName: string
  website: string | null
  arbeitsDna: ArbeitsDnaGespeichert
  /** Slug des Mediums — wird genutzt um das Favicon über /api/medium-logo einzubetten. */
  slug?: string
}

// ─── PDF-Generator ────────────────────────────────────────────────────────────

/**
 * Lädt jsPDF dynamisch (client-only) und erzeugt das PDF.
 * Wirft bei Fehler.
 */
async function generierePdf(
  mediumName: string,
  website: string | null,
  dna: ArbeitsDnaGespeichert,
  slug?: string
): Promise<void> {
  // jsPDF dynamisch importieren (kein SSR-Problem)
  const { jsPDF } = await import('jspdf')

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  // ─── Hilfswerte ────────────────────────────────────────────────────────────
  const SEITE_BREITE = doc.internal.pageSize.getWidth()
  const SEITE_HOEHE = doc.internal.pageSize.getHeight()
  const RAND_L = 18
  const RAND_R = 18
  const NUTZBREITE = SEITE_BREITE - RAND_L - RAND_R
  const FUSSZEILE_Y = SEITE_HOEHE - 10

  let curY = 18

  // ─── Seitenzähler-Wrapper ──────────────────────────────────────────────────
  let seite = 1
  const fusszeile = () => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(160, 160, 160)
    doc.text(
      'Fundraising as a Service · We.Publish',
      RAND_L,
      FUSSZEILE_Y
    )
    doc.text(
      String(seite),
      SEITE_BREITE - RAND_R,
      FUSSZEILE_Y,
      { align: 'right' }
    )
  }

  const neueSeite = () => {
    fusszeile()
    doc.addPage()
    seite += 1
    curY = 18
  }

  const seitenUmbruchPruefen = (benoetigt: number) => {
    if (curY + benoetigt > FUSSZEILE_Y - 8) {
      neueSeite()
    }
  }

  // ─── Kopf ──────────────────────────────────────────────────────────────────

  // Logo laden + einbetten: zuerst Medien-Favicon, dann statisches Logo als Fallback.
  // Beide Quellen sind gleicher Origin — kein Fremd-Request vom Browser.
  let logoEingebettet = false

  if (slug) {
    try {
      const faviconRes = await fetch(`/api/medium-logo?medium=${encodeURIComponent(slug)}`)
      if (faviconRes.ok) {
        const faviconBlob = await faviconRes.blob()
        const faviconDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(faviconBlob)
        })
        // Favicon: quadratisch, 12×12mm im Kopf
        doc.addImage(faviconDataUrl, 'PNG', RAND_L, curY, 12, 12)
        curY += 14
        logoEingebettet = true
      }
    } catch {
      // Favicon nicht kritisch — Fallback auf statisches Logo
    }
  }

  if (!logoEingebettet) {
    try {
      const logoRes = await fetch('/logo.png')
      const logoBlob = await logoRes.blob()
      const logoDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(logoBlob)
      })
      // Logo: Höhe 12mm, Breite proportional (angenommenes 3:1 Seitenverhältnis)
      doc.addImage(logoDataUrl, 'PNG', RAND_L, curY, 36, 12)
      curY += 14
    } catch {
      // Logo nicht kritisch — ohne Logo weitermachen
      curY += 4
    }
  }

  // Trennlinie
  doc.setDrawColor(220, 220, 220)
  doc.line(RAND_L, curY, SEITE_BREITE - RAND_R, curY)
  curY += 6

  // Medienname
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(30, 30, 30)
  doc.text(mediumName, RAND_L, curY)
  curY += 7

  // Website
  if (website) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(100, 100, 100)
    doc.text(website, RAND_L, curY)
    curY += 5
  }

  // Generierungsdatum + Score
  const datumFormatiert = new Date(dna.generiert_am).toLocaleDateString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(130, 130, 130)
  doc.text(`Arbeits-DNA · generiert ${datumFormatiert}`, RAND_L, curY)

  // Score-Badge rechts
  const scoreText = `Score: ${dna.score}/100`
  const scoreFarbe: [number, number, number] =
    dna.score >= 70 ? [16, 185, 129] : dna.score >= 45 ? [245, 158, 11] : [148, 163, 184]
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...scoreFarbe)
  doc.text(scoreText, SEITE_BREITE - RAND_R, curY, { align: 'right' })
  curY += 8

  // Trennlinie
  doc.setDrawColor(220, 220, 220)
  doc.line(RAND_L, curY, SEITE_BREITE - RAND_R, curY)
  curY += 8

  // ─── DNA-Zusammenfassung ───────────────────────────────────────────────────

  seitenUmbruchPruefen(20)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(30, 30, 30)
  doc.text('DNA-Zusammenfassung', RAND_L, curY)
  curY += 5

  if (dna.dna_summary) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(50, 50, 50)
    const summaryZeilen = doc.splitTextToSize(dna.dna_summary, NUTZBREITE) as string[]
    for (const zeile of summaryZeilen) {
      seitenUmbruchPruefen(5)
      doc.text(zeile, RAND_L, curY)
      curY += 4.5
    }
  }
  curY += 6

  // ─── Dimensionen ──────────────────────────────────────────────────────────

  const dimensionen: Array<{ label: string; wert: string[] | string }> = [
    { label: 'Kernthemen', wert: dna.core_themes },
    { label: 'Redaktionelle Haltung', wert: dna.editorial_stance },
    { label: 'Gesellschaftliche Wirkung', wert: dna.societal_impact },
    { label: 'Zielgruppen', wert: dna.target_groups },
    { label: 'Geografischer Fokus', wert: dna.geographic_focus ? [dna.geographic_focus] : [] },
    { label: 'Finanzierungsmodell', wert: dna.funding_model_hints },
    { label: 'Matching-Keywords', wert: dna.funding_keywords },
    { label: 'Stärken für Anträge', wert: dna.grant_strengths },
    { label: 'Passende Stiftungsthemen', wert: dna.matching_foundation_themes },
  ]

  for (const dim of dimensionen) {
    const eintraege = Array.isArray(dim.wert) ? dim.wert : [dim.wert].filter(Boolean)
    if (eintraege.length === 0) continue

    seitenUmbruchPruefen(14)

    // Abschnitts-Header
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(79, 70, 229) // indigo-600
    doc.text(dim.label, RAND_L, curY)
    curY += 1.5

    // Leichte Unterlinie
    doc.setDrawColor(199, 210, 254) // indigo-200
    doc.line(RAND_L, curY, RAND_L + 60, curY)
    curY += 4

    // Einträge als Bullet-Liste
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(55, 65, 81)

    for (const eintrag of eintraege) {
      const zeilen = doc.splitTextToSize(`• ${eintrag}`, NUTZBREITE - 3) as string[]
      seitenUmbruchPruefen(zeilen.length * 4 + 1)
      for (let i = 0; i < zeilen.length; i++) {
        doc.text(i === 0 ? zeilen[i] : `  ${zeilen[i]}`, RAND_L + 2, curY)
        curY += 4
      }
    }

    curY += 4
  }

  // ─── Fusszeile der letzten Seite ──────────────────────────────────────────
  fusszeile()

  // ─── PDF speichern ─────────────────────────────────────────────────────────
  const dateiname = `${mediumName.replace(/[^a-zA-Z0-9äöüÄÖÜ]/g, '_')}_Arbeits-DNA.pdf`
  doc.save(dateiname)
}

// ─── Komponente ───────────────────────────────────────────────────────────────

export default function ArbeitsDnaPdf({ mediumName, website, arbeitsDna, slug }: ArbeitsDnaPdfProps) {
  const [generiert, setGeneriert] = useState(false)

  async function handleExport() {
    setGeneriert(true)
    try {
      await generierePdf(mediumName, website, arbeitsDna, slug)
    } catch (err) {
      const { toast } = await import('sonner')
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`PDF-Export fehlgeschlagen: ${msg}`)
    } finally {
      setGeneriert(false)
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => { void handleExport() }}
      disabled={generiert}
      className="text-xs border-indigo-200 text-indigo-700 hover:bg-indigo-50"
    >
      {generiert ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
      ) : (
        <FileDown className="w-3.5 h-3.5 mr-1.5" />
      )}
      Als PDF exportieren
    </Button>
  )
}
