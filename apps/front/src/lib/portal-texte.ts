/**
 * portal-texte.ts: Wording-Schlüssel + Mail-Vorlagen für das Medien-Portal.
 *
 * PORTAL_TEXTE ist die kanonische Textquelle für die Portal-Seiten (Medium-
 * Ansicht, kommende Tasks), 1:1 übernommen aus
 * .superpowers/sdd/portal-wording-final.md. MAIL_EINLADUNG / MAIL_NEUER_LINK
 * sind die Vorlagen für den Link-Versand aus dem eigenen Mail-Programm.
 *
 * ENTSCHEID (28.07.2026, Jolanda): Es gibt bewusst KEINEN automatischen
 * Mail-Versand. Die entscheidenden Handlungen bleiben bei We.Publish, und die
 * Mail geht aus dem persönlichen Postfach der Bedienerin raus (Ramona, Michi
 * oder Jolanda) — dann landet auch die Antwort des Mediums direkt bei ihr,
 * statt in einem unbeaufsichtigten no-reply-Kasten. Die Portal-Steuerung
 * liefert dafür die fertige Mail (Empfänger, Betreff, Text) zum Kopieren oder
 * zum Öffnen im Mail-Programm.
 *
 * SICHERHEIT (28.07.2026, Einwand Michael Scheurer): in einer Einladungsmail
 * steht NIE ein Login-Link. Eine Mail wird weitergeleitet, archiviert, und das
 * Postfach kann übernommen werden — ein mitgeschickter Link ist damit ein
 * Schlüssel, der herumliegt. Stattdessen verweisen die Mails auf die
 * Login-Seite, wo das Medium sich selbst einen Link anfordert. Nur
 * MAIL_NEUER_LINK trägt einen Link, denn genau darum hat das Medium gebeten;
 * dieser Link ist kurzlebig (siehe loginTokenTtlSekunden in portal-session.ts).
 *
 * Platzhalter in den Mail-Vorlagen: {anrede} (ganze Anredezeile, siehe
 * baueAnrede in mail-vorlagen.ts — mit Name, sonst «Liebe Redaktion von X»),
 * {medium}, {loginseite} (URL der Login-Seite), {link} (nur MAIL_NEUER_LINK),
 * {stunden} (Gültigkeit des Links), {slack} (Slack-Kanal des Mediums),
 * {absender} (Vorname der Bedienerin, vorbelegt mit Ramona). fuelleVorlage
 * ersetzt NUR die im werte-Objekt übergebenen Schlüssel; nicht übergebene
 * Platzhalter bleiben wörtlich stehen und fallen so beim Korrekturlesen auf.
 * Die aufrufenden Seiten füllen {anrede} und {absender} immer: die Anrede über
 * baueAnrede (Rückfall auf «Liebe Redaktion von <Medium>»), den Absender über
 * ABSENDER_STANDARD. Ein rohes «Hallo {name}» kann damit nicht mehr rausgehen —
 * genau das war am 28.07.2026 passiert (Befund Michael Scheurer).
 */

export type MailVorlage = { betreff: string; text: string }

/**
 * Vorgabe für die Gültigkeit eines Anmeldelinks, in Stunden. Liegt hier und
 * nicht in portal-session.ts, weil diese Datei auch im Browser-Bundle landet
 * (portal-session zieht node:crypto herein). portal-session liest sie und
 * lässt sie per PORTAL_LOGIN_TTL_STUNDEN überschreiben.
 */
export const LOGIN_TTL_STUNDEN_STANDARD = 8

export const MAIL_EINLADUNG: MailVorlage = {
  betreff: 'Dein Zugang zum FaaS-Portal von We.Publish',
  text: `{anrede}

Schön, dass {medium} beim Fundraising as a Service von We.Publish dabei ist. Euer Zugang ist bereit.

So kommt ihr hinein:

{loginseite}

Dort gebt ihr diese E-Mail-Adresse ein, und wir schicken euch einen Anmeldelink. Kein Passwort nötig, ein Klick genügt. Der Anmeldelink gilt {stunden} Stunden; danach fordert ihr auf derselben Seite einfach einen neuen an. Nach dem Anmelden bleibt ihr einen Monat lang eingeloggt.

So läuft es Schritt für Schritt:

1. Logo hochladen. Es erscheint später auf euren Gesuchen und im Portal.
2. Unterlagen hochladen. Artikel, Newsletter, frühere Gesuche, Budgets, Selbstbeschriebe: je mehr wir von euch sehen, desto genauer wird euer Profil. Unvollständig ist völlig ok.
3. Fundraising-DNA prüfen und freigeben. Euer Profil entsteht aus euren Unterlagen, ihr lest es in Ruhe durch und gebt es frei, wenn es passt.
4. Wir schalten frei. Nach eurer Freigabe schauen wir nochmal darüber und schalten das Matching für euch frei.
5. Treffer ansehen. Ihr seht die passenden Stiftungen.
6. Gesuche prüfen. Ihr prüft die Gesuchsentwürfe und meldet uns, wenn sie eingereicht sind.

Fragen, Stolpersteine, Rückmeldungen: am besten in eurem Slack-Kanal, dort sind wir alle erreichbar und niemand muss auf eine einzelne Person warten. {slack}

Herzlich
{absender}, Fundraising-Team We.Publish`,
}

/**
 * Benachrichtigung nach der Matching-Freischaltung (Entscheid 28.07.2026:
 * «wenn wir sie freigeben, soll das medium wiederum eine meldung bekommen
 * (mail und slack) und die liste erstmals sehen»). Die Slack-Meldung übernimmt
 * die Roadmap auf dem Spark (faas_roadmap_slack).
 *
 * Auch hier steht bewusst KEIN Login-Link: die Mail geht von Hand raus, oft
 * Stunden nach dem Freischalten, ein kurzlebiger Link wäre dann längst tot.
 * Der Verweis auf die Login-Seite funktioniert dagegen immer.
 */
export const MAIL_MATCHING_FREI: MailVorlage = {
  betreff: 'Eure Stiftungs-Treffer sind bereit',
  text: `{anrede}

gute Nachrichten: wir haben eure Trefferliste geprüft und das Matching für {medium} freigeschaltet. Ihr seht jetzt die Stiftungen, die am besten zu euch passen.

So geht ihr vor:

1. Meldet euch im Portal an: {loginseite}
2. Schaut die Treffer in Ruhe durch. Zuoberst steht, was am besten zu euch passt.
3. Mit «Anschreiben» sagt ihr uns, für welche Stiftungen wir die Gesuche vorbereiten sollen.

Falls eure Anmeldung abgelaufen ist, gebt auf der Login-Seite einfach eure E-Mail-Adresse ein, dann kommt ein frischer Anmeldelink.

Wenn etwas unklar ist, schreibt uns in eurem Slack-Kanal. {slack}

Herzlich
{absender}, Fundraising-Team We.Publish`,
}

/**
 * Die einzige Mail, die einen Login-Link trägt — weil das Medium genau darum
 * gebeten hat. Der Link gilt {stunden} Stunden und macht den vorherigen
 * ungültig. Bitte zügig weiterleiten, solange der Versand von Hand läuft.
 */
export const MAIL_NEUER_LINK: MailVorlage = {
  betreff: 'Dein Anmeldelink zum FaaS-Portal',
  text: `{anrede}

hier ist dein Anmeldelink zum Portal:

{link}

Der Link gilt {stunden} Stunden; nach dem Anmelden bleibst du einen Monat lang eingeloggt. Ein vorher angeforderter Link ist damit ungültig.

Ist der Link abgelaufen, hol dir hier einfach einen neuen:

{loginseite}

Wenn du den Link nicht selbst angefordert hast, ignoriere diese Mail und melde dich kurz in eurem Slack-Kanal. {slack}

Herzlich
{absender}, Fundraising-Team We.Publish`,
}

/**
 * Ersetzt Platzhalter `{schluessel}` in einem rohen String. Nur die in
 * `werte` übergebenen Schlüssel werden ersetzt (auch bei leerem String).
 * Nicht übergebene Platzhalter bleiben wörtlich stehen. Nutzt split/join
 * statt RegExp: {name} ist ein literaler Teilstring, keine
 * Zeichenklassen-Eskalation nötig, und geschweifte Klammern in einer
 * Ersetzungs-URL (z. B. ein Query-Parameter) werden nicht als Metazeichen
 * fehlinterpretiert.
 */
export function fuelleText(text: string, werte: Record<string, string>): string {
  return Object.entries(werte).reduce((acc, [schluessel, wert]) => acc.split(`{${schluessel}}`).join(wert), text)
}

/** Wie `fuelleText`, aber für eine ganze Mail-Vorlage (Betreff + Text). */
export function fuelleVorlage(vorlage: MailVorlage, werte: Record<string, string>): MailVorlage {
  return { betreff: fuelleText(vorlage.betreff, werte), text: fuelleText(vorlage.text, werte) }
}

/**
 * Baut aus `faas_medien.slack_channel` etwas, das in einer Mail als Verweis
 * taugt. Directus hält dort je Medium eine Channel-ID (Form `C0BFYRBKL9F`);
 * `slack.com/app_redirect` öffnet damit den Kanal direkt in der Slack-App.
 * Steht dort ein `#name`, wird der unverändert übernommen, weil ein Name ohne
 * Workspace-Adresse keinen funktionierenden Link ergibt. Ohne Kanal bleibt der
 * Verweis leer, und die aufrufende Seite lässt den Slack-Block weg.
 */
export function baueSlackVerweis(kanal?: string | null): string {
  const k = (kanal ?? '').trim()
  if (!k) return ''
  if (/^[CGD][A-Z0-9]{6,}$/.test(k)) return `https://slack.com/app_redirect?channel=${k}`
  return k.startsWith('#') ? k : `#${k}`
}

// ─── Wording-Schlüssel (UI-Texte der Portal-Seiten) ───────────────────────────

export const PORTAL_TEXTE: Record<string, string> = {
  'login.titel': 'Willkommen zurück',
  'login.intro':
    'Meldet euch mit eurer E-Mail-Adresse an, und wir schicken euch einen Anmeldelink. Kein Passwort nötig, ein Klick genügt.',
  'login.link_angefordert':
    'Wenn zu dieser Adresse ein Zugang besteht, ist der Anmeldelink unterwegs. Schaut in euer Postfach: der Link führt euch direkt hinein und gilt einige Stunden.',
  'login.fehler': 'Dieser Link ist nicht mehr gültig. Fordert unten einfach einen neuen an, dann geht es weiter.',

  'uebersicht.willkommen': 'Schön, dass ihr da seid, {medium}.',
  'uebersicht.stationen_intro':
    'Hier seht ihr, wo ihr steht: Unterlagen, DNA, Freischaltung, Treffer und Gesuche, Schritt für Schritt.',

  // Nächster-Schritt-Sätze pro aktiver Station auf der Übersichtsseite. Im
  // Brief zu Task 5 nicht vorgegeben, darum hier ergänzt (siehe Task-5-Report).
  // logo (Pflicht-Erststep, nachträglich ergänzt) folgt demselben Muster.
  'uebersicht.naechster_schritt.logo': 'Ladet zuerst euer Logo hoch, damit es auf eurem Gesuch erscheint.',
  'uebersicht.naechster_schritt.unterlagen':
    'Ladet als Nächstes eure Unterlagen hoch, damit wir eure Fundraising-DNA erstellen können.',
  'uebersicht.naechster_schritt.dna': 'Prüft eure Fundraising-DNA und gebt sie frei.',
  'uebersicht.naechster_schritt.freischaltung':
    'Wir prüfen gerade euer Profil und schalten das Matching für euch frei, das dauert nicht mehr lange.',
  'uebersicht.naechster_schritt.treffer':
    'Schaut eure Treffer an, und meldet uns, für welche Stiftung wir ein Gesuch vorbereiten sollen.',
  // Aktuell unerreichbar: nach der Freischaltung bleibt 'treffer' dauerhaft
  // die aktive Station (bewusst so, siehe baueNaechsterSchrittText in
  // portal-status.ts); der Satz bleibt als defensives Netz.
  'uebersicht.naechster_schritt.gesuche': 'Prüft eure Gesuchsentwürfe und meldet uns, wenn sie eingereicht sind.',
  // Anhängsel in der Unterlagen-/DNA-Phase, solange keine Förderhistorie
  // erfasst ist (Design 2026-07-29, siehe baueNaechsterSchrittText).
  'uebersicht.naechster_schritt.foerderhistorie_hinweis':
    'Erfasst dabei auch eure bisherigen Förderungen und Ausschlüsse im Block «Bisherige Förderungen & Ausschlüsse» auf der Unterlagen-Seite: das macht eure Vorschläge treffsicherer.',

  // Logo-Block (Pflicht-Erststep, ganz oben auf /portal/onboarding): das
  // Medium muss ein echtes PNG/JPG hochladen, bevor es weitergeht (siehe
  // baueStationen in portal-status.ts). Im Wording-Dokument nicht
  // vorgegeben, darum hier ergänzt.
  'logo.titel': 'Logo',
  'logo.hinweis': 'Ladet als Allererstes euer Logo hoch, als PNG oder JPG. Es erscheint dann auf eurem Gesuch und hier im Portal.',
  'logo.hochladen_knopf': 'Logo hochladen',
  'logo.kein_logo': 'Noch kein Logo hochgeladen.',

  'unterlagen.intro':
    'Damit wir euch kennenlernen, sammeln wir hier, was euch ausmacht: Artikel, Newsletter, frühere Gesuche, Budgets und Selbstbeschriebe. Je mehr wir von euch sehen, desto genauer wird euer Profil und desto besser passen die Stiftungen, die wir für euch finden. Ladet einfach hoch, was ihr habt, unvollständig ist völlig in Ordnung.',
  'unterlagen.fragebogen_intro':
    'Ein paar kurze Fragen helfen uns, euch richtig einzuordnen. Nehmt euch die Minuten, es lohnt sich für alles, was danach kommt.',
  'unterlagen.dna_knopf_hinweis':
    'Wenn ihr auf «DNA erstellen lassen» klickt, machen wir uns an die Arbeit und lesen eure Unterlagen sorgfältig durch. Das dauert einen Moment, meist zehn bis zwanzig Minuten, danach liegt euer Profil zum Prüfen bereit.',

  // Feinere Wording-Schlüssel der Unterlagen-Seite (Task 6, im Wording-
  // Dokument nicht vorgegeben, darum hier ergänzt, siehe Task-6-Report).
  'unterlagen.upload_titel': 'Dokument hochladen',
  'unterlagen.upload_hinweis':
    'Zieht eine Datei hierhin oder klickt, um sie auszuwählen. Word, Excel, PDF, Text oder Markdown, bis 50 MB.',
  'unterlagen.url_titel': 'URL hinzufügen',
  'unterlagen.url_hinweis':
    'Ein Link zu einem Artikel, eurer Website oder etwas anderem, das euch beschreibt. Wir lesen die Seite für euch ein.',
  'unterlagen.fragebogen_titel': 'Fragebogen',
  'unterlagen.fragebogen_selbstbeschrieb_label': 'Wie beschreibt ihr euch selbst?',
  'unterlagen.fragebogen_fokus_label': 'Fokus, was ihr erreichen wollt',
  'unterlagen.fragebogen_nogos_label': 'No-Gos',
  'unterlagen.liste_titel': 'Eure Unterlagen',
  'unterlagen.liste_leer': 'Noch keine Unterlagen. Ladet oben etwas hoch, das den Anfang macht.',
  'unterlagen.wepublish_titel': 'Von We.Publish bereitgestellt',
  'unterlagen.dna_knopf': 'DNA erstellen lassen',
  'unterlagen.dna_knopf_gesperrt': 'Ladet zuerst eine Unterlage hoch, dann könnt ihr eure DNA erstellen lassen.',
  // Logo-Gate für denselben Knopf (Pflicht-Erststep, siehe Modul-Kommentar Logo-Block oben).
  'unterlagen.dna_knopf_gesperrt_logo': 'Ladet zuerst euer Logo hoch, dann könnt ihr eure DNA erstellen lassen.',

  // Förderhistorie + Ausschlüsse (Design 2026-07-29, docs/superpowers/specs/
  // 2026-07-29-foerderhistorie-und-ausschluesse-design.md).
  'foerderhistorie.titel': 'Bisherige Förderungen & Ausschlüsse',
  'foerderhistorie.intro':
    'Sagt uns, welche Stiftungen euch schon gefördert haben, wo ein Gesuch abgelehnt wurde, und welche Stiftungen für euch nicht (mehr) in Frage kommen. Ausgeschlossene Stiftungen schlagen wir euch nicht mehr vor, alles andere macht eure Vorschläge treffsicherer.',
  'foerderhistorie.stiftung_label': 'Stiftung',
  'foerderhistorie.stiftung_hinweis': 'Tippt den Namen; wir schlagen passende Stiftungen aus unserer Datenbank vor. Kein Treffer? Der Name allein reicht auch.',
  'foerderhistorie.jahr_label': 'Jahr',
  'foerderhistorie.betrag_label': 'Betrag in CHF (optional)',
  'foerderhistorie.zweck_label': 'Wofür (optional)',
  'foerderhistorie.ausschluss_haken': 'Diese Stiftung kommt für künftige Gesuche nicht mehr in Frage',
  'foerderhistorie.ausschluss_grund_label': 'Grund (hilft uns, ähnliche Fälle zu erkennen)',
  'foerderhistorie.hinzufuegen_knopf': 'Eintrag speichern',
  'foerderhistorie.liste_titel': 'Eure Einträge',
  'foerderhistorie.liste_leer': 'Noch keine Einträge. Auch wenige helfen schon.',
  'foerderhistorie.entfernen_knopf': 'Entfernen',
  'foerderhistorie.gespeichert': 'Eintrag gespeichert.',
  'foerderhistorie.entfernt': 'Eintrag entfernt.',

  'dna.intro': 'Das ist eure Fundraising-DNA, euer Profil in unseren Worten. Lest es in Ruhe durch und sagt uns, ob es euch trifft.',
  'dna.freigabe_hinweis':
    'Sobald ihr freigebt, schauen wir noch einmal darüber und schalten das Matching für euch frei. So stellen wir sicher, dass wirklich passt, was wir euch vorschlagen.',
  'dna.warten_auf_freischaltung':
    'Danke für eure Freigabe. Wir prüfen euer Profil gerade und melden uns, sobald die passenden Stiftungen für euch bereitstehen.',

  // Feinere Wording-Schlüssel der DNA-Seite (Task 7, im Wording-Dokument nicht
  // vorgegeben ausser dem Bestätigungs- und dem Erzeugungs-Wortlaut, die
  // beide wörtlich aus dem Task-7-Brief übernommen sind; siehe Task-7-Report).
  'dna.freigeben_knopf': 'DNA freigeben',
  'dna.freigeben_bestaetigung': 'Danach prüft We.Publish eure DNA und schaltet das Matching frei.',
  'dna.neu_erstellen_knopf': 'Mit mehr Material neu erstellen',
  'dna.wird_erstellt': 'Wir destillieren eure DNA …',
  'dna.fehlgeschlagen': 'Die Erstellung ist leider fehlgeschlagen. Versucht es gleich noch einmal.',
  // Logo-Gate: verhindert, dass die DNA-Erzeugung ohne Logo direkt über
  // /portal/dna angestossen wird (siehe Modul-Kommentar Logo-Block oben).
  'dna.logo_fehlt': 'Bitte ladet zuerst euer Logo hoch, dann kümmern wir uns um eure DNA.',

  'treffer.intro':
    'Diese Stiftungen haben wir für euch herausgesucht, sorgfältig auf euch abgestimmt. Zuoberst steht, was am besten zu euch passt.',
  'treffer.anschreiben_hinweis': 'Mit einem Klick sagt ihr uns, dass wir für diese Stiftung ein Gesuch für euch vorbereiten sollen.',
  'treffer.leer':
    'Noch sind keine Treffer da. Wir sind dran und melden uns, sobald die ersten passenden Stiftungen für euch bereitliegen.',

  // Feinere Wording-Schlüssel der Treffer-Seite (Task 8, im Wording-Dokument
  // nicht vorgegeben ausser den beiden Knopf-Beschriftungen, die wörtlich aus
  // dem Task-8-Brief übernommen sind; siehe Task-8-Report).
  'treffer.anschreiben_knopf': 'Anschreiben',
  'treffer.nicht_relevant_knopf': 'Nicht relevant',
  'treffer.nicht_relevant_hinweis': 'Sagt uns kurz, warum diese Stiftung für euch nicht in Frage kommt.',
  'treffer.bereits_vorhanden_hinweis': 'Für diese Stiftung läuft bereits ein Antrag.',

  // Consent-Dialog vor dem ersten Gesuch (Task 9, ConsentDialog.tsx): der
  // lange Provisions-/Rollen-Text selbst lebt in CONSENT_TEXT (consent.ts,
  // wörtlich aus dem Workspace-Dokument übernommen, siehe Task-9-Report),
  // hier nur die kurzen UI-Beschriftungen rund um den Dialog.
  'consent.titel': 'Bevor wir das Gesuch vorbereiten',
  'consent.checkbox_label': 'Wir bestätigen die Provisionsregelung',
  'consent.bestaetigen_knopf': 'Bestätigen',
  'consent.abbrechen_knopf': 'Abbrechen',
  'consent.kurzfassung':
    "Es gilt weiterhin die Provisionsregelung, die ihr bereits bestätigt habt: 10 Prozent des zugesagten Betrags, mindestens CHF 1'000, höchstens CHF 10'000, fällig nur bei einer Zusage.",

  'gesuche.in_arbeit': 'Wir schreiben gerade an eurem Gesuch. Sobald der Entwurf steht, findet ihr ihn hier.',
  'gesuche.bereit': 'Euer Gesuch liegt als Entwurf bereit. Lest es durch, ergänzt und ändert, was ihr möchtet, es ist euer Text.',
  'gesuche.final_hinweis': 'Wenn ihr zufrieden seid, markiert das Gesuch als fertig, dann wisst ihr und wir, dass es steht.',
  'gesuche.abgeschickt_frage':
    'Habt ihr das Gesuch eingereicht? Sagt uns kurz, wann und über welchen Betrag, damit wir euch weiter begleiten können.',
  'gesuche.nachfassen_reminder':
    'Seit der Einreichung sind drei Monate vergangen und noch keine Antwort da. Wenn ihr mögt, haken wir für euch bei der Stiftung nach.',

  // Feinere Wording-Schlüssel der Gesuche-Seite (Task 10, im Wording-Dokument
  // nicht vorgegeben ausser den fünf oben stehenden Sätzen; die Knopf-
  // Beschriftungen sind wörtlich aus dem Task-10-Brief übernommen, siehe
  // Task-10-Report).
  'gesuche.leer': 'Noch keine Gesuche. Sobald wir für eine Stiftung ein Gesuch für euch vorbereiten, erscheint es hier.',
  'gesuche.speichern_knopf': 'Speichern',
  'gesuche.final_knopf': 'Als final markieren',
  'gesuche.abgeschickt_knopf': 'Abgeschickt melden',
  'gesuche.antwort_knopf': 'Antwort melden',

  // Gemeinsamer Fehlertext der Portal-Seiten (Task 5, im Wording-Dokument
  // nicht vorgegeben): EINE Formulierung für alle Lade-Fehlerzustände.
  'fehler.daten_nicht_verfuegbar': 'Daten momentan nicht verfügbar. Bitte lädt die Seite gleich neu.',
}
