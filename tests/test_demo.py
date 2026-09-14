from copy import deepcopy
from dataclasses import FrozenInstanceError
from datetime import date
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from sectors.demo import CONFIG_PATH, load_demo_scope


class DemoScopeTests(unittest.TestCase):
    def test_checked_in_scope_matches_frozen_decision(self):
        scope = load_demo_scope()
        self.assertEqual(scope.symbols, (
            "BBCA", "BBRI", "BMRI", "BBNI", "TLKM",
            "ASII", "ICBP", "INDF", "ANTM", "MDKA"))
        self.assertEqual(len(scope.symbols), 10)
        self.assertEqual(len(set(scope.symbols)), 10)
        self.assertIn("BBCA", scope.symbols)
        self.assertTrue(all(symbol and symbol.isupper() for symbol in scope.symbols))
        self.assertEqual(scope.end_date, date(2026, 9, 9))
        self.assertEqual(scope.lookback_trading_days, 20)

    def test_loading_is_offline_and_returns_immutable_scope(self):
        with patch("socket.socket", side_effect=AssertionError("network forbidden")) as network:
            scope = load_demo_scope()
        network.assert_not_called()
        self.assertIsInstance(scope.symbols, tuple)
        with self.assertRaises(FrozenInstanceError):
            scope.lookback_trading_days = 1

    def assert_invalid(self, config):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "scope.json"
            path.write_text(json.dumps(config), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "INVALID_DEMO_CONFIG"):
                load_demo_scope(path)

    def test_invalid_symbol_populations_are_rejected_without_normalizing(self):
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        symbols = config["symbols"]
        invalid_populations = [symbols[:-1], symbols + ["EXTRA"],
                               symbols[:-1] + [symbols[0]], ["OTHER"] + symbols[1:], None, "BBCA"]
        for invalid_symbol in ("", "bbri", " BBRI", "BBRI ", "BB RI", "BBRI.JK", 123, None, []):
            invalid_populations.append(symbols[:1] + [invalid_symbol] + symbols[2:])
        for population in invalid_populations:
            with self.subTest(symbols=population):
                self.assert_invalid(dict(config, symbols=population))

    def test_invalid_dates_and_lookbacks_are_rejected(self):
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        for end_date in (None, 20260909, "2026-02-30", "20260909", "2026-09-09T00:00:00", ""):
            with self.subTest(end_date=end_date):
                self.assert_invalid(dict(config, end_date=end_date))
        for lookback in (None, True, "20", 20.0, 0, -1):
            with self.subTest(lookback=lookback):
                self.assert_invalid(dict(config, lookback_trading_days=lookback))

    def test_missing_extra_fields_and_wrong_shapes_are_rejected(self):
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        for field in config:
            invalid = deepcopy(config)
            del invalid[field]
            with self.subTest(missing=field):
                self.assert_invalid(invalid)
        self.assert_invalid(dict(config, start_date="2026-08-01"))
        self.assert_invalid([])
        self.assert_invalid(None)

    def test_unreadable_malformed_and_duplicate_key_json_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "scope.json"
            with self.assertRaisesRegex(ValueError, "INVALID_DEMO_CONFIG"):
                load_demo_scope(path)
            for body in (b"{", b'{"symbols": [], "symbols": []}', b"NaN"):
                path.write_bytes(body)
                with self.subTest(body=body), self.assertRaisesRegex(ValueError, "INVALID_DEMO_CONFIG"):
                    load_demo_scope(path)


if __name__ == "__main__":
    unittest.main()
