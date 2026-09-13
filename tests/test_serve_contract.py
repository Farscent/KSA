"""Validate the hand-written review fixtures, not a production serving layer."""

from copy import deepcopy
from datetime import date
from pathlib import Path
import unittest

from sectors.registry import strict_json

FIXTURES = Path(__file__).parent / "fixtures"
VERSION = "1.0.0-draft.1"
MAX_EXACT_INTEGER = 9007199254740991


class ServeContractTests(unittest.TestCase):
    def setUp(self):
        self.alerts = strict_json((FIXTURES / "serve_alert.json").read_bytes())
        self.evidence = strict_json((FIXTURES / "serve_alert_evidence.json").read_bytes())

    def assert_text(self, value):
        self.assertIsInstance(value, str)
        self.assertTrue(value.strip())

    def assert_unique_strings(self, values):
        self.assertIsInstance(values, list)
        for value in values:
            self.assert_text(value)
        self.assertEqual(len(values), len(set(values)))

    def assert_identity(self, row):
        self.assert_text(row["symbol"])
        self.assertRegex(row["symbol"], r"^[A-Z]+$")
        self.assertIsInstance(row["trade_date"], str)
        self.assertEqual(date.fromisoformat(row["trade_date"]).isoformat(), row["trade_date"])

    def assert_envelope(self, envelope, output):
        self.assertEqual(set(envelope), {
            "contract_version", "contract_status", "output", "data_kind", "description", "records"})
        self.assertEqual(envelope["contract_version"], VERSION)
        self.assertEqual(envelope["contract_status"], "UNDER_REVIEW")
        self.assertEqual(envelope["output"], output)
        self.assertEqual(envelope["data_kind"], "SYNTHETIC_EXAMPLE")
        self.assert_text(envelope["description"])
        self.assertIsInstance(envelope["records"], list)

    def assert_alert(self, row):
        self.assertEqual(set(row), {"symbol", "trade_date", "signal_state", "score", "severity",
            "scoring_status", "reason_codes", "summary", "qualification", "evidence_ids"})
        self.assert_identity(row)
        self.assertEqual(row["signal_state"], "NOT_EVALUATED")
        self.assertEqual(row["scoring_status"], "PENDING_DEFINITION")
        self.assertIsNone(row["score"])
        self.assertIsNone(row["severity"])
        self.assert_unique_strings(row["reason_codes"])
        self.assertEqual(set(row["reason_codes"]), {"SCORING_NOT_DEFINED", "SEVERITY_NOT_DEFINED"})
        self.assert_text(row["summary"])
        self.assert_unique_strings(row["evidence_ids"])
        quality = row["qualification"]
        self.assertEqual(set(quality), {"operational_completeness", "safe_for_demo_analysis", "schema_status",
            "population_status", "external_reconciliation", "externally_proven_complete", "reason_codes"})
        self.assertIn(quality["operational_completeness"], {"PASS", "FAIL", "NOT_EVALUATED"})
        self.assertIs(type(quality["safe_for_demo_analysis"]), bool)
        self.assertEqual(quality["safe_for_demo_analysis"], quality["operational_completeness"] == "PASS")
        self.assertIn(quality["schema_status"], {
            "VALID", "VALID_WITH_KNOWN_PROVIDER_DEVIATION", "INVALID", "NOT_EVALUATED"})
        if quality["operational_completeness"] == "PASS":
            self.assertIn(quality["schema_status"], {"VALID", "VALID_WITH_KNOWN_PROVIDER_DEVIATION"})
        self.assertEqual(quality["population_status"], "ACTIVE_BROKER_CONTRACT_ACCEPTED")
        self.assertEqual(quality["external_reconciliation"], "NOT_EVALUATED")
        self.assertIs(quality["externally_proven_complete"], False)
        self.assert_unique_strings(quality["reason_codes"])
        expected_reasons = {"COVERAGE_UNRESOLVED"}
        if quality["schema_status"] == "VALID_WITH_KNOWN_PROVIDER_DEVIATION":
            expected_reasons.add("KNOWN_NULLABILITY_DEVIATION")
        if quality["operational_completeness"] == "FAIL":
            expected_reasons.add("OPERATIONAL_CHECK_FAILED")
        if quality["operational_completeness"] == "NOT_EVALUATED":
            expected_reasons.add("QUALIFICATION_NOT_EVALUATED")
        self.assertEqual(set(quality["reason_codes"]), expected_reasons)

    def assert_evidence(self, row):
        self.assertEqual(set(row), {"evidence_id", "symbol", "trade_date", "cohort", "buy_value",
            "sell_value", "net_value", "currency", "evidence_type", "value_status", "reason_codes",
            "classification_basis", "market_scope_status", "title", "explanation"})
        self.assert_identity(row)
        self.assert_text(row["evidence_id"])
        self.assertIn(row["cohort"], {"institutional", "retail", "mixed", "unknown"})
        self.assertEqual(row["currency"], "IDR")
        self.assertEqual(row["evidence_type"], "COHORT_VALUE_SUMMARY")
        self.assertEqual(row["classification_basis"], "SYNTHETIC_EXAMPLE")
        self.assertEqual(row["market_scope_status"], "NOT_ESTABLISHED")
        self.assert_text(row["title"])
        self.assert_text(row["explanation"])
        self.assert_unique_strings(row["reason_codes"])
        self.assertIn(row["value_status"], {"AVAILABLE", "UNAVAILABLE"})
        if row["value_status"] == "AVAILABLE":
            for field in ("buy_value", "sell_value", "net_value"):
                self.assertIs(type(row[field]), int)
                self.assertLessEqual(abs(row[field]), MAX_EXACT_INTEGER)
            self.assertGreaterEqual(row["buy_value"], 0)
            self.assertGreaterEqual(row["sell_value"], 0)
            self.assertEqual(row["net_value"], row["buy_value"] - row["sell_value"])
            self.assertEqual(row["reason_codes"], [])
        else:
            for field in ("buy_value", "sell_value", "net_value"):
                self.assertIsNone(row[field])
            self.assertEqual(row["reason_codes"], ["EVIDENCE_UNAVAILABLE"])

    def test_alert_fixture_shape_and_pending_scoring(self):
        self.assert_envelope(self.alerts, "serve_alert")
        self.assertEqual(len(self.alerts["records"]), 1)
        for row in self.alerts["records"]:
            self.assert_alert(row)
            self.assertEqual((row["symbol"], row["trade_date"]), ("BBCA", "2026-09-09"))
            self.assertEqual(row["qualification"]["operational_completeness"], "PASS")

    def test_evidence_fixture_shape_and_example_only_values(self):
        self.assert_envelope(self.evidence, "serve_alert_evidence")
        self.assertEqual(len(self.evidence["records"]), 4)
        self.assertEqual({row["cohort"] for row in self.evidence["records"]},
                         {"institutional", "retail", "mixed", "unknown"})
        for row in self.evidence["records"]:
            self.assert_evidence(row)
            self.assertEqual((row["symbol"], row["trade_date"]), ("BBCA", "2026-09-09"))
        values = [row["net_value"] for row in self.evidence["records"]]
        self.assertIn(None, values)
        self.assertIn(0, values)
        self.assertTrue(any(value < 0 for value in values if value is not None))
        self.assertTrue(any(value > 0 for value in values if value is not None))

    def test_unique_grains_and_evidence_links_match_symbol_date_and_version(self):
        alerts, evidence = self.alerts["records"], self.evidence["records"]
        self.assertEqual(self.alerts["contract_version"], self.evidence["contract_version"])
        self.assertEqual(len(alerts), len({(r["symbol"], r["trade_date"]) for r in alerts}))
        self.assertEqual(len(evidence), len({(r["symbol"], r["trade_date"], r["evidence_type"], r["cohort"])
                                            for r in evidence}))
        by_id = {row["evidence_id"]: row for row in evidence}
        self.assertEqual(len(by_id), len(evidence))
        referenced = set()
        for alert in alerts:
            for evidence_id in alert["evidence_ids"]:
                self.assertIn(evidence_id, by_id)
                row = by_id[evidence_id]
                self.assertEqual((row["symbol"], row["trade_date"]), (alert["symbol"], alert["trade_date"]))
                referenced.add(evidence_id)
        self.assertEqual(referenced, set(by_id))

    def test_pending_fields_cannot_be_filled_with_invented_scoring(self):
        for field, value in (("score", 0), ("score", 75), ("severity", "LOW"),
                             ("signal_state", "NO_SIGNAL"), ("scoring_status", "EVALUATED")):
            with self.subTest(field=field, value=value):
                row = deepcopy(self.alerts["records"][0])
                row[field] = value
                with self.assertRaises(AssertionError):
                    self.assert_alert(row)

    def test_operational_pass_is_not_external_completeness_or_scoring(self):
        row = deepcopy(self.alerts["records"][0])
        self.assert_alert(row)
        row["qualification"]["externally_proven_complete"] = True
        with self.assertRaises(AssertionError):
            self.assert_alert(row)
        row = deepcopy(self.alerts["records"][0])
        row["qualification"]["schema_status"] = "INVALID"
        with self.assertRaises(AssertionError):
            self.assert_alert(row)

    def test_invalid_amounts_and_zero_filled_unavailable_evidence_are_rejected(self):
        for field, value in (("buy_value", True), ("buy_value", "100000000"),
                             ("buy_value", 100000000.0), ("buy_value", -1),
                             ("buy_value", MAX_EXACT_INTEGER + 1), ("net_value", 1)):
            with self.subTest(field=field, value=value):
                row = deepcopy(self.evidence["records"][0])
                row[field] = value
                with self.assertRaises(AssertionError):
                    self.assert_evidence(row)
        row = deepcopy(next(r for r in self.evidence["records"] if r["value_status"] == "UNAVAILABLE"))
        row.update(buy_value=0, sell_value=0, net_value=0)
        with self.assertRaises(AssertionError):
            self.assert_evidence(row)

    def test_unbalanced_available_evidence_is_not_rejected(self):
        rows = [row for row in self.evidence["records"] if row["value_status"] == "AVAILABLE"]
        self.assertNotEqual(sum(row["buy_value"] for row in rows), sum(row["sell_value"] for row in rows))
        for row in rows:
            self.assert_evidence(row)


if __name__ == "__main__":
    unittest.main()
