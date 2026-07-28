/**
 * mailto.ts — baut `mailto:`-URLs für den Versand aus dem eigenen Mail-Programm.
 *
 * Hintergrund (Entscheid 28.07.2026): FaaS verschickt keine Mails selbst. Die
 * Bedienerin schickt Einladungs- und Link-Mails aus ihrem persönlichen
 * Postfach, damit die Antwort des Mediums bei ihr landet. Dieser Helfer macht
 * daraus einen Klick: `mailto:` öffnet das Standard-Mail-Programm mit
 * Empfänger, Betreff und Text vorbefüllt.
 *
 * Zwei Fallstricke, die hier bewusst behandelt werden:
 *   1. Zeilenumbrüche: in einer mailto-URL muss `\n` als %0A kodiert sein.
 *      encodeURIComponent macht das korrekt; \r\n würde in manchen Clients
 *      doppelte Umbrüche erzeugen, deshalb normalisieren wir auf \n.
 *   2. Längengrenze: Windows/Outlook kappt mailto-URLs historisch bei rund
 *      2000 Zeichen, ältere Clients früher. Der Einladungstext liegt kodiert
 *      darüber. `mailtoIstZuLang` sagt der UI, dass sie in diesem Fall zum
 *      Kopieren raten muss, statt eine abgeschnittene Mail zu öffnen.
 */

/** Ab dieser kodierten Gesamtlänge gilt eine mailto-URL als unsicher. */
export const MAILTO_MAX_LAENGE = 1900

/** Normalisiert Zeilenenden auf \n (siehe Kopf, Punkt 1). */
function normalisiere(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * Baut die mailto-URL. `an` darf leer sein (dann öffnet das Mail-Programm
 * ohne Empfänger, die Bedienerin trägt ihn selbst ein).
 */
export function baueMailtoUrl({
  an,
  betreff,
  text,
}: {
  an?: string
  betreff: string
  text: string
}): string {
  const ziel = encodeURIComponent((an ?? '').trim())
  const params = new URLSearchParams()
  params.set('subject', betreff)
  params.set('body', normalisiere(text))
  // URLSearchParams kodiert Leerzeichen als '+', was im mailto-Body als
  // Plus-Zeichen ankommt statt als Leerzeichen. Deshalb zurückdrehen.
  const query = params.toString().replace(/\+/g, '%20')
  return `mailto:${ziel}?${query}`
}

/** true, wenn die mailto-URL so lang ist, dass Clients sie kappen könnten. */
export function mailtoIstZuLang(url: string): boolean {
  return url.length > MAILTO_MAX_LAENGE
}
