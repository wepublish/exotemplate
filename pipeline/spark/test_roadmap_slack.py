#!/usr/bin/env python3
"""
Offline-Tests fuer die Medien-Channel-Roadmap (faas_roadmap_slack, ohne Netz).

Deckt ab:
  - baue_status_text: Haekchen-Logik der sieben Stationen, Gesuchs-Zaehler,
    ausgeblendete Antraege zaehlen nicht als Auswahl, Name-Fallback auf Slug.
  - baue_thread_text: Deckel MAX_THREAD_EVENTS, Detail-Kuerzung, Actor-Anzeige.

Lauf:
  python3 -m pytest spark/test_roadmap_slack.py
  ODER  python3 spark/test_roadmap_slack.py
"""

from __future__ import annotations

import os
import sys
import unittest

# spark/ in den Pfad, damit die Module direkt importierbar sind (wie auf dem Spark).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import faas_roadmap_slack as rs  # noqa: E402


def medium(**kw):
    m = {"slug": "zwoelf", "name": "Zwölf", "slack_channel": "C123",
         "dna_medium_freigabe": None, "matching_freigeschaltet": None,
         "logo_hochgeladen": False}
    m.update(kw)
    return m


class TestBaueStatusText(unittest.TestCase):
    def test_frisches_medium_nur_station_1(self):
        text = rs.baue_status_text(medium(), dna_aktiv=False, apps=[])
        self.assertIn("*Roadmap Zwölf*", text)
        self.assertIn("[x] 1. Onboarding gestartet", text)
        self.assertIn("[ ] 2. Logo und Unterlagen", text)
        self.assertIn("[ ] 3. DNA aktiv", text)
        self.assertIn("[ ] 5. Matching freigegeben", text)
        self.assertIn("[ ] 6. Stiftungen ausgewählt (0)", text)

    def test_alle_stationen_erreicht(self):
        apps = [{"status": "eingereicht"}, {"status": "zugesagt"}]
        text = rs.baue_status_text(
            medium(logo_hochgeladen=True, dna_medium_freigabe="2026-07-28",
                   matching_freigeschaltet="2026-07-28"),
            dna_aktiv=True, apps=apps)
        for nr in range(1, 8):
            self.assertIn(f"[x] {nr}.", text)
        self.assertIn("Stiftungen ausgewählt (2)", text)
        self.assertIn("1 eingereicht", text)
        self.assertIn("1 zugesagt", text)

    def test_ausgeblendete_antraege_zaehlen_nicht_als_auswahl(self):
        apps = [{"status": "ausgeblendet"}, {"status": "ausgeblendet"}]
        text = rs.baue_status_text(medium(), dna_aktiv=False, apps=apps)
        self.assertIn("[ ] 6. Stiftungen ausgewählt (0)", text)

    def test_identifizierte_antraege_zaehlen_als_auswahl_aber_nicht_als_gesuch(self):
        apps = [{"status": "identifiziert"}]
        text = rs.baue_status_text(medium(), dna_aktiv=False, apps=apps)
        self.assertIn("[x] 6. Stiftungen ausgewählt (1)", text)
        self.assertIn("[ ] 7. Gesuche:", text)

    def test_name_fallback_auf_slug(self):
        text = rs.baue_status_text(medium(name=None), dna_aktiv=False, apps=[])
        self.assertIn("*Roadmap zwoelf*", text)


class TestBaueThreadText(unittest.TestCase):
    def test_einzelnes_ereignis_mit_actor_und_detail(self):
        events = [{"titel": "Zusage: Stiftung X", "typ": "zusage",
                   "detail": "Zugesagter Betrag: CHF 20000",
                   "actor": "redaktion@zwoelf.ch",
                   "date_created": "2026-07-28T10:00:00Z"}]
        text = rs.baue_thread_text(events)
        self.assertIn("Neu auf der Roadmap:", text)
        self.assertIn("Zusage: Stiftung X", text)
        self.assertIn("(redaktion@zwoelf.ch)", text)
        self.assertIn("Zugesagter Betrag: CHF 20000", text)

    def test_deckel_max_thread_events(self):
        events = [{"titel": f"Ereignis {i}", "typ": "portal_login",
                   "date_created": f"2026-07-28T10:{i:02d}:00Z"}
                  for i in range(rs.MAX_THREAD_EVENTS + 3)]
        text = rs.baue_thread_text(events)
        self.assertIn(f"Ereignis {rs.MAX_THREAD_EVENTS - 1}", text)
        self.assertNotIn(f"Ereignis {rs.MAX_THREAD_EVENTS}\n", text)
        self.assertIn("und 3 weitere Ereignisse", text)

    def test_langes_detail_wird_gekuerzt(self):
        events = [{"titel": "T", "typ": "zusage", "detail": "x" * 500,
                   "date_created": "2026-07-28T10:00:00Z"}]
        text = rs.baue_thread_text(events)
        self.assertNotIn("x" * 201, text)
        self.assertIn("x" * 200, text)

    def test_titel_fallback_auf_typ(self):
        events = [{"typ": "dna_aktiv", "date_created": "2026-07-28T10:00:00Z"}]
        text = rs.baue_thread_text(events)
        self.assertIn("dna_aktiv", text)




class TestUnveraendertKeinUpdate(unittest.TestCase):
    """Wunsch 29.07.2026: chat.update nur, wenn sich der Text geaendert hat.
    Thread-Antworten fuer neue Ereignisse laufen unabhaengig davon weiter;
    nach FORCE_UPDATE_SEK wird trotzdem aktualisiert (Selbstheilung bei von
    Hand geloeschter Nachricht)."""

    def _lauf(self, st, events=None, text_aenderung=False):
        import time as _time
        from unittest import mock
        m = medium(name="Zwölf Neu" if text_aenderung else "Zwölf")
        calls = []

        def fake_slack(methode, payload, tok):
            calls.append((methode, payload))
            return {"ok": True, "ts": "999.111", "channel": "C123"}

        with mock.patch.object(rs, "slack_call", fake_slack):
            rs.verarbeite_medium(m, dna_set=set(), apps=[], events=events or [],
                                 st=st, stok="xoxb-test", apply_=True)
        return calls

    def _frischer_state(self):
        import time as _time
        text = rs.baue_status_text(medium(), False, [])
        return {"ts": "111.222", "channel": "C123", "kanal_konfig": "C123",
                "letzter_event_ts": "2026-07-29T00:00:00",
                "text_hash": rs.text_fingerabdruck(text), "text_ts": _time.time()}

    def test_unveraendert_kein_slack_call(self):
        calls = self._lauf(self._frischer_state())
        self.assertEqual(calls, [], "unveraenderter Stand darf keinen Slack-Call ausloesen")

    def test_thread_antwort_trotz_unveraendertem_stand(self):
        events = [{"date_created": "2026-07-29T10:00:00", "titel": "Neues Ereignis",
                   "typ": "portal_login", "detail": None, "actor": None}]
        calls = self._lauf(self._frischer_state(), events=events)
        self.assertEqual([c[0] for c in calls], ["chat.postMessage"])
        self.assertEqual(calls[0][1].get("thread_ts"), "111.222")

    def test_textaenderung_loest_update_aus(self):
        st = self._frischer_state()
        calls = self._lauf(st, text_aenderung=True)
        self.assertEqual([c[0] for c in calls], ["chat.update"])
        neu = rs.baue_status_text(medium(name="Zwölf Neu"), False, [])
        self.assertEqual(st.get("text_hash"), rs.text_fingerabdruck(neu),
                         "State muss den Hash des neuen Texts tragen")

    def test_zwangsauffrischung_nach_24h(self):
        st = self._frischer_state()
        st["text_ts"] = st["text_ts"] - rs.FORCE_UPDATE_SEK - 1
        calls = self._lauf(st)
        self.assertEqual([c[0] for c in calls], ["chat.update"])

    def test_stand_zeile_zaehlt_nicht_zum_fingerabdruck(self):
        """Die Stand-Zeile traegt den Render-Zeitpunkt und aendert sich jede
        Minute — sie darf den Skip nicht aushebeln (Befund 29.07.2026)."""
        a = "*Roadmap Zwölf*\nStand: 29.07.2026 10:49\n\n[x] 1. Onboarding"
        b = "*Roadmap Zwölf*\nStand: 30.07.2026 08:15\n\n[x] 1. Onboarding"
        c = "*Roadmap Zwölf*\nStand: 30.07.2026 08:15\n\n[x] 2. Zugang"
        self.assertEqual(rs.text_fingerabdruck(a), rs.text_fingerabdruck(b))
        self.assertNotEqual(rs.text_fingerabdruck(a), rs.text_fingerabdruck(c))

    def test_alter_state_ohne_hash_aktualisiert(self):
        st = self._frischer_state()
        st.pop("text_hash"); st.pop("text_ts")
        calls = self._lauf(st)
        self.assertEqual([c[0] for c in calls], ["chat.update"])


if __name__ == "__main__":
    unittest.main()
