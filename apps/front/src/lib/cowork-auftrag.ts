/**
 * cowork-auftrag.ts: baut den Cowork-Auftragstext für die Operator-Warteschlange
 * «Vom Medium angefordert» (Task 11).
 *
 * Rahmt den vom Operator bereits geholten Copy-paste-Prompt (siehe
 * /api/gesuch-prompt?stil=verweis, gesuch-prompt.ts) mit einem kurzen
 * Auftragskopf: Kontext (Medium × Stiftung), Anweisungen (Gesuch als
 * Fliesstext liefern, Beilagen gemäss den Anforderungen der Stiftung
 * zusammenstellen und im Drive-Ordner ablegen, Sprachregeln), danach der
 * Prompt selbst. Reine Textbau-Funktion, kein IO: applications.tsx holt den
 * Gesuch-Prompt separat über die bestehende Route und übergibt das Ergebnis
 * hier hinein, bevor es in die Zwischenablage kopiert wird.
 */

export interface CoworkAuftragArgs {
  /** Der Copy-paste-Prompt aus /api/gesuch-prompt (stil=verweis). */
  gesuchPrompt: string
  mediumName: string
  stiftungName: string
  /** Drive-Ablagepfad für Gesuchtext + Beilagen (aus /api/gesuch-prompt: ablage). */
  ablagePfad: string
}

export function baueCoworkAuftrag(args: CoworkAuftragArgs): string {
  const { gesuchPrompt, mediumName, stiftungName, ablagePfad } = args

  return [
    `Cowork-Auftrag: Gesuch ${mediumName} × ${stiftungName}`,
    '',
    'Schreibe das Gesuch als Fliesstext (kein Formular-Layout, keine Platzhalter). ' +
      'Stelle die Beilagen gemäss den Anforderungen der Stiftung zusammen und lege sie ' +
      `zusammen mit dem Gesuchtext im Drive-Ordner «${ablagePfad}» ab.`,
    '',
    'Sprachregeln: Deutsch in Schweizer Rechtschreibung (kein scharfes s, immer «ss»), ' +
      '«Guillemets» als Zitatzeichen, keine Gedankenstriche.',
    '',
    gesuchPrompt,
  ].join('\n')
}
