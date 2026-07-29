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


class TestParseBetragGrenzen(unittest.TestCase):
    def test_range(self):
        self.assertEqual(match_engine._parse_betrag_grenzen("CHF 2'000-165'000"), (2000, 165000))

    def test_fixwert(self):
        self.assertEqual(match_engine._parse_betrag_grenzen("CHF 10.000"), (10000, 10000))

    def test_leer(self):
        self.assertEqual(match_engine._parse_betrag_grenzen(None), (None, None))
        self.assertEqual(match_engine._parse_betrag_grenzen(""), (None, None))


class TestInstitutionalitaetsModifikator(unittest.TestCase):
    def _delta(self, **kw):
        return match_engine._institutionalitaets_modifikator(kw)[0]

    def test_belegter_grossfoerderer_bekommt_bonus(self):
        # Migros-Kulturprozent: belegter breiter Foerderrange, echte Foerderstiftung
        self.assertEqual(self._delta(ist_foerderstiftung=True,
                                     foerdersummen_range="CHF 2'000-165'000",
                                     Stiftungsname="Migros-Kulturprozent"), 8)

    def test_preisstiftung_bekommt_malus(self):
        # Kulturpreis im Namen -> Preis/Einzelperson
        self.assertEqual(self._delta(ist_foerderstiftung=True,
                                     foerdersummen_range="CHF 10.000",
                                     Stiftungsname="GREULICH STIFTUNG KULTURPREIS"), -12)

    def test_evidenzloses_profil_malus(self):
        # halluzinierte Namens-DNA ohne Betrags-Beleg
        self.assertEqual(self._delta(ist_foerderstiftung=True, foerdersummen_range=None,
                                     Stiftungsname="Edi und Brigitt Gysi Stiftung"), -8)

    def test_nicht_foerderer_harter_malus_geclamped(self):
        # ist_foerderstiftung False (-20) + kein Betrag (-8) = -28 -> clamp -25
        self.assertEqual(self._delta(ist_foerderstiftung=False, foerdersummen_range=None,
                                     Stiftungsname="Berti Aschmann Stiftung"), -25)

    def test_fixe_dotation_ohne_preiswort(self):
        self.assertEqual(self._delta(ist_foerderstiftung=True, foerdersummen_range="5000-5000",
                                     Stiftungsname="Beispiel Stiftung"), -10)

    def test_legitimer_kleinfoerderer_bleibt_neutral(self):
        # echte kleine Projektfoerderstiftung mit belegtem (kleinem) Range -> kein Malus, kein Bonus
        self.assertEqual(self._delta(ist_foerderstiftung=True,
                                     foerdersummen_range="CHF 1'000-20'000",
                                     Stiftungsname="Gottfried und Ursula Schaeppi-Jecklin Stiftung"), 0)

    def test_delta_immer_geclamped(self):
        d, info = match_engine._institutionalitaets_modifikator(
            {'ist_foerderstiftung': True, 'foerdersummen_range': "CHF 50'000-500'000", 'Stiftungsname': 'X'})
        self.assertGreaterEqual(d, -25)
        self.assertLessEqual(d, 10)
        self.assertEqual(info['type'], 'institutionalitaet')


class TestWaehleZuBewertende(unittest.TestCase):
    """Vergleichsbasis-Konsistenz (Befund 2026-07-27): bestehende Zeilen duerfen
    nie veralten, auch wenn die Stiftung aus den Top-N faellt."""

    @staticmethod
    def _kand(sid, score):
        return {"stiftung": {"id": sid}, "math_score": score, "exclusion_triggered": False}

    def test_top_n_ohne_bestehende_zeilen(self):
        kand = [self._kand(i, 100 - i) for i in range(5)]
        zu_bewerten, nach = match_engine.waehle_zu_bewertende(kand, {}, 3)
        self.assertEqual([c["stiftung"]["id"] for c in zu_bewerten], [0, 1, 2])
        self.assertEqual(nach, [])

    def test_bestehende_zeile_ausserhalb_top_n_wird_mitbewertet(self):
        """Der Migros-Fall: Rang 5 von 5, aber es gibt schon eine Zeile."""
        kand = [self._kand(i, 100 - i) for i in range(5)]
        zu_bewerten, nach = match_engine.waehle_zu_bewertende(kand, {4: "row-id"}, 3)
        self.assertEqual([c["stiftung"]["id"] for c in zu_bewerten], [0, 1, 2, 4])
        self.assertEqual([c["stiftung"]["id"] for c in nach], [4])

    def test_keine_doppelten_wenn_bestehende_zeile_schon_in_top_n(self):
        kand = [self._kand(i, 100 - i) for i in range(5)]
        zu_bewerten, nach = match_engine.waehle_zu_bewertende(kand, {1: "row-id"}, 3)
        ids = [c["stiftung"]["id"] for c in zu_bewerten]
        self.assertEqual(ids, [0, 1, 2])
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(nach, [])

    def test_ausgeschlossene_bestehende_zeile_wird_aufgefrischt(self):
        """Faellt eine bestehende Zeile in einen Ausschluss, muss sie trotzdem
        neu geschrieben werden, statt mit altem Score liegenzubleiben."""
        kand = [self._kand(0, 90), self._kand(1, 80)]
        kand.append({"stiftung": {"id": 9}, "math_score": 0, "exclusion_triggered": True})
        zu_bewerten, nach = match_engine.waehle_zu_bewertende(kand, {9: "row-id"}, 2)
        self.assertIn(9, [c["stiftung"]["id"] for c in zu_bewerten])
        self.assertEqual([c["stiftung"]["id"] for c in nach], [9])


if __name__ == "__main__":
    unittest.main()


class TestBestehendeZeileFolgtDerWahrheit(unittest.TestCase):
    """Befund 2026-07-27: fiel eine bereits geschriebene Zeile beim Neurechnen unter
    MATCH_MIN_SCORE, wurde sie uebersprungen und behielt ihren alten, hoeheren Score
    dauerhaft. 1047 Zeilen waren so eingefroren, 73 davon im Portal sichtbar.
    Neue Zeilen entstehen weiterhin erst ab der Schwelle."""

    DNA = {"medium_id": "testmedium", "version_id": "v1-test", "tags": [], "id": 1}
    STIFTUNG = {"id": 4242, "Stiftungsname": "Teststiftung", "ist_foerderstiftung": True,
                "foerdersummen_range": None, "kategorie": "", "land": "CH"}

    def _push(self, score, existing, tier="qwen_v3"):
        aufrufe = {"patch": [], "post": []}
        with mock.patch.object(match_engine, "combine_scores", return_value=score), \
             mock.patch.object(match_engine, "_institutionalitaets_modifikator",
                               return_value=(0, {"type": "institutionalitaet", "delta": 0})), \
             mock.patch.object(match_engine, "_stiftungs_geo_modifikator",
                               return_value={"type": "stiftungs_geo_scope"}), \
             mock.patch.object(match_engine, "directus_patch",
                               side_effect=lambda ep, body: aufrufe["patch"].append(ep) or {"ok": True}), \
             mock.patch.object(match_engine, "directus_post",
                               side_effect=lambda ep, body: aufrufe["post"].append(ep) or {"ok": True}), \
             mock.patch.object(match_engine, "MATCH_MIN_SCORE", 10), \
             mock.patch.object(match_engine, "MATCH_MIN_TIER", "qwen_v3"):
            ergebnis = match_engine.push_match_result(
                self.DNA, self.STIFTUNG, math_score=score, math_breakdown={},
                embedding_score=0, llm_score=score, begruendung="test",
                exclusion_triggered=False, exclusion_info=None, run_id="run-test",
                dna_verified=True, dna_quality_tier=tier, sdna_full=None,
                existing_match_ids=existing)
        return ergebnis, aufrufe

    def test_unter_schwelle_mit_bestehender_zeile_wird_fortgeschrieben(self):
        ergebnis, aufrufe = self._push(4, {4242: "row-1"})
        self.assertEqual(aufrufe["patch"], ["/items/match_results/row-1"])
        self.assertEqual(aufrufe["post"], [])
        self.assertNotIn("skipped", ergebnis)

    def test_unter_schwelle_ohne_bestehende_zeile_bleibt_uebersprungen(self):
        ergebnis, aufrufe = self._push(4, {})
        self.assertTrue(ergebnis.get("skipped"))
        self.assertEqual(aufrufe["patch"], [])
        self.assertEqual(aufrufe["post"], [])

    def test_ueber_schwelle_mit_bestehender_zeile_patcht(self):
        _ergebnis, aufrufe = self._push(55, {4242: "row-1"})
        self.assertEqual(aufrufe["patch"], ["/items/match_results/row-1"])
        self.assertEqual(aufrufe["post"], [])

    def test_ueber_schwelle_ohne_bestehende_zeile_legt_neu_an(self):
        _ergebnis, aufrufe = self._push(55, {})
        self.assertEqual(aufrufe["post"], ["/items/match_results"])
        self.assertEqual(aufrufe["patch"], [])

    def test_falscher_tier_mit_bestehender_zeile_wird_fortgeschrieben(self):
        _ergebnis, aufrufe = self._push(55, {4242: "row-1"}, tier="opus_deep")
        self.assertEqual(aufrufe["patch"], ["/items/match_results/row-1"])

    def test_falscher_tier_ohne_bestehende_zeile_bleibt_uebersprungen(self):
        ergebnis, aufrufe = self._push(55, {}, tier="opus_deep")
        self.assertTrue(ergebnis.get("skipped"))
        self.assertEqual(aufrufe["post"], [])


class TestDuplikatHygiene(unittest.TestCase):
    """Befund 2026-07-27: Zeilen als Duplikat markierter Stiftungen sind nie
    Kandidaten und froren daher mit altem Score ein - der Media Forward Fund stand
    unter einer Zweit-ID in allen fuenf Medien doppelt und ueber dem echten Eintrag."""

    def _lauf(self, existing, duplikate):
        geloescht = []
        with mock.patch.object(match_engine, "directus_delete_match_results",
                               side_effect=lambda ids: geloescht.extend(ids) or True):
            n = match_engine.cleanup_duplikat_match_results(existing, duplikate)
        return n, geloescht, existing

    def test_entfernt_nur_duplikate(self):
        existing = {46988: "row-dup", 11991: "row-echt", 4242: "row-x"}
        n, geloescht, rest = self._lauf(existing, {46988})
        self.assertEqual(n, 1)
        self.assertEqual(geloescht, ["row-dup"])
        self.assertEqual(sorted(rest.keys()), [4242, 11991])

    def test_nimmt_geloeschte_aus_der_upsert_map(self):
        """Sonst patcht der Push-Loop danach auf eine geloeschte Zeile."""
        existing = {46988: "row-dup"}
        _n, _g, rest = self._lauf(existing, {46988})
        self.assertNotIn(46988, rest)

    def test_ohne_duplikate_keine_loeschung(self):
        existing = {11991: "row-echt"}
        n, geloescht, rest = self._lauf(existing, {46988})
        self.assertEqual(n, 0)
        self.assertEqual(geloescht, [])
        self.assertEqual(list(rest.keys()), [11991])

    def test_idempotent_beim_zweiten_lauf(self):
        existing = {46988: "row-dup", 11991: "row-echt"}
        self._lauf(existing, {46988})
        n, geloescht, _rest = self._lauf(existing, {46988})
        self.assertEqual(n, 0)
        self.assertEqual(geloescht, [])

    def test_batching_bei_vielen_zeilen(self):
        existing = {1000 + i: f"row-{i}" for i in range(250)}
        duplikate = set(existing.keys())
        n, geloescht, rest = self._lauf(existing, duplikate)
        self.assertEqual(n, 250)
        self.assertEqual(len(geloescht), 250)
        self.assertEqual(rest, {})

    def test_duplikat_ids_parsen(self):
        with mock.patch.object(match_engine, "_psql_run", return_value="46988\n6645\n\n42254\n"):
            match_engine._DUPLIKAT_IDS_CACHE = None
            ids = match_engine.load_duplikat_stiftung_ids()
        match_engine._DUPLIKAT_IDS_CACHE = None
        self.assertEqual(ids, {46988, 6645, 42254})


class TestMediumAusschluesse(unittest.TestCase):
    """Foerderhistorie-Ausschluesse (Design 2026-07-29): das Medium schliesst
    Stiftungen im Portal aus; die Engine ueberspringt sie als Kandidaten und
    raeumt bestehende Zeilen weg (sonst frieren sie ein, wie die Duplikate
    am 27.07.)."""

    def test_load_mapping_nur_wirkliche_ausschluesse(self):
        def fake_get(endpoint, params=None):
            self.assertEqual(endpoint, "/items/medium_foerderhistorie")
            self.assertEqual(params.get("filter[aktiv][_eq]"), "true")
            self.assertEqual(params.get("filter[stiftung_id][_nnull]"), "true")
            return {"data": [
                {"medium_id": "zwolf", "stiftung_id": 100, "typ": "ausgeschlossen", "ausgeschlossen": True},
                {"medium_id": "zwolf", "stiftung_id": 200, "typ": "erhalten", "ausgeschlossen": True},
                # erhalten OHNE Flag: Historie, KEIN Ausschluss
                {"medium_id": "zwolf", "stiftung_id": 300, "typ": "erhalten", "ausgeschlossen": False},
                {"medium_id": "bajour", "stiftung_id": "400", "typ": "ausgeschlossen", "ausgeschlossen": True},
                # kaputte Zeilen: kein Medium / keine parsebare id -> ignoriert
                {"medium_id": "", "stiftung_id": 500, "typ": "ausgeschlossen", "ausgeschlossen": True},
                {"medium_id": "zwolf", "stiftung_id": "abc", "typ": "ausgeschlossen", "ausgeschlossen": True},
            ]}

        with mock.patch.object(match_engine, "directus_get", fake_get):
            mapping = match_engine.load_medium_ausschluesse()
        self.assertEqual(mapping, {"zwolf": {100, 200}, "bajour": {400}})

    def test_load_fehlende_collection_ergibt_leer(self):
        def fake_get(endpoint, params=None):
            raise RuntimeError("HTTP 403: collection missing")

        with mock.patch.object(match_engine, "directus_get", fake_get):
            mapping = match_engine.load_medium_ausschluesse()
        self.assertEqual(mapping, {})

    def test_cleanup_loescht_und_bereinigt_upsert_map(self):
        seen_params = {}
        geloescht = []

        def fake_get(endpoint, params=None):
            seen_params.update(params or {})
            return {"data": [{"id": 11}, {"id": 22}]}

        def fake_delete(ids):
            geloescht.extend(ids)
            return True

        existing = {100: "row-a", 300: "row-b"}
        with mock.patch.object(match_engine, "directus_get", fake_get), \
             mock.patch.object(match_engine, "directus_delete_match_results", fake_delete):
            n = match_engine.cleanup_ausschluss_match_results("zwolf", {100, 200}, existing)

        self.assertEqual(n, 2)
        self.assertEqual(geloescht, [11, 22])
        # 100 ist ausgeschlossen -> raus aus der UPSERT-Map; 300 bleibt.
        self.assertEqual(existing, {300: "row-b"})
        # Query trifft ALLE DNA-Versionen des Mediums, nur projektfreie Zeilen.
        self.assertEqual(seen_params.get("filter[medium_id][_eq]"), "zwolf")
        self.assertEqual(seen_params.get("filter[stiftung_id][_in]"), "100,200")
        self.assertEqual(seen_params.get("filter[projekt_id][_null]"), "true")
        self.assertNotIn("filter[medium_dna_version_id][_neq]", seen_params)

    def test_cleanup_ohne_ausschluesse_ist_noop(self):
        with mock.patch.object(match_engine, "directus_get",
                               side_effect=AssertionError("darf nicht lesen")):
            n = match_engine.cleanup_ausschluss_match_results("zwolf", set(), {1: "x"})
        self.assertEqual(n, 0)


class TestTrefferRueckmeldungen(unittest.TestCase):
    """Rueckmeldungen zu einem Treffer (29.07.2026): Operator sofort aktiv,
    Portal erst nach Freigabe. Nur aktive Zeilen wirken; sie stehen verbindlich
    im Prompt und tragen ihren Fingerabdruck im Cache-Key."""

    def setUp(self):
        match_engine._RUECKMELDUNGEN_CACHE = None

    def tearDown(self):
        match_engine._RUECKMELDUNGEN_CACHE = None

    def _dna(self):
        return {"medium_id": "cueltuer", "medium_name": "Cueltuer", "version_id": "v-test",
                "sound_feeling": "Kulturjournalismus", "tags": [], "exclusion_tags": [],
                "foerderpraxis": {}}

    def _stiftung(self):
        return {"id": 11991, "Stiftungsname": "Media Forward Fund", "sitz": "Bern",
                "land": "CH", "zwecktext": "Medienfoerderung", "foerderbedingungen": ""}

    def test_loader_nimmt_nur_aktive_und_filtert_kategorie(self):
        gesehen = {}

        def fake_get(endpoint, params=None):
            gesehen.update(params or {})
            return {"data": [
                {"medium_id": "cueltuer", "stiftung_id": "11991", "notiz": "Foerdert nur Print.", "ts": "2026-07-29T10:00:00"},
                {"medium_id": "cueltuer", "stiftung_id": "11991", "notiz": "Zweite Notiz.", "ts": "2026-07-28T10:00:00"},
                {"medium_id": "zwolf", "stiftung_id": "6651", "notiz": "Region passt nicht.", "ts": "2026-07-29T09:00:00"},
                # unbrauchbar: leere Notiz / kaputte id -> ignoriert
                {"medium_id": "zwolf", "stiftung_id": "6651", "notiz": "  ", "ts": "2026-07-29T08:00:00"},
                {"medium_id": "zwolf", "stiftung_id": "abc", "notiz": "kaputt", "ts": "2026-07-29T08:00:00"},
            ]}

        with mock.patch.object(match_engine, "directus_get", fake_get):
            mapping = match_engine.load_match_rueckmeldungen()

        # Der Filter muss BEIDES verlangen: die Kategorie und aktiv=true
        # (sonst wirkten nicht freigegebene Portal-Rueckmeldungen mit).
        self.assertEqual(gesehen.get("filter[kategorie][_eq]"), "match_rueckmeldung")
        self.assertEqual(gesehen.get("filter[aktiv][_eq]"), "true")
        self.assertEqual(mapping[("cueltuer", 11991)], ["Foerdert nur Print.", "Zweite Notiz."])
        self.assertEqual(mapping[("zwolf", 6651)], ["Region passt nicht."])

    def test_loader_ohne_collection_ergibt_leer(self):
        with mock.patch.object(match_engine, "directus_get", side_effect=RuntimeError("HTTP 403")):
            self.assertEqual(match_engine.load_match_rueckmeldungen(), {})

    def test_prompt_traegt_rueckmeldung_und_kriterium_null(self):
        prompt = match_engine.build_match_prompt(
            self._dna(), self._stiftung(), math_score=80,
            rueckmeldungen=["Foerdert ausschliesslich Print, wir sind rein digital."])
        self.assertIn("RUECKMELDUNG ZU GENAU DIESEM PAAR", prompt)
        self.assertIn("Foerdert ausschliesslich Print", prompt)
        self.assertIn("Rueckmeldungs-Check", prompt)
        self.assertIn("Score <= 15", prompt)

    def test_prompt_ohne_rueckmeldung_unveraendert(self):
        ohne = match_engine.build_match_prompt(self._dna(), self._stiftung(), math_score=80)
        leer = match_engine.build_match_prompt(self._dna(), self._stiftung(), math_score=80, rueckmeldungen=[])
        self.assertEqual(ohne, leer)
        self.assertNotIn("RUECKMELDUNG ZU GENAU DIESEM PAAR", ohne)

    def test_fmt_deckelt_und_ueberspringt_leere(self):
        block = match_engine._fmt_rueckmeldungen(["  ", "eins", "", "zwei", "drei", "vier", "fuenf", "sechs"])
        self.assertIn("- eins", block)
        self.assertIn("- fuenf", block)
        self.assertNotIn("- sechs", block)

    def test_cache_key_traegt_rueckmeldungs_fingerabdruck(self):
        """Neue Rueckmeldung -> anderer Cache-Key -> alter Score gilt nicht mehr."""
        gesehene_modelle = []

        def fake_lookup(mdv, sid, sdv, model=None):
            gesehene_modelle.append(model)
            return None

        def fake_llm(prompt):
            return {"score": 12, "begruendung": "Passt nicht."}

        with mock.patch.object(match_engine, "cache_lookup", fake_lookup), \
             mock.patch.object(match_engine, "cache_write", lambda *a, **k: True), \
             mock.patch.object(match_engine, "_llm_call_ollama", fake_llm):
            match_engine.compute_llm_score(self._dna(), self._stiftung(), 80, "sdna-1")
            match_engine.compute_llm_score(self._dna(), self._stiftung(), 80, "sdna-1",
                                           rueckmeldungen=["Foerdert nur Print."])
            match_engine.compute_llm_score(self._dna(), self._stiftung(), 80, "sdna-1",
                                           rueckmeldungen=["Andere Rueckmeldung."])

        ohne, mit_a, mit_b = gesehene_modelle
        self.assertEqual(ohne, match_engine.ACTIVE_MODEL)
        self.assertTrue(mit_a.startswith(match_engine.ACTIVE_MODEL + "+fb"))
        self.assertNotEqual(mit_a, mit_b, "verschiedene Rueckmeldungen brauchen verschiedene Cache-Keys")

    def test_cache_key_stabil_bei_gleicher_rueckmeldung(self):
        """Gleiche Rueckmeldung im naechsten Lauf -> Cache greift wieder."""
        modelle = []
        with mock.patch.object(match_engine, "cache_lookup",
                               lambda mdv, sid, sdv, model=None: modelle.append(model) or None), \
             mock.patch.object(match_engine, "cache_write", lambda *a, **k: True), \
             mock.patch.object(match_engine, "_llm_call_ollama", lambda p: {"score": 12, "begruendung": "x"}):
            match_engine.compute_llm_score(self._dna(), self._stiftung(), 80, "s1", rueckmeldungen=["gleich"])
            match_engine.compute_llm_score(self._dna(), self._stiftung(), 80, "s1", rueckmeldungen=["gleich"])
        self.assertEqual(modelle[0], modelle[1])
