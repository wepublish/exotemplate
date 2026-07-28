#!/usr/bin/env python3
"""
Offline-Tests fuer den Roadmap-Slack-Sync (ohne Netz, ohne slack_sdk).

Deckt ab:
  - parse_action: gueltige frei/astat-Actions, Muell wirft ValueError.
  - akt_roadmap_freigabe: harte Guard (nr nicht in {1,3,5,7}) ohne Directus-Aufruf;
    read-modify-write setzt nur die Zielstation, laesst die anderen unangetastet.
  - baue_blocks: < 50 Bloecke, Medium-Stationen haben Button, We.Publish nicht.

Lauf:
  python3 -m pytest spark/test_slack_roadmap.py
  ODER  python3 spark/test_slack_roadmap.py
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest import mock

# spark/ in den Pfad, damit die Module direkt importierbar sind (wie auf dem Spark).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import faas_actions  # noqa: E402
import faas_roadmap_render  # noqa: E402
from faas_slack_daemon import parse_action  # noqa: E402  (laedt KEIN slack_sdk auf Modulebene)


class TestParseAction(unittest.TestCase):
    def test_frei_gueltig(self):
        d = parse_action('{"k":"frei","m":"bajour","s":3,"v":true}')
        self.assertEqual(d["k"], "frei")
        self.assertEqual(d["m"], "bajour")
        self.assertEqual(d["s"], 3)
        self.assertIs(d["v"], True)

    def test_astat_gueltig(self):
        d = parse_action('{"k":"astat","a":"abc-123"}')
        self.assertEqual(d["k"], "astat")
        self.assertEqual(d["a"], "abc-123")

    def test_muell_wirft(self):
        for muell in ("nicht json", "{}", '{"k":"frei"}', '{"k":"astat"}',
                      '{"k":"xy","m":"a"}', '[1,2,3]', '{"k":"frei","m":"a","s":"3","v":true}'):
            with self.assertRaises(ValueError):
                parse_action(muell)


class TestRoadmapFreigabe(unittest.TestCase):
    def test_guard_keine_directus_calls(self):
        """nr nicht in {1,3,5,7} -> ok=False, KEIN Directus-Aufruf."""
        with mock.patch.object(faas_actions, "_dget", side_effect=AssertionError("kein read erlaubt")), \
             mock.patch.object(faas_actions, "_dwrite", side_effect=AssertionError("kein write erlaubt")):
            for nr in (2, 4, 6, 8, 0, 99, "x", None):
                res = faas_actions.akt_roadmap_freigabe("bajour", nr, True)
                self.assertFalse(res["ok"])
                self.assertEqual(res["fehler"], "station nicht freigebbar")

    def test_rmw_setzt_nur_zielstation(self):
        """Setzt freigegeben fuer nr=3, laesst andere Stationen + deren Felder unangetastet."""
        bestehend = [
            {"nr": 1, "freigegeben": True, "dokument_link": "https://x", "notiz": "n1"},
            {"nr": 5, "freigegeben": False, "dokument_link": None, "notiz": "n5"},
        ]
        gepatcht = {}

        def fake_dget(path):
            return [{"id": "row-1", "stationen": bestehend}]

        def fake_dwrite(method, path, body):
            gepatcht["method"] = method
            gepatcht["path"] = path
            gepatcht["body"] = body
            return {}

        with mock.patch.object(faas_actions, "_dget", side_effect=fake_dget), \
             mock.patch.object(faas_actions, "_dwrite", side_effect=fake_dwrite), \
             mock.patch.object(faas_actions, "_log_aktion"):
            res = faas_actions.akt_roadmap_freigabe("bajour", 3, True, user="tester")

        self.assertTrue(res["ok"])
        self.assertEqual(res["station"], 3)
        self.assertIs(res["freigegeben"], True)
        self.assertEqual(gepatcht["method"], "PATCH")
        self.assertIn("/items/faas_roadmap/row-1", gepatcht["path"])
        stationen = {s["nr"]: s for s in gepatcht["body"]["stationen"]}
        # 8 normalisierte Eintraege.
        self.assertEqual(sorted(stationen), list(range(1, 9)))
        # Zielstation gesetzt.
        self.assertIs(stationen[3]["freigegeben"], True)
        # Station 1 unangetastet (inkl. dokument_link/notiz).
        self.assertIs(stationen[1]["freigegeben"], True)
        self.assertEqual(stationen[1]["dokument_link"], "https://x")
        self.assertEqual(stationen[1]["notiz"], "n1")
        # Station 5 unangetastet.
        self.assertIs(stationen[5]["freigegeben"], False)
        self.assertEqual(stationen[5]["notiz"], "n5")
        # Nicht gesetzte, nicht bestehende Station -> None.
        self.assertIsNone(stationen[2]["freigegeben"])
        self.assertEqual(gepatcht["body"]["aktualisiert_quelle"], "slack")


class TestBaueBlocks(unittest.TestCase):
    def _daten(self):
        # 8 Stationen mit den realen Rollen (1/3/5/7 = medium, 2/4/6/8 abgeleitet).
        rollen = {1: "medium", 2: "wepublish", 3: "medium", 4: "wepublish",
                  5: "medium", 6: "wepublish", 7: "medium", 8: "gemeinsam"}
        stationen = [{"nr": n, "titel": f"Station {n}", "wer": rollen[n],
                      "status": "offen", "freigegeben": False} for n in range(1, 9)]
        antraege = [
            {"id": "a1", "status": "identifiziert", "stiftung_name": "Stiftung Eins", "stiftung_id": "11"},
            {"id": "a2", "status": "in_arbeit", "stiftung_name": "Stiftung Zwei", "stiftung_id": "12"},
        ]
        return {"stationen": stationen, "antraege": antraege}

    def test_block_anzahl_unter_50(self):
        blocks = faas_roadmap_render.baue_blocks("bajour", self._daten())
        self.assertLess(len(blocks), 50)

    def test_medium_stationen_haben_button(self):
        blocks = faas_roadmap_render.baue_blocks("bajour", self._daten())
        # Section-Bloecke der Stationen (header ist der erste Block).
        sektionen = [b for b in blocks if b.get("type") == "section"
                     and b.get("text", {}).get("text", "").startswith("*")]
        # Erste 8 Section-Bloecke sind die Stationen.
        stationsbloecke = sektionen[:8]
        mit_button = [b for b in stationsbloecke
                      if b.get("accessory", {}).get("type") == "button"]
        # genau 4 Medium-Stationen (1/3/5/7) haben einen Button.
        self.assertEqual(len(mit_button), 4)
        # Die We.Publish-/gemeinsam-Stationen (2/4/6/8) haben KEINEN Button.
        ohne_button = [b for b in stationsbloecke if "accessory" not in b]
        self.assertEqual(len(ohne_button), 4)

    def test_antraege_haben_overflow(self):
        blocks = faas_roadmap_render.baue_blocks("bajour", self._daten())
        overflows = [b for b in blocks if b.get("accessory", {}).get("type") == "overflow"]
        self.assertEqual(len(overflows), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
