"""Validate the hand-written 1.1.0-draft.1 review fixtures, not a production serving layer.

This extends 1.0.0-draft.1 (tests/test_serve_contract.py) additively: that file and
its fixtures are untouched by this version. See docs/serve-contract-1.1.md and
docs/decision-log.md ("Frontend design import") for why this version exists.
"""

from copy import deepcopy
from datetime import date
from pathlib import Path
import unittest

from sectors.registry import strict_json

FIXTURES = Path(__file__).parent / "fixtures"
VERSION = "1.1.0-draft.1"
MAX_EXACT_INTEGER = 9007199254740991
DEMO_SYMBOLS = {"BBCA", "BBRI", "BMRI", "BBNI", "TLKM", "ASII", "ICBP", "INDF", "ANTM", "MDKA"}
COHORTS = {"institutional", "retail", "mixed", "unknown"}

# Field paths serve_narrative.grounded_in may cite. Dotted paths reach into nested
# component blocks; bare names are top-level record fields on the named output.
ALLOWED_FIELD_PATHS = {
    "serve_alert_evidence.buy_value", "serve_alert_evidence.sell_value",
    "serve_alert_evidence.net_value",
    "serve_components.coverage.matched_share",
    "serve_components.coverage.cohorts_available", "serve_components.coverage.cohorts_total",
    "serve_components.concentration.share", "serve_components.concentration.baseline_share",
    "serve_components.concentration.top_n", "serve_components.concentration.band",
    "serve_components.breadth.changed", "serve_components.breadth.active",
    "serve_components.breadth.share", "serve_components.breadth.baseline_share",
    "serve_components.persistence.same_direction", "serve_components.persistence.of_sessions",
    "serve_components.persistence.longest_run",
    "serve_position.close", "serve_position.sector", "serve_position.name",
    "serve_run.window", "serve_run.trade_date", "serve_run.data_date",
}


def load(name):
    return strict_json((FIXTURES / name).read_bytes())


class Serve11ContractTests(unittest.TestCase):
    def setUp(self):
        self.run = load("serve_run_v11.json")
        self.positions = load("serve_position_v11.json")
        self.alerts = load("serve_alert_v11.json")
        self.evidence = load("serve_alert_evidence_v11.json")
        self.components = load("serve_components_v11.json")
        self.flow_series = load("serve_flow_series_v11.json")
        self.peer_screen = load("serve_peer_screen_v11.json")
        self.narrative = load("serve_narrative_v11.json")

    # ---- shared helpers ----

    def assert_text(self, value):
        self.assertIsInstance(value, str)
        self.assertTrue(value.strip())

    def assert_unique_strings(self, values):
        self.assertIsInstance(values, list)
        for value in values:
            self.assert_text(value)
        self.assertEqual(len(values), len(set(values)))

    def assert_symbol(self, symbol):
        self.assert_text(symbol)
        self.assertRegex(symbol, r"^[A-Z]+$")
        self.assertIn(symbol, DEMO_SYMBOLS)

    def assert_trade_date(self, value):
        self.assertIsInstance(value, str)
        self.assertEqual(date.fromisoformat(value).isoformat(), value)

    def assert_envelope(self, envelope, output):
        self.assertEqual(set(envelope), {
            "contract_version", "contract_status", "output", "data_kind", "description", "records"})
        self.assertEqual(envelope["contract_version"], VERSION)
        self.assertEqual(envelope["contract_status"], "UNDER_REVIEW")
        self.assertEqual(envelope["output"], output)
        self.assertEqual(envelope["data_kind"], "SYNTHETIC_EXAMPLE")
        self.assert_text(envelope["description"])
        self.assertIsInstance(envelope["records"], list)

    def assert_money_or_none(self, value, allow_negative=True):
        if value is None:
            return
        self.assertIs(type(value), int)
        self.assertLessEqual(abs(value), MAX_EXACT_INTEGER)
        if not allow_negative:
            self.assertGreaterEqual(value, 0)

    # ---- serve_run ----

    def assert_run(self, row):
        self.assertEqual(set(row), {
            "data_date", "trade_date", "window", "symbols_requested",
            "symbols_matched", "cohorts_unavailable"})
        self.assert_trade_date(row["data_date"])
        self.assert_trade_date(row["trade_date"])
        self.assertEqual(set(row["window"]), {"sessions", "start", "end"})
        self.assertIs(type(row["window"]["sessions"]), int)
        self.assertGreater(row["window"]["sessions"], 0)
        self.assert_trade_date(row["window"]["start"])
        self.assert_trade_date(row["window"]["end"])
        self.assertLessEqual(row["window"]["start"], row["window"]["end"])
        self.assertIs(type(row["symbols_requested"]), int)
        self.assertIs(type(row["symbols_matched"]), int)
        self.assertLessEqual(row["symbols_matched"], row["symbols_requested"])
        self.assertIs(type(row["cohorts_unavailable"]), int)
        self.assertGreaterEqual(row["cohorts_unavailable"], 0)

    def test_run_fixture_shape(self):
        self.assert_envelope(self.run, "serve_run")
        self.assertEqual(len(self.run["records"]), 1)
        for row in self.run["records"]:
            self.assert_run(row)
            self.assertEqual(row["symbols_requested"], 10)
            self.assertEqual(row["symbols_matched"], 10)

    # ---- serve_position ----

    def assert_position(self, row):
        self.assertEqual(set(row), {
            "symbol", "name", "sector", "close", "close_date", "currency",
            "value_status", "reason_codes"})
        self.assert_symbol(row["symbol"])
        self.assert_text(row["name"])
        self.assert_text(row["sector"])
        self.assertEqual(row["currency"], "IDR")
        self.assertIn(row["value_status"], {"AVAILABLE", "UNAVAILABLE"})
        self.assert_unique_strings(row["reason_codes"])
        if row["value_status"] == "AVAILABLE":
            self.assertIs(type(row["close"]), int)
            self.assertGreater(row["close"], 0)
            self.assert_trade_date(row["close_date"])
            self.assertEqual(row["reason_codes"], [])
        else:
            self.assertIsNone(row["close"])
            self.assertIsNone(row["close_date"])
            self.assertEqual(row["reason_codes"], ["PRICE_NOT_YET_INGESTED"])

    def test_position_fixture_covers_full_demo_universe_with_one_unavailable(self):
        self.assert_envelope(self.positions, "serve_position")
        rows = self.positions["records"]
        self.assertEqual({r["symbol"] for r in rows}, DEMO_SYMBOLS)
        self.assertEqual(len(rows), len(DEMO_SYMBOLS))
        for row in rows:
            self.assert_position(row)
        unavailable = [r for r in rows if r["value_status"] == "UNAVAILABLE"]
        self.assertEqual(len(unavailable), 1)
        self.assertEqual(unavailable[0]["symbol"], "MDKA")

    # ---- serve_alert / serve_alert_evidence (same shape as 1.0.0-draft.1) ----

    def assert_alert(self, row):
        self.assertEqual(set(row), {"symbol", "trade_date", "signal_state", "score", "severity",
            "scoring_status", "reason_codes", "summary", "qualification", "evidence_ids"})
        self.assert_symbol(row["symbol"])
        self.assert_trade_date(row["trade_date"])
        self.assertEqual(row["signal_state"], "NOT_EVALUATED")
        self.assertEqual(row["scoring_status"], "PENDING_DEFINITION")
        self.assertIsNone(row["score"])
        self.assertIsNone(row["severity"])
        self.assertEqual(set(row["reason_codes"]), {"SCORING_NOT_DEFINED", "SEVERITY_NOT_DEFINED"})
        self.assert_text(row["summary"])
        self.assert_unique_strings(row["evidence_ids"])
        quality = row["qualification"]
        self.assertEqual(set(quality), {"operational_completeness", "safe_for_demo_analysis", "schema_status",
            "population_status", "external_reconciliation", "externally_proven_complete", "reason_codes"})
        self.assertEqual(quality["safe_for_demo_analysis"], quality["operational_completeness"] == "PASS")
        self.assertIs(quality["externally_proven_complete"], False)

    def assert_evidence(self, row):
        self.assertEqual(set(row), {"evidence_id", "symbol", "trade_date", "cohort", "buy_value",
            "sell_value", "net_value", "currency", "evidence_type", "value_status", "reason_codes",
            "classification_basis", "market_scope_status", "title", "explanation"})
        self.assert_symbol(row["symbol"])
        self.assert_trade_date(row["trade_date"])
        self.assertIn(row["cohort"], COHORTS)
        self.assertEqual(row["currency"], "IDR")
        self.assertIn(row["value_status"], {"AVAILABLE", "UNAVAILABLE"})
        if row["value_status"] == "AVAILABLE":
            for field in ("buy_value", "sell_value", "net_value"):
                self.assertIs(type(row[field]), int)
            self.assertGreaterEqual(row["buy_value"], 0)
            self.assertGreaterEqual(row["sell_value"], 0)
            self.assertEqual(row["net_value"], row["buy_value"] - row["sell_value"])
            self.assertEqual(row["reason_codes"], [])
        else:
            for field in ("buy_value", "sell_value", "net_value"):
                self.assertIsNone(row[field])
            self.assertEqual(row["reason_codes"], ["EVIDENCE_UNAVAILABLE"])

    def test_alert_fixture_covers_both_flagged_symbols(self):
        self.assert_envelope(self.alerts, "serve_alert")
        rows = self.alerts["records"]
        self.assertEqual({r["symbol"] for r in rows}, {"BBCA", "ANTM"})
        for row in rows:
            self.assert_alert(row)
            self.assertEqual(row["trade_date"], "2026-09-09")

    def test_evidence_fixture_covers_both_flagged_symbols_and_all_cohorts(self):
        self.assert_envelope(self.evidence, "serve_alert_evidence")
        rows = self.evidence["records"]
        for row in rows:
            self.assert_evidence(row)
        for symbol in ("BBCA", "ANTM"):
            cohorts = {r["cohort"] for r in rows if r["symbol"] == symbol}
            self.assertEqual(cohorts, COHORTS)

    def test_alert_evidence_ids_resolve_within_same_symbol_and_date(self):
        by_id = {row["evidence_id"]: row for row in self.evidence["records"]}
        self.assertEqual(len(by_id), len(self.evidence["records"]))
        referenced = set()
        for alert in self.alerts["records"]:
            for evidence_id in alert["evidence_ids"]:
                self.assertIn(evidence_id, by_id)
                row = by_id[evidence_id]
                self.assertEqual((row["symbol"], row["trade_date"]), (alert["symbol"], alert["trade_date"]))
                referenced.add(evidence_id)
        self.assertEqual(referenced, set(by_id))

    # ---- serve_components ----

    def assert_component_block(self, block, numeric_fields):
        self.assertEqual(set(block), {"basis", "value_status", "reason_codes", *numeric_fields})
        self.assertIn(block["basis"], {"EXAMPLE_VALUE", "MEASURED"})
        self.assertIn(block["value_status"], {"AVAILABLE", "UNAVAILABLE"})
        self.assert_unique_strings(block["reason_codes"])
        if block["value_status"] == "AVAILABLE":
            self.assertEqual(block["reason_codes"], [])
            for field in numeric_fields:
                self.assertIsNotNone(block[field])
        else:
            self.assertNotEqual(block["reason_codes"], [])
            for field in numeric_fields:
                self.assertIsNone(block[field])

    def assert_components(self, row):
        self.assertEqual(set(row), {
            "symbol", "trade_date", "scoring_status",
            "concentration", "breadth", "persistence", "coverage"})
        self.assert_symbol(row["symbol"])
        self.assert_trade_date(row["trade_date"])
        self.assertEqual(row["scoring_status"], "PENDING_DEFINITION")
        self.assert_component_block(row["concentration"],
            {"top_n", "share", "baseline_share", "band", "band_count"})
        self.assert_component_block(row["breadth"],
            {"changed", "active", "share", "baseline_share"})
        self.assert_component_block(row["persistence"],
            {"same_direction", "of_sessions", "longest_run", "session_flags"})
        self.assert_component_block(row["coverage"],
            {"matched_share", "cohorts_available", "cohorts_total", "completeness"})
        # Coverage must be measured, never an example value dressed up as real.
        self.assertEqual(row["coverage"]["basis"], "MEASURED")
        if row["persistence"]["value_status"] == "AVAILABLE":
            self.assertEqual(len(row["persistence"]["session_flags"]), row["persistence"]["of_sessions"])

    def test_components_fixture_reports_no_combined_score(self):
        self.assert_envelope(self.components, "serve_components")
        rows = self.components["records"]
        self.assertEqual({r["symbol"] for r in rows}, {"BBCA", "ANTM"})
        for row in rows:
            self.assertEqual(set(row), {
                "symbol", "trade_date", "scoring_status",
                "concentration", "breadth", "persistence", "coverage"})
            self.assertNotIn("severity", row)
            self.assertNotIn("score", row)
            self.assert_components(row)

    def test_antm_breadth_is_unavailable_not_zero(self):
        row = next(r for r in self.components["records"] if r["symbol"] == "ANTM")
        self.assertEqual(row["breadth"]["value_status"], "UNAVAILABLE")
        self.assertIsNone(row["breadth"]["changed"])
        self.assertNotEqual(row["breadth"]["reason_codes"], [])

    def test_component_pending_fields_cannot_be_filled_with_invented_scoring(self):
        row = deepcopy(next(r for r in self.components["records"] if r["symbol"] == "BBCA"))
        row["scoring_status"] = "EVALUATED"
        with self.assertRaises(AssertionError):
            self.assert_components(row)

    # ---- serve_flow_series ----

    def assert_flow_series(self, row):
        self.assertEqual(set(row), {
            "symbol", "cohort", "points", "currency", "value_status", "reason_codes"})
        self.assert_symbol(row["symbol"])
        self.assertIn(row["cohort"], COHORTS)
        self.assertEqual(row["currency"], "IDR")
        self.assertIn(row["value_status"], {"AVAILABLE", "UNAVAILABLE"})
        if row["value_status"] == "AVAILABLE":
            self.assertGreater(len(row["points"]), 0)
            for point in row["points"]:
                self.assertEqual(set(point), {"trade_date", "cumulative_net_value"})
                self.assert_trade_date(point["trade_date"])
                self.assert_money_or_none(point["cumulative_net_value"])
            dates = [p["trade_date"] for p in row["points"]]
            self.assertEqual(dates, sorted(dates))
            self.assertEqual(row["reason_codes"], [])
        else:
            self.assertEqual(row["points"], [])
            self.assertNotEqual(row["reason_codes"], [])

    def test_flow_series_covers_every_cohort_per_flagged_symbol(self):
        self.assert_envelope(self.flow_series, "serve_flow_series")
        rows = self.flow_series["records"]
        for row in rows:
            self.assert_flow_series(row)
        for symbol in ("BBCA", "ANTM"):
            cohorts = {r["cohort"] for r in rows if r["symbol"] == symbol}
            self.assertEqual(cohorts, COHORTS)
            unknown = next(r for r in rows if r["symbol"] == symbol and r["cohort"] == "unknown")
            self.assertEqual(unknown["value_status"], "UNAVAILABLE")

    def test_flow_series_window_matches_run_window(self):
        sessions = self.run["records"][0]["window"]["sessions"]
        for row in self.flow_series["records"]:
            if row["value_status"] == "AVAILABLE":
                self.assertEqual(len(row["points"]), sessions)

    # ---- serve_peer_screen ----

    def assert_peer_screen(self, row):
        self.assertEqual(set(row), {
            "symbol", "peer_set_label", "screened", "excluded", "shortlist", "scorecard"})
        self.assert_symbol(row["symbol"])
        self.assert_text(row["peer_set_label"])
        self.assertIs(type(row["screened"]), int)
        # screened counts every candidate considered; excluded + shortlist need not
        # exhaust it, since a candidate can be screened without being singled out
        # as either explicitly excluded or promoted to the shortlist.
        self.assertGreaterEqual(row["screened"], len(row["excluded"]) + len(row["shortlist"]))
        for candidate in row["excluded"]:
            self.assertEqual(set(candidate), {"symbol", "name", "reason_code", "reason_text", "detail"})
            self.assert_text(candidate["symbol"])
            self.assert_text(candidate["name"])
            self.assert_text(candidate["reason_code"])
            self.assert_text(candidate["reason_text"])
            self.assert_text(candidate["detail"])
        self.assert_unique_strings(row["shortlist"])
        self.assertNotIn(row["symbol"], row["shortlist"])
        for metric in row["scorecard"]:
            self.assertEqual(set(metric), {"label", "note", "unit", "cells"})
            self.assert_text(metric["label"])
            self.assert_text(metric["note"])
            self.assertIn(metric["unit"], {"IDR", "SHARE", "PERCENT", "COUNT", "RATIO_LABEL"})
            covered = {cell["symbol"] for cell in metric["cells"]}
            self.assertIn(row["symbol"], covered)
            for peer in row["shortlist"]:
                self.assertIn(peer, covered)
            for cell in metric["cells"]:
                self.assertEqual(set(cell), {"symbol", "value", "value_status", "reason_codes"})
                self.assertIn(cell["value_status"], {"AVAILABLE", "UNAVAILABLE"})
                if cell["value_status"] == "AVAILABLE":
                    self.assertIsNotNone(cell["value"])
                    self.assertEqual(cell["reason_codes"], [])
                else:
                    self.assertIsNone(cell["value"])
                    self.assertNotEqual(cell["reason_codes"], [])

    def test_peer_screen_shows_exclusions_and_an_unavailable_cell(self):
        self.assert_envelope(self.peer_screen, "serve_peer_screen")
        rows = self.peer_screen["records"]
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assert_peer_screen(row)
        self.assertEqual(row["symbol"], "BBCA")
        self.assertGreater(len(row["excluded"]), 0)
        unavailable_cells = [
            cell
            for metric in row["scorecard"]
            for cell in metric["cells"]
            if cell["value_status"] == "UNAVAILABLE"
        ]
        self.assertGreater(len(unavailable_cells), 0)

    # ---- serve_narrative ----

    def assert_narrative(self, row):
        self.assertEqual(set(row), {"symbol", "trade_date", "paragraphs", "grounded_in"})
        self.assert_symbol(row["symbol"])
        self.assert_trade_date(row["trade_date"])
        self.assertIsInstance(row["paragraphs"], list)
        self.assertGreater(len(row["paragraphs"]), 0)
        for paragraph in row["paragraphs"]:
            self.assert_text(paragraph)
        self.assert_unique_strings(row["grounded_in"])
        for path in row["grounded_in"]:
            self.assertIn(path, ALLOWED_FIELD_PATHS)

    def test_narrative_grounded_in_uses_only_known_field_paths(self):
        self.assert_envelope(self.narrative, "serve_narrative")
        rows = self.narrative["records"]
        self.assertEqual({r["symbol"] for r in rows}, {"BBCA", "ANTM"})
        for row in rows:
            self.assert_narrative(row)

    def test_antm_narrative_never_cites_unavailable_breadth(self):
        row = next(r for r in self.narrative["records"] if r["symbol"] == "ANTM")
        breadth_paths = {p for p in row["grounded_in"] if p.startswith("serve_components.breadth")}
        self.assertEqual(breadth_paths, set())
        for paragraph in row["paragraphs"]:
            self.assertNotIn("brokers changed side", paragraph)

    def test_narrative_rejects_a_fabricated_field_path(self):
        row = deepcopy(next(r for r in self.narrative["records"] if r["symbol"] == "BBCA"))
        row["grounded_in"].append("serve_components.severity_score")
        with self.assertRaises(AssertionError):
            self.assert_narrative(row)

    # ---- cross-output consistency ----

    def test_flagged_symbols_agree_across_alert_components_flow_narrative(self):
        alert_symbols = {r["symbol"] for r in self.alerts["records"]}
        component_symbols = {r["symbol"] for r in self.components["records"]}
        flow_symbols = {r["symbol"] for r in self.flow_series["records"]}
        narrative_symbols = {r["symbol"] for r in self.narrative["records"]}
        self.assertEqual(alert_symbols, component_symbols)
        self.assertEqual(alert_symbols, flow_symbols)
        self.assertEqual(alert_symbols, narrative_symbols)

    def test_all_records_reference_the_frozen_demo_universe_only(self):
        for envelope, symbol_key in (
            (self.positions, "symbol"), (self.alerts, "symbol"), (self.evidence, "symbol"),
            (self.components, "symbol"), (self.flow_series, "symbol"), (self.narrative, "symbol"),
        ):
            for row in envelope["records"]:
                self.assertIn(row[symbol_key], DEMO_SYMBOLS)
        for row in self.peer_screen["records"]:
            self.assertIn(row["symbol"], DEMO_SYMBOLS)
            # Peer-screen shortlist/exclusions may range outside the frozen demo
            # universe on purpose: the screen operates on the broader IDX sector,
            # not just the ten symbols the demo happens to hold.


if __name__ == "__main__":
    unittest.main()
