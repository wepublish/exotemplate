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


if __name__ == "__main__":
    unittest.main()
