"""Contract tests for 1.2.0-draft.1, the additive extension documented in
docs/serve-contract-1.2.md.

1.0.0-draft.1 and 1.1.0-draft.1 keep their own test files unchanged — this
version adds `serve_price_history` and widens `data_kind`, and must not alter
what those drafts assert.
"""

from datetime import date
import json
from pathlib import Path
import unittest

FIXTURES = Path(__file__).parent / "fixtures"
VERSION = "1.2.0-draft.1"
DATA_KINDS = {"SYNTHETIC_EXAMPLE", "MEASURED"}
MAX_EXACT_INTEGER = 9_007_199_254_740_991
DEMO_SYMBOLS = set(json.loads(
    (Path(__file__).parents[1] / "sectors" / "demo-scope.json").read_text())["symbols"])


def load(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class ServeContractV12Tests(unittest.TestCase):
    def setUp(self):
        self.price_history = load("serve_price_history_v12.json")

    def assert_text(self, value):
        self.assertIsInstance(value, str)
        self.assertTrue(value.strip())

    def assert_trade_date(self, value):
        self.assertIsInstance(value, str)
        self.assertEqual(date.fromisoformat(value).isoformat(), value)

    def assert_envelope(self, envelope, output):
        self.assertEqual(set(envelope), {
            "contract_version", "contract_status", "output", "data_kind", "description", "records"})
        self.assertEqual(envelope["contract_version"], VERSION)
        self.assertEqual(envelope["contract_status"], "UNDER_REVIEW")
        self.assertEqual(envelope["output"], output)
        self.assertIn(envelope["data_kind"], DATA_KINDS)
        self.assert_text(envelope["description"])
        self.assertIsInstance(envelope["records"], list)

    def test_envelope_shape(self):
        self.assert_envelope(self.price_history, "serve_price_history")
        self.assertTrue(self.price_history["records"])

    def test_record_key_set_is_exact(self):
        for row in self.price_history["records"]:
            self.assertEqual(set(row), {
                "symbol", "points", "currency", "value_status", "reason_codes"})

    def test_symbols_are_in_the_frozen_universe(self):
        for row in self.price_history["records"]:
            self.assertIn(row["symbol"], DEMO_SYMBOLS)
        symbols = [row["symbol"] for row in self.price_history["records"]]
        self.assertEqual(len(symbols), len(set(symbols)))

    def test_availability_matches_points_and_reason_codes(self):
        for row in self.price_history["records"]:
            self.assertIn(row["value_status"], {"AVAILABLE", "UNAVAILABLE"})
            available = row["value_status"] == "AVAILABLE"
            self.assertEqual(available, bool(row["points"]))
            self.assertEqual(available, row["reason_codes"] == [])
            if not available:
                self.assertEqual(row["reason_codes"], ["PRICE_NOT_YET_INGESTED"])

    def test_points_are_ascending_with_no_duplicate_dates(self):
        for row in self.price_history["records"]:
            dates = [point["trade_date"] for point in row["points"]]
            for value in dates:
                self.assert_trade_date(value)
            self.assertEqual(dates, sorted(dates))
            self.assertEqual(len(dates), len(set(dates)))

    def test_close_is_a_positive_integer_never_a_filler_zero(self):
        for row in self.price_history["records"]:
            for point in row["points"]:
                self.assertEqual(set(point), {"trade_date", "close", "volume"})
                self.assertIs(type(point["close"]), int)
                self.assertGreater(point["close"], 0)
                self.assertLessEqual(point["close"], MAX_EXACT_INTEGER)

    def test_volume_is_a_nonnegative_integer_or_null(self):
        for row in self.price_history["records"]:
            for point in row["points"]:
                volume = point["volume"]
                if volume is None:
                    continue
                self.assertIs(type(volume), int)
                self.assertGreaterEqual(volume, 0)

    def test_currency_is_unscaled_idr(self):
        for row in self.price_history["records"]:
            self.assertEqual(row["currency"], "IDR")

    def test_a_gap_is_an_absent_session_not_a_zero(self):
        antm = next(r for r in self.price_history["records"] if r["symbol"] == "ANTM")
        dates = [point["trade_date"] for point in antm["points"]]
        self.assertNotIn("2026-09-08", dates)
        self.assertTrue(all(point["close"] > 0 for point in antm["points"]))

    def test_earlier_drafts_are_untouched_by_this_version(self):
        for name, version in (("serve_alert.json", "1.0.0-draft.1"),
                              ("serve_alert_evidence.json", "1.0.0-draft.1"),
                              ("serve_position_v11.json", "1.1.0-draft.1"),
                              ("serve_run_v11.json", "1.1.0-draft.1")):
            envelope = load(name)
            self.assertEqual(envelope["contract_version"], version)
            self.assertEqual(envelope["data_kind"], "SYNTHETIC_EXAMPLE")


if __name__ == "__main__":
    unittest.main()
