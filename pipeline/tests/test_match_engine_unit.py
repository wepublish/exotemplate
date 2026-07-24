#!/usr/bin/env python3
"""Deterministische Unit-Tests fuer match_engine (kein Netz, kein LLM).

Abgedeckt (Praezisions-Welle 2026-07-24):
  1. Cache-Key traegt die Prompt-Version -> Prompt-Aenderung invalidiert den Cache.
  2. build_match_prompt enthaelt den Preis-/Einzelpersonen-Malus und das
     Institutionalitaets-Kriterium (Ramonas Praezisions-Feedback).
  3. Daten-Loads gehen an die VPS (PG_REMOTE_SSH), der LLM-Cache bleibt lokal.
  4. cleanup_stale_match_results loescht nur Zeilen fremder DNA-Versionen
     (projektfreie), nie die der aktiven Version.
  5. Regression: combine_scores-Umverteilung.

Lauf:  python3 -m unittest pipeline.tests.test_match_engine_unit  (vom Repo-Root)
"""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "spark"))

os.environ.setdefault("DIRECTUS_TOKEN", "test-token")
os.environ["PG_REMOTE_SSH"] = "faas-vps-psql"  # vor Import: Modul liest Env beim Laden

import match_engine  # noqa: E402


class TestCacheKeyPromptVersion(unittest.TestCase):
    def test_active_model_traegt_prompt_version(self):
        """Cache-Key (ACTIVE_MODEL) muss die Prompt-Version tragen."""
        self.assertRegex(
            match_engine.ACTIVE_MODEL, r"\+p\d+$",
            "ACTIVE_MODEL muss mit +p<PROMPT_VERSION> enden, sonst ueberlebt der "
            "alte Score-Cache jede Prompt-Aenderung")

    def test_vllm_model_bleibt_roh(self):
        """Der vLLM-API-Call darf NICHT den Cache-Suffix bekommen."""
        self.assertNotIn("+p", match_engine.VLLM_MODEL)


class TestPromptPraezision(unittest.TestCase):
    def _mini_dna(self):
        return {"medium_id": "cueltuer", "medium_name": "Cueltuer",
                "version_id": "v-test", "sound_feeling": "Kulturjournalismus",
                "tags": [{"tag_slug": "kulturjournalismus", "gewicht": 3,
                          "begruendung": "Kern"}],
                "exclusion_tags": [], "foerderpraxis": {}}

    def _mini_stiftung(self):
        return {"id": 1, "Stiftungsname": "Teststiftung", "sitz": "Bern",
                "land": "CH", "zwecktext": "Kulturpreis", "foerderbedingungen": ""}

    def test_prompt_enthaelt_preis_malus(self):
        prompt = match_engine.build_match_prompt(
            self._mini_dna(), self._mini_stiftung(), math_score=40, sdna_full=None)
        self.assertIn("Einzelpersonen", prompt)
        self.assertIn("Preise", prompt)

    def test_prompt_enthaelt_institutionalitaet(self):
        prompt = match_engine.build_match_prompt(
            self._mini_dna(), self._mini_stiftung(), math_score=40, sdna_full=None)
        self.assertIn("institutionell", prompt.lower())

    def test_prompt_enthaelt_beide_bloecke(self):
        prompt = match_engine.build_match_prompt(
            self._mini_dna(), self._mini_stiftung(), math_score=40, sdna_full=None)
        self.assertIn("Cueltuer", prompt)
        self.assertIn("Teststiftung", prompt)


class TestPsqlRouting(unittest.TestCase):
    def _capture(self):
        calls = []

        def fake_run(cmd, **kwargs):
            calls.append(cmd)
            m = mock.Mock()
            m.returncode = 0
            m.stdout = ""
            m.stderr = ""
            return m
        return calls, fake_run

    def test_daten_load_geht_remote(self):
        calls, fake = self._capture()
        with mock.patch.object(match_engine.subprocess, "run", fake):
            match_engine.load_active_stiftungs_dna_map()
        self.assertTrue(calls, "kein subprocess-Aufruf")
        self.assertEqual(calls[0][0], "ssh",
                         "Daten-Loads muessen bei gesetztem PG_REMOTE_SSH per ssh "
                         "an die VPS gehen (nicht an die eingefrorene Spark-DB)")
        self.assertIn("faas-vps-psql", calls[0])

    def test_cache_bleibt_lokal(self):
        calls, fake = self._capture()
        with mock.patch.object(match_engine.subprocess, "run", fake):
            match_engine.cache_lookup("v-x", 42, "sdna-v1")
        self.assertTrue(calls, "kein subprocess-Aufruf")
        self.assertEqual(calls[0][0], "docker",
                         "Der LLM-Cache ist pipeline-lokaler Zustand und bleibt im "
                         "lokalen Postgres-Container")


class TestCleanupStaleVersions(unittest.TestCase):
    def test_loescht_nur_fremde_versionen(self):
        deleted = []

        def fake_get(endpoint, params=None):
            # Zwei stale Zeilen, projektfrei
            return {"data": [{"id": 111}, {"id": 222}]}

        def fake_delete(ids):
            deleted.extend(ids)
            return True

        with mock.patch.object(match_engine, "directus_get", fake_get), \
             mock.patch.object(match_engine, "directus_delete_match_results", fake_delete):
            n = match_engine.cleanup_stale_match_results("cueltuer", "v11-aktiv")
        self.assertEqual(n, 2)
        self.assertEqual(deleted, [111, 222])

    def test_filter_schuetzt_aktive_version_und_projekte(self):
        seen_params = {}

        def fake_get(endpoint, params=None):
            seen_params.update(params or {})
            return {"data": []}

        with mock.patch.object(match_engine, "directus_get", fake_get):
            match_engine.cleanup_stale_match_results("cueltuer", "v11-aktiv")
        self.assertEqual(seen_params.get("filter[medium_dna_version_id][_neq]"), "v11-aktiv")
        self.assertEqual(seen_params.get("filter[projekt_id][_null]"), "true")
        self.assertEqual(seen_params.get("filter[medium_id][_eq]"), "cueltuer")


class TestZeilenweiseLoader(unittest.TestCase):
    """Die grossen Loads muessen zeilenweise streamen (ein JSON-Objekt pro Zeile).
    json_agg als EIN Riesenwert hat den VPS-Postgres beim 40k-Load gekippt."""

    def test_load_stiftungen_parst_zeilenweise(self):
        fake_out = ('{"id": 1, "Stiftungsname": "A"}\n'
                    '{"id": 2, "Stiftungsname": "B"}\n')
        with mock.patch.object(match_engine, "_psql_run", return_value=fake_out) as p:
            rows = match_engine.load_stiftungen()
        self.assertEqual([r["id"] for r in rows], [1, 2])
        sql = p.call_args[0][0].lower()
        self.assertNotIn("json_agg", sql, "kein json_agg-Riesenwert mehr")

    def test_load_dna_full_parst_zeilenweise(self):
        fake_out = ('{"stiftung_id": 7, "stiftung_name": "X", "tags": []}\n'
                    '{"stiftung_id": 8, "stiftung_name": "Y", "tags": []}\n')
        with mock.patch.object(match_engine, "_psql_run", return_value=fake_out) as p:
            out = match_engine.load_active_stiftungs_dna_full()
        self.assertEqual(sorted(out.keys()), [7, 8])
        sql = p.call_args[0][0].lower()
        self.assertNotIn("json_agg", sql, "kein json_agg-Riesenwert mehr")


class TestCombineScoresRegression(unittest.TestCase):
    def test_umverteilung_bei_fehlender_komponente(self):
        with mock.patch.object(match_engine, "MATH_WEIGHT", 0.10), \
             mock.patch.object(match_engine, "EMBEDDING_WEIGHT", 0.10), \
             mock.patch.object(match_engine, "LLM_WEIGHT", 0.80):
            self.assertEqual(match_engine.combine_scores(50, None, 90), 86)
            self.assertEqual(match_engine.combine_scores(None, None, 70), 70)
            self.assertEqual(match_engine.combine_scores(None, None, None), 0)


if __name__ == "__main__":
    unittest.main()
