import { tenant } from '../../config/tenant'
import type { PortalSession } from './portal-session'

/**
 * consent.ts: reine Logik für den Consent-/Provisions-Flow des Medien-Portals
 * (Task 9, `/api/portal/anschreiben`, `ConsentDialog.tsx`).
 *
 * CONSENT_TEXT ist der Provisions-/Rollen-Text wörtlich aus
 * `.superpowers/sdd/consent-text-final.md` übernommen (Opus-Text Jolandas,
 * Textversion 2026-07-09): die sechs Abschnitte von "Was We.Publish für euch
 * tut" bis einschliesslich "Eure Bestätigung". Die Meta-Kopfzeile der Quelle
 * (Titel und die Textversion-/Provenienzzeile "Erstellt via Opus") und die
 * Kurzfassung am Ende der Quelle sind NICHT Teil dieser Konstante. Die
 * Kurzfassung ist ein reines UI-Element (ConsentDialog, Variante `voll=false`),
 * kein rechtlich protokollierter Text.
 *
 * `brauchtVollConsent` und `baueGesuchAuftrag` sind die einzige Logik, die
 * `/api/portal/anschreiben` braucht, um zu entscheiden, ob der volle Text
 * gezeigt werden muss, und um die beiden Schreib-Payloads (Application +
 * portal-json) zu bauen. Beides ist IO-frei und darum ohne Directus-Mock
 * testbar.
 */

export const CONSENT_TEXT_VERSION = '2026-07-09'

export const CONSENT_TEXT = `## Was We.Publish für euch tut

We.Publish recherchiert für euch passende Stiftungen, erstellt das Gesuch und stellt die nötigen Beilagen zusammen. Ihr prüft den Entwurf, überarbeitet ihn nach euren Vorstellungen und reicht ihn selbst bei der Stiftung ein. Die Verantwortung für die eingereichte Fassung liegt bei euch. Eine Zusage können wir nicht garantieren, denn den Entscheid trifft allein die Stiftung.

## Was ihr im Gegenzug bezahlt

Für jedes angenommene Gesuch fällt eine Erfolgsprovision an: 10 Prozent des Betrags, den die Stiftung zusagt, mindestens CHF 1'000 und höchstens CHF 10'000 pro Gesuch. Die Provision wird nur fällig, wenn die Stiftung zusagt. Bei einer Absage entstehen euch keine Kosten.

## Wann Sonderregeln gelten

In zwei Fällen sind Anpassungen der Provision vorbehalten: wenn ihr mit der betreffenden Stiftung bereits selbst in Kontakt gestanden habt, oder wenn We.Publish-Budget im Spiel ist. Solche Fälle klärt ihr direkt mit We.Publish, bevor das Gesuch eingereicht wird.

## Was ihr uns zurückmeldet

Damit die Zusammenarbeit funktioniert, tragt ihr im Portal zwei Dinge nach: die Einreichung mit Datum und beantragtem Betrag sowie den Entscheid der Stiftung, also eine Zusage mit dem zugesagten Betrag oder eine Absage. Diese Angaben sind die Grundlage für die Abrechnung der Erfolgsprovision.

## Wie wir mit euren Unterlagen umgehen

Die Unterlagen, die ihr uns zur Verfügung stellt, verwenden wir ausschliesslich für das Matching mit Stiftungen und für die Erstellung des Gesuchs. Wir geben sie nicht an Dritte weiter.

## Eure Bestätigung

Mit dem Setzen der Checkbox bestätigt ihr, dass ihr diese Bedingungen gelesen habt und mit ihnen einverstanden seid. Eure Bestätigung wird mit Zeitstempel, Person und Textversion protokolliert.`

// ─── brauchtVollConsent ──────────────────────────────────────────────────────

export interface ConsentLogEintrag {
  text_version: string
  kontext: string
}

/**
 * true, wenn unter den bisherigen consent_log-Zeilen dieses Mediums KEINE die
 * aktuelle `CONSENT_TEXT_VERSION` trägt, also beim allerersten Gesuch
 * (leere Logs) genauso wie nach einer Aktualisierung des Consent-Texts
 * (ältere Version(en) vorhanden, aber keine aktuelle). Reihenfolge/Anzahl der
 * Logs spielt keine Rolle, nur ob irgendeiner die aktuelle Version trägt.
 */
export function brauchtVollConsent(logs: ConsentLogEintrag[]): boolean {
  return !logs.some((log) => log.text_version === CONSENT_TEXT_VERSION)
}

// ─── baueGesuchAuftrag ───────────────────────────────────────────────────────

export interface GesuchAuftragApplicationDaten {
  status: 'identifiziert'
  station: 1
  mandant: string
  medium_id: string
  stiftung_id: number
  zuletzt_geaendert_quelle: 'portal'
  verantwortung: string
}

export interface GesuchAuftragPortalJson {
  angefordert_am: string
  angefordert_von: string
  consent_id: string
}

export interface GesuchAuftrag {
  applicationDaten: GesuchAuftragApplicationDaten
  portalJson: GesuchAuftragPortalJson
}

/**
 * Baut die beiden Schreib-Payloads für eine über das Portal angeforderte
 * Gesuchsanfrage: `applicationDaten` (für `POST /items/applications`,
 * station 1 = identifiziert, siehe STATUS_STATION in
 * graphql/applications.mutations.ts) und `portalJson` (das `portal`-json-Feld
 * der Application, mit Bezug auf die consent_log-Zeile, die die Zustimmung
 * für GENAU dieses Gesuch festhält).
 *
 * `stiftungId` ist der rohe String aus dem Request-Body; der Aufrufer hat ihn
 * bereits als gültige Zahl validiert (siehe anschreiben.ts), diese Funktion
 * parst ihn nur noch für das Int-Feld `stiftung_id`.
 *
 * Reine Funktion, kein IO: `jetzt` ist optional für Tests fest setzbar
 * (Default `new Date()`, wie `bauStatusPatch` in vorschlaege.ts).
 *
 * Aufrufreihenfolge in anschreiben.ts (Fix-Runde 1, selbstheilender Write,
 * siehe dortigen Kommentar): die consent_log-Zeile wird ZUERST geschrieben
 * (ihre id steht damit vor dem Application-Create fest), darum reicht EIN
 * Aufruf dieser Funktion mit der echten `consentId`. `applicationDaten` und
 * `portalJson` (inkl. `consent_id`) entstehen in einem Schritt, und die
 * Application wird direkt MIT eingebettetem `portal`-json angelegt. Kein
 * nachträglicher PATCH mehr nötig.
 */
export function baueGesuchAuftrag(
  session: PortalSession,
  stiftungId: string,
  consentId: string,
  jetzt: Date = new Date(),
): GesuchAuftrag {
  return {
    applicationDaten: {
      status: 'identifiziert',
      station: 1,
      mandant: tenant.key,
      medium_id: session.mediumSlug,
      stiftung_id: parseInt(stiftungId, 10),
      zuletzt_geaendert_quelle: 'portal',
      verantwortung: session.email,
    },
    portalJson: {
      angefordert_am: jetzt.toISOString(),
      angefordert_von: session.email,
      consent_id: consentId,
    },
  }
}
