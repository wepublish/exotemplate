/**
 * DnaPdf.tsx — Detaillierter PDF-Export der EINEN Medien-DNA (Ein-Knopf-Flow).
 *
 * Clientseitig mit jsPDF. Vereint, was früher auf Arbeits-DNA + finale v3-DNA verteilt
 * war, in einem Dokument: v3-Themen-Tags mit Begründung (Matching), das menschenlesbare
 * Profil (Besprechung mit dem Medium) und eine Übersicht der eingeflossenen Quellen.
 *
 * Kopf: wepublish-Logo (/logo.png, Betreiber) links + Medien-Logo (Favicon) rechts.
 */

import { useState } from 'react'
import { FileDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { GenerateDnaResult } from '@/lib/generate-dna-jobs'

interface DnaPdfProps {
  mediumName: string
  website: string | null
  slug: string
  result: GenerateDnaResult
}

async function ladeBildDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

async function generierePdf(props: DnaPdfProps): Promise<void> {
  const { mediumName, website, slug, result } = props
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const SEITE_BREITE = doc.internal.pageSize.getWidth()
  const SEITE_HOEHE = doc.internal.pageSize.getHeight()
  const RAND_L = 18
  const RAND_R = 18
  const NUTZBREITE = SEITE_BREITE - RAND_L - RAND_R
  const FUSSZEILE_Y = SEITE_HOEHE - 10
  let curY = 16
  let seite = 1

  const fusszeile = () => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(160, 160, 160)
    doc.text('Fundraising as a Service · We.Publish', RAND_L, FUSSZEILE_Y)
    doc.text(String(seite), SEITE_BREITE - RAND_R, FUSSZEILE_Y, { align: 'right' })
  }
  const neueSeite = () => {
    fusszeile()
    doc.addPage()
    seite += 1
    curY = 16
  }
  const seitenUmbruchPruefen = (benoetigt: number) => {
    if (curY + benoetigt > FUSSZEILE_Y - 8) neueSeite()
  }

  // ─── Kopf: wepublish-Logo links + Medien-Logo rechts ───────────────────────
  const wepublishLogo = await ladeBildDataUrl('/logo.png')
  if (wepublishLogo) {
    try {
      doc.addImage(wepublishLogo, 'PNG', RAND_L, curY, 33, 11)
    } catch {
      /* Logo nicht kritisch */
    }
  }
  const medienLogo = await ladeBildDataUrl(`/api/medium-logo?medium=${encodeURIComponent(slug)}`)
  if (medienLogo) {
    try {
      doc.addImage(medienLogo, 'PNG', SEITE_BREITE - RAND_R - 12, curY, 12, 12)
    } catch {
      /* nicht kritisch */
    }
  }
  curY += 14

  doc.setDrawColor(220, 220, 220)
  doc.line(RAND_L, curY, SEITE_BREITE - RAND_R, curY)
  curY += 7

  // Titel
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(30, 30, 30)
  doc.text(mediumName, RAND_L, curY)
  curY += 7

  if (website) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(100, 100, 100)
    doc.text(website, RAND_L, curY)
    curY += 5
  }

  const datum = new Date().toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(130, 130, 130)
  doc.text(`Medien-DNA · Version ${result.version} · generiert ${datum}`, RAND_L, curY)

  const schaerfeFarbe: [number, number, number] =
    result.schaerfe_prozent >= 70 ? [16, 185, 129] : result.schaerfe_prozent >= 45 ? [245, 158, 11] : [148, 163, 184]
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...schaerfeFarbe)
  doc.text(`Schärfe ${result.schaerfe_prozent}% · ${result.tag_count} Tags`, SEITE_BREITE - RAND_R, curY, { align: 'right' })
  curY += 8

  doc.setDrawColor(220, 220, 220)
  doc.line(RAND_L, curY, SEITE_BREITE - RAND_R, curY)
  curY += 8

  // ─── Abschnitts-Helfer ──────────────────────────────────────────────────────
  const abschnitt = (titel: string) => {
    seitenUmbruchPruefen(14)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(30, 30, 30)
    doc.text(titel, RAND_L, curY)
    curY += 2
    doc.setDrawColor(199, 210, 254)
    doc.line(RAND_L, curY, RAND_L + 70, curY)
    curY += 5
  }
  const fliesstext = (text: string, fontSize = 9.5) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(fontSize)
    doc.setTextColor(50, 50, 50)
    const zeilen = doc.splitTextToSize(text, NUTZBREITE) as string[]
    for (const z of zeilen) {
      seitenUmbruchPruefen(5)
      doc.text(z, RAND_L, curY)
      curY += 4.5
    }
  }
  const bulletListe = (eintraege: string[]) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(55, 65, 81)
    for (const e of eintraege) {
      const zeilen = doc.splitTextToSize(`• ${e}`, NUTZBREITE - 3) as string[]
      seitenUmbruchPruefen(zeilen.length * 4 + 1)
      for (let i = 0; i < zeilen.length; i++) {
        doc.text(i === 0 ? zeilen[i] : `  ${zeilen[i]}`, RAND_L + 2, curY)
        curY += 4
      }
    }
  }

  // ─── Selbstverständnis / Sound ──────────────────────────────────────────────
  if (result.sound_feeling) {
    abschnitt('Selbstverständnis')
    fliesstext(result.sound_feeling)
    curY += 4
  }

  // ─── DNA-Zusammenfassung (Prosa-Profil) ─────────────────────────────────────
  if (result.profil?.dna_summary) {
    abschnitt('DNA-Zusammenfassung')
    fliesstext(result.profil.dna_summary)
    curY += 4
  }

  // ─── Themen-Tags (v3, mit Gewicht + Begründung) ─────────────────────────────
  if (result.tags?.length) {
    abschnitt('Themen-Tags (Matching-Profil)')
    const sortiert = [...result.tags].sort((a, b) => (b.gewicht ?? 0) - (a.gewicht ?? 0))
    for (const t of sortiert) {
      seitenUmbruchPruefen(10)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(79, 70, 229)
      const gewichtLabel = t.gewicht === 3 ? 'Kern' : t.gewicht === 2 ? 'Neben' : 'Rand'
      doc.text(`${t.tag_slug}  [${gewichtLabel}]`, RAND_L + 2, curY)
      curY += 4
      if (t.begruendung) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8.5)
        doc.setTextColor(90, 90, 90)
        const zeilen = doc.splitTextToSize(t.begruendung, NUTZBREITE - 4) as string[]
        for (const z of zeilen) {
          seitenUmbruchPruefen(4)
          doc.text(z, RAND_L + 4, curY)
          curY += 4
        }
      }
      curY += 1.5
    }
    curY += 4
  }

  // ─── Profil-Dimensionen ─────────────────────────────────────────────────────
  const p = result.profil
  if (p) {
    const dims: Array<{ label: string; wert: string[] | string }> = [
      { label: 'Kernthemen', wert: p.core_themes },
      { label: 'Redaktionelle Haltung', wert: p.editorial_stance },
      { label: 'Gesellschaftliche Wirkung', wert: p.societal_impact },
      { label: 'Zielgruppen', wert: p.target_groups },
      { label: 'Geografischer Fokus', wert: p.geographic_focus ? [p.geographic_focus] : [] },
      { label: 'Matching-Keywords', wert: p.funding_keywords },
      { label: 'Stärken für Anträge', wert: p.grant_strengths },
      { label: 'Passende Stiftungsthemen', wert: p.matching_foundation_themes },
    ]
    for (const d of dims) {
      const eintraege = Array.isArray(d.wert) ? d.wert : [d.wert].filter(Boolean)
      if (eintraege.length === 0) continue
      seitenUmbruchPruefen(12)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(79, 70, 229)
      doc.text(d.label, RAND_L, curY)
      curY += 4
      bulletListe(eintraege)
      curY += 3
    }
  }

  // ─── Quellen-Übersicht ──────────────────────────────────────────────────────
  const q = result.quellen
  if (q) {
    abschnitt('Eingeflossene Quellen')
    const zeilen: string[] = []
    zeilen.push(
      q.wepublish_api_vorhanden
        ? `We.Publish: ${q.wepublish_artikel_neu} neue Artikel, ${q.wepublish_newsletter_neu} neue Newsletter`
        : 'We.Publish: kein API-Schlüssel hinterlegt (übersprungen)'
    )
    zeilen.push(q.web_crawl_ok ? 'Web-Crawl der Website: erfolgreich' : 'Web-Crawl: nicht durchgeführt')
    zeilen.push(`Korpus gesamt: ${q.korpus_eintraege_gesamt} Wissens-Einträge`)
    bulletListe(zeilen)
  }

  fusszeile()
  const dateiname = `${mediumName.replace(/[^a-zA-Z0-9äöüÄÖÜ]/g, '_')}_Medien-DNA.pdf`
  doc.save(dateiname)
}

export default function DnaPdf(props: DnaPdfProps) {
  const [generiert, setGeneriert] = useState(false)

  async function handleExport() {
    setGeneriert(true)
    try {
      await generierePdf(props)
    } catch (err) {
      const { toast } = await import('sonner')
      toast.error(`PDF-Export fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`)
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
      {generiert ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <FileDown className="w-3.5 h-3.5 mr-1.5" />}
      Als PDF exportieren
    </Button>
  )
}
