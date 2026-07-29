#!/usr/bin/env python3
"""Deterministische Unit-Tests fuer projekt_matcher (kein Netz, kein LLM).

Kern: die Projekt-DNA wird mit der Medien-DNA KOMBINIERT (Auftrag 29.07.2026,
Anlass bajour/dorfkoenig). Das Projekt fuehrt inhaltlich, das Traeger-Medium
liefert Region, Publikum, Haltung und Tabus.

Lauf:  python3 -m unittest pipeline.tests.test_projekt_matcher_unit  (vom Repo-Root)
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "spark"))

os.environ.setdefault("DIRECTUS_TOKEN", "test-token")
os.environ["PG_REMOTE_SSH"] = "faas-vps-psql"

import projekt_matcher as pm  # noqa: E402


def tag(slug, gewicht, begruendung="weil"):
    return {"tag_slug": slug, "gewicht": gewicht, "begruendung": begruendung, "evidenz": []}


class TestKombiniereTags(unittest.TestCase):
    def test_projekt_tags_bleiben_unveraendert(self):
        projekt = [tag("klima", 3), tag("datenjournalismus", 2)]
        kombiniert = pm.kombiniere_tags(projekt, [])
        self.assertEqual([(t["tag_slug"], t["gewicht"]) for t in kombiniert],
                         [("klima", 3), ("datenjournalismus", 2)])

    def test_medien_tags_kommen_abgeschwaecht_dazu(self):
        projekt = [tag("klima", 3)]
        medium = [tag("lokaljournalismus", 3), tag("kultur", 2), tag("randthema", 1)]
        kombiniert = pm.kombiniere_tags(projekt, medium)
        gewichte = {t["tag_slug"]: t["gewicht"] for t in kombiniert}
        self.assertEqual(gewichte["klima"], 3, "Projekt-Tag unveraendert")
        self.assertEqual(gewichte["lokaljournalismus"], 2, "Kernthema des Mediums (3) wirkt wie 2")
        self.assertEqual(gewichte["kultur"], 1, "wichtiges Thema (2) wirkt wie 1")
        self.assertNotIn("randthema", gewichte, "Randthemen des Mediums fallen weg (nur Rauschen)")

    def test_bei_ueberschneidung_gewinnt_das_projekt(self):
        """Dasselbe Thema in beiden DNAs darf sich NICHT aufaddieren."""
        projekt = [tag("klima", 1)]
        medium = [tag("klima", 3)]
        kombiniert = pm.kombiniere_tags(projekt, medium)
        self.assertEqual(len(kombiniert), 1)
        self.assertEqual(kombiniert[0]["gewicht"], 1)

    def test_herkunft_steht_in_der_begruendung(self):
        kombiniert = pm.kombiniere_tags([], [tag("lokaljournalismus", 3, "Kern der Redaktion")])
        self.assertTrue(kombiniert[0]["begruendung"].startswith("Traeger-Medium:"))
        self.assertIn("Kern der Redaktion", kombiniert[0]["begruendung"])
        self.assertEqual(kombiniert[0]["evidenz"], ["medium-dna"])

    def test_ohne_medien_dna_unveraendert(self):
        projekt = [tag("klima", 3)]
        self.assertEqual(pm.kombiniere_tags(projekt, None), projekt)
        self.assertEqual(pm.kombiniere_tags(projekt, []), projekt)

    def test_kaputte_eintraege_kippen_nichts(self):
        kombiniert = pm.kombiniere_tags(
            [tag("klima", 3), {"gewicht": 2}],                       # ohne slug
            [{"tag_slug": "medium_x", "gewicht": "3"},               # Gewicht als String
             {"tag_slug": "medium_y", "gewicht": None},              # unbrauchbar -> 1 -> faellt weg
             {"tag_slug": None, "gewicht": 3}])                      # ohne slug
        slugs = {t["tag_slug"] for t in kombiniert}
        self.assertEqual(slugs, {"klima", "medium_x"})

    def test_eingaben_werden_nicht_mutiert(self):
        projekt = [tag("klima", 3)]
        medium = [tag("lokaljournalismus", 3)]
        pm.kombiniere_tags(projekt, medium)
        self.assertEqual(projekt, [tag("klima", 3)])
        self.assertEqual(medium, [tag("lokaljournalismus", 3)])


class TestKombiniereExclusions(unittest.TestCase):
    def test_tabus_des_mediums_gelten_auch_fuer_das_projekt(self):
        projekt = [{"tag_slug": "werbung", "begruendung": "keine Werbeinhalte"}]
        medium = [{"tag_slug": "gluecksspiel", "begruendung": "Redaktionsgrundsatz"}]
        kombiniert = pm.kombiniere_exclusions(projekt, medium)
        slugs = {t["tag_slug"] for t in kombiniert}
        self.assertEqual(slugs, {"werbung", "gluecksspiel"})

    def test_keine_duplikate_projekt_gewinnt(self):
        projekt = [{"tag_slug": "werbung", "begruendung": "Projekt-Grund"}]
        medium = [{"tag_slug": "werbung", "begruendung": "Medium-Grund"}]
        kombiniert = pm.kombiniere_exclusions(projekt, medium)
        self.assertEqual(len(kombiniert), 1)
        self.assertEqual(kombiniert[0]["begruendung"], "Projekt-Grund")

    def test_leere_eingaben(self):
        self.assertEqual(pm.kombiniere_exclusions([], []), [])
        self.assertEqual(pm.kombiniere_exclusions(None, None), [])


class TestMessPrompt(unittest.TestCase):
    def _projekt(self):
        return {"name": "Dorfkoenig", "medium_id": "bajour", "slug": "bajour-dorfkoenig",
                "beschreibung": "Eine Serie ueber Machtstrukturen in Gemeinden."}

    def test_ohne_medien_dna_kein_traeger_block(self):
        prompt = pm.build_projekt_user(self._projekt())
        self.assertIn("Dorfkoenig", prompt)
        self.assertNotIn("TRAEGER-MEDIUM", prompt)

    def test_mit_medien_dna_traeger_block_nachgeordnet(self):
        m_dna = {"sound_feeling": "Basler Stadtmagazin mit Haltung.",
                 "tags": [tag("lokaljournalismus", 3), tag("randthema", 1)]}
        prompt = pm.build_projekt_user(self._projekt(), m_dna)
        self.assertIn("TRAEGER-MEDIUM", prompt)
        self.assertIn("Basler Stadtmagazin", prompt)
        self.assertIn("lokaljournalismus", prompt)
        # Nur Kernthemen (Gewicht 3) als Kontext, keine Randthemen.
        kontext_teil = prompt.split("TRAEGER-MEDIUM")[1].split("VERFUEGBARE")[0]
        self.assertNotIn("randthema", kontext_teil)
        # Die Projektbeschreibung steht VOR dem Traeger-Block.
        self.assertLess(prompt.index("Machtstrukturen"), prompt.index("TRAEGER-MEDIUM"))
        self.assertIn("NICHT ueberschreiben", prompt)


if __name__ == "__main__":
    unittest.main()
