/**
 * Deterministischer Onboarding-Plan (Markdown) für ein neu aufgenommenes Medium.
 * Wird agentseitig in einen Slack-Canvas geschrieben (die App hält keinen Slack-Token).
 * Kein LLM — reine Vorlage, damit das Team den Onboarding-Stand teilen kann.
 */

export type OnboardingPlanDaten = {
  mediumName: string
  website?: string | null
}

export function bauOnboardingMarkdown(d: OnboardingPlanDaten): string {
  const web = (d.website ?? '').trim()
  return `# Onboarding: ${d.mediumName}

${web ? `Website: ${web}\n` : ''}_Stand: vom Assistenten vorbereitet. Häkchen setzt das Team._

## 1. Material erfassen
- [ ] Website und Eigenpublikationen sichten
- [ ] Frühere Gesuche, Budget, Gemeinnützigkeitsnachweis hochladen
- [ ] Artikel / Newsletter laden (We.Publish-API oder manuell)

## 2. Arbeits-DNA
- [ ] Arbeits-DNA generieren und mit dem Medium besprechen
- [ ] Korrekturen einarbeiten

## 3. Finale DNA messen
- [ ] Finale v3-DNA messen (gleiche Ellenlänge wie der Stiftungs-Pool)
- [ ] DNA aktiv schalten

## 4. Matching prüfen
- [ ] Erste Förderstiftungs-Treffer durchsehen
- [ ] Projekte mit eigenem Förderprofil anlegen (falls vorhanden)

## 5. Erste Anträge
- [ ] Starke Matches in die Anträge übernehmen
- [ ] Gesuch-Prompt vorbereiten (Opus schreibt das Gesuch)

---
_Vorbereiter, nicht Entscheider: der Assistent bereitet vor, Freigaben erteilt das Team._`
}
