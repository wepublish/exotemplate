#!/usr/bin/env python3
"""Unit-Tests fuer das Schliessen ueberholter Waechter-Vorschlaege (kein Netz).

Hintergrund (Befund 2026-07-27): der Waechter legt Wochenmeldungen je Woche neu
an und schliesst die alte nie; abgelaufene Fristmeldungen bleiben ebenfalls
offen stehen. Ergebnis waren vier gleichzeitig offene Sichtungs-Stau-Meldungen
und je drei abgelaufene Fristmeldungen fuer JournaFONDS und netidee.

Lauf:  python3 -m unittest discover -s pipeline/tests
"""
import os
import sys
import unittest
from datetime import date
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "spark"))

os.environ.setdefault("DIRECTUS_TOKEN", "test-token")

import faas_waechter  # noqa: E402


class TestUeberholteFinden(unittest.TestCase):
    HEUTE = date(2026, 7, 27)

    def _finde(self, offen, ausschreibungen=None, applications=None):
        def fake_get(pfad):
            if "/items/ausschreibungen" in pfad:
                return ausschreibungen or []
            if "/items/applications" in pfad:
                return applications or []
            return []
        with mock.patch.object(faas_waechter, "_get", side_effect=fake_get), \
             mock.patch.object(faas_waechter, "_heute", return_value=self.HEUTE):
            return faas_waechter._ueberholte_finden(offen)

    def test_nur_juengste_wochenmeldung_bleibt(self):
        offen = [
            {"id": "w28", "typ": "hygiene", "ts": "2026-07-08T06:00:00Z", "titel": "Stau 30", "dedup_key": "stau|2026-W28"},
            {"id": "w29", "typ": "hygiene", "ts": "2026-07-14T06:00:00Z", "titel": "Stau 56", "dedup_key": "stau|2026-W29"},
            {"id": "w31", "typ": "hygiene", "ts": "2026-07-27T06:00:00Z", "titel": "Stau 56", "dedup_key": "stau|2026-W31"},
        ]
        ids = {i for i, _ in self._finde(offen)}
        self.assertEqual(ids, {"w28", "w29"})

    def test_wochenpraefixe_werden_getrennt_behandelt(self):
        offen = [
            {"id": "s1", "typ": "hygiene", "ts": "2026-07-08T06:00:00Z", "titel": "Stau", "dedup_key": "stau|2026-W28"},
            {"id": "s2", "typ": "hygiene", "ts": "2026-07-27T06:00:00Z", "titel": "Stau", "dedup_key": "stau|2026-W31"},
            {"id": "g1", "typ": "hygiene", "ts": "2026-07-08T06:00:00Z", "titel": "Gold", "dedup_key": "goldentwurf|2026-W28"},
            {"id": "g2", "typ": "hygiene", "ts": "2026-07-27T06:00:00Z", "titel": "Gold", "dedup_key": "goldentwurf|2026-W31"},
        ]
        ids = {i for i, _ in self._finde(offen)}
        self.assertEqual(ids, {"s1", "g1"})

    def test_abgelaufene_ausschreibungs_frist_wird_geschlossen(self):
        offen = [
            {"id": "f1", "typ": "frist", "ts": "2026-06-13T06:00:00Z", "titel": "JournaFONDS 2 Tage",
             "dedup_key": "frist|wepublish|aussch|1|2"},
            {"id": "f2", "typ": "frist", "ts": "2026-07-23T06:00:00Z", "titel": "Environmental 14 Tage",
             "dedup_key": "frist|wepublish|aussch|14|14"},
        ]
        gefunden = self._finde(offen, ausschreibungen=[
            {"id": 1, "deadline": "2026-06-15"},     # vorbei
            {"id": 14, "deadline": "2026-08-06"},    # noch offen
        ])
        self.assertEqual({i for i, _ in gefunden}, {"f1"})

    def test_abgelaufene_antrags_frist_wird_geschlossen(self):
        offen = [{"id": "a1", "typ": "frist", "ts": "2026-06-01T06:00:00Z", "titel": "Antrag",
                  "dedup_key": "frist|app|77|7"}]
        gefunden = self._finde(offen, applications=[{"id": 77, "frist": "2026-06-10"}])
        self.assertEqual({i for i, _ in gefunden}, {"a1"})

    def test_hygiene_ohne_wochenpraefix_bleibt_unangetastet(self):
        """«Medium vmz hat keine aktive DNA» ist ein Dauerbefund, kein Wochenschnappschuss."""
        offen = [
            {"id": "h1", "typ": "hygiene", "ts": "2026-06-04T06:00:00Z", "titel": "vmz ohne DNA",
             "dedup_key": "hygiene|vmz|DNA fehlt"},
            {"id": "h2", "typ": "hygiene", "ts": "2026-07-08T06:00:00Z", "titel": "zwolf ohne DNA",
             "dedup_key": "hygiene|zwolf|DNA fehlt"},
        ]
        self.assertEqual(self._finde(offen), [])

    def test_frist_ohne_auffindbaren_termin_bleibt_offen(self):
        """Lieber stehen lassen als auf Verdacht schliessen."""
        offen = [{"id": "f9", "typ": "frist", "ts": "2026-06-01T06:00:00Z", "titel": "unbekannt",
                  "dedup_key": "frist|wepublish|aussch|999|7"}]
        self.assertEqual(self._finde(offen, ausschreibungen=[]), [])

    def test_leere_liste(self):
        self.assertEqual(self._finde([]), [])


if __name__ == "__main__":
    unittest.main()
