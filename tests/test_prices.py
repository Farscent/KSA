import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from sectors import prices, publish
from sectors.demo import REFERENCE_DATA, load_demo_scope
from sectors.registry import RegistryError


def body(rows):
    return json.dumps({"data": rows}).encode("utf-8")


GOOD_ROWS = [
    {"date": "2026-09-08", "close": 1000, "volume": 5},
    {"date": "2026-09-09", "close": 1100, "volume": 7},
]


class WindowTests(unittest.TestCase):
    def test_window_ends_at_the_frozen_demo_date(self):
        scope = load_demo_scope()
        start, end = prices.window(scope)
        self.assertEqual(end, "2026-09-09")
        self.assertEqual(end, scope.end_date.isoformat())

    def test_window_stays_within_the_providers_ninety_day_limit(self):
        from datetime import date

        start, end = prices.window()
        span = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
        self.assertEqual(span, prices.WINDOW_DAYS)
        self.assertLessEqual(span, 90)

    def test_reference_data_covers_every_frozen_symbol(self):
        self.assertEqual(set(REFERENCE_DATA), set(load_demo_scope().symbols))


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.cache = Path(tempfile.mkdtemp())
        self.start, self.end = prices.window()

    def test_archive_round_trips_and_pins_request_identity(self):
        raw = body(GOOD_ROWS)
        directory, meta = prices.archive(self.cache, raw, 200, symbol="BBCA",
                                         start=self.start, end=self.end, source="synthetic")
        loaded_meta, loaded_body = prices.load_observation(directory)
        self.assertEqual(loaded_body, raw)
        self.assertEqual(loaded_meta["requested_symbol"], "BBCA")
        self.assertEqual(loaded_meta["endpoint"], "https://api.sectors.app/v2/daily/BBCA/")
        self.assertEqual(set(meta), prices.META_FIELDS)

    def test_tampered_body_is_rejected_by_checksum(self):
        directory, _ = prices.archive(self.cache, body(GOOD_ROWS), 200, symbol="BBCA",
                                      start=self.start, end=self.end, source="synthetic")
        (directory / "body.bin").write_bytes(b'{"data": []}')
        with self.assertRaises(RegistryError):
            prices.load_observation(directory)

    def test_cache_miss_without_live_never_reaches_the_network(self):
        with patch("socket.socket", side_effect=AssertionError("network forbidden")):
            with self.assertRaises(RegistryError) as caught:
                prices.acquire_symbol(self.cache, "BBCA", self.start, self.end)
        self.assertIn("NO_PRICE_CACHE", str(caught.exception))

    def test_refresh_requires_live(self):
        with self.assertRaises(RegistryError):
            prices.acquire_symbol(self.cache, "BBCA", self.start, self.end, force_refresh=True)

    def test_another_symbols_cache_is_not_reused(self):
        prices.archive(self.cache, body(GOOD_ROWS), 200, symbol="BBRI",
                       start=self.start, end=self.end, source="synthetic")
        with self.assertRaises(RegistryError):
            prices.acquire_symbol(self.cache, "BBCA", self.start, self.end)


class ParsePointsTests(unittest.TestCase):
    def setUp(self):
        self.start, self.end = prices.window()

    def parse(self, rows):
        return prices.parse_points({"data": rows}, "BBCA", self.start, self.end)

    def test_valid_rows_are_returned_sorted(self):
        points, findings = self.parse(list(reversed(GOOD_ROWS)))
        self.assertEqual([p["trade_date"] for p in points], ["2026-09-08", "2026-09-09"])
        self.assertEqual(findings, [])

    def test_bare_list_payload_is_accepted(self):
        points, findings = prices.parse_points(GOOD_ROWS, "BBCA", self.start, self.end)
        self.assertEqual(len(points), 2)
        self.assertEqual(findings, [])

    def test_bad_rows_become_findings_and_are_never_coerced(self):
        points, findings = self.parse([
            {"date": "2026-09-09", "close": 1100, "volume": 7},
            {"date": "2026-01-01", "close": 900, "volume": 1},
            {"date": "2026-09-09", "close": 5, "volume": 1},
            {"date": "not-a-date", "close": 900, "volume": 1},
            {"date": "2026-09-07", "close": 0, "volume": 1},
            {"date": "2026-09-04", "close": "1100", "volume": 1},
            "not-an-object",
        ])
        self.assertEqual([p["close"] for p in points], [1100])
        self.assertEqual({f["reason"] for f in findings}, {
            "DATE_OUTSIDE_REQUESTED_WINDOW", "DUPLICATE_DATE", "INVALID_DATE",
            "INVALID_CLOSE", "ROW_NOT_AN_OBJECT"})

    def test_boolean_close_is_not_accepted_as_an_integer(self):
        points, findings = self.parse([{"date": "2026-09-09", "close": True, "volume": 1}])
        self.assertEqual(points, [])
        self.assertEqual(findings[0]["reason"], "INVALID_CLOSE")

    def test_invalid_volume_is_nulled_but_the_close_is_kept(self):
        points, findings = self.parse([{"date": "2026-09-09", "close": 1100, "volume": -3}])
        self.assertEqual(points, [{"trade_date": "2026-09-09", "close": 1100, "volume": None}])
        self.assertEqual(findings[0]["reason"], "INVALID_VOLUME")

    def test_unexpected_payload_shape_is_reported_not_raised(self):
        points, findings = prices.parse_points({"unexpected": 1}, "BBCA", self.start, self.end)
        self.assertEqual(points, [])
        self.assertEqual(findings, [{"path": "$", "reason": "UNEXPECTED_PAYLOAD_SHAPE"}])


class IngestTests(unittest.TestCase):
    def setUp(self):
        self.scope = load_demo_scope()
        self.start, self.end = prices.window(self.scope)
        self.cache = Path(tempfile.mkdtemp())
        for symbol in self.scope.symbols:
            rows = [] if symbol == "MDKA" else GOOD_ROWS
            prices.archive(self.cache, body(rows), 200, symbol=symbol,
                           start=self.start, end=self.end, source="synthetic")

    def test_ingest_replays_from_cache_without_network_access(self):
        with patch("socket.socket", side_effect=AssertionError("network forbidden")) as network:
            result = prices.ingest(self.cache, scope=self.scope)
        network.assert_not_called()
        self.assertEqual(result["contract_version"], "1.2.0-draft.1")
        self.assertEqual(result["data_kind"], "MEASURED")
        self.assertEqual(len(result["serve_position"]), 10)

    def test_symbol_without_points_is_unavailable_never_zero(self):
        result = prices.ingest(self.cache, scope=self.scope)
        mdka = next(r for r in result["serve_position"] if r["symbol"] == "MDKA")
        self.assertEqual(mdka["value_status"], "UNAVAILABLE")
        self.assertIsNone(mdka["close"])
        self.assertIsNone(mdka["close_date"])
        self.assertEqual(mdka["reason_codes"], ["PRICE_NOT_YET_INGESTED"])

    def test_close_is_the_last_returned_point_not_an_assumed_date(self):
        result = prices.ingest(self.cache, scope=self.scope)
        bbca = next(r for r in result["serve_position"] if r["symbol"] == "BBCA")
        self.assertEqual(bbca["close"], 1100)
        self.assertEqual(bbca["close_date"], "2026-09-09")
        self.assertEqual(bbca["name"], "Bank Central Asia")
        self.assertEqual(bbca["sector"], "Financials")

    def test_availability_and_reason_codes_stay_consistent(self):
        result = prices.ingest(self.cache, scope=self.scope)
        for record in result["serve_position"]:
            available = record["value_status"] == "AVAILABLE"
            self.assertEqual(available, record["close"] is not None)
            self.assertEqual(available, record["close_date"] is not None)
            self.assertEqual(available, record["reason_codes"] == [])

    def test_run_record_counts_only_matched_symbols(self):
        run = prices.ingest(self.cache, scope=self.scope)["serve_run"]
        self.assertEqual(run["symbols_requested"], 10)
        self.assertEqual(run["symbols_matched"], 9)
        self.assertEqual(run["window"]["sessions"], 2)
        self.assertLessEqual(run["symbols_matched"], run["symbols_requested"])

    def test_non_200_response_yields_unavailable_with_a_warning(self):
        cache = Path(tempfile.mkdtemp())
        prices.archive(cache, b"upstream unavailable", 503, symbol="BBCA",
                       start=self.start, end=self.end, source="synthetic")
        record = prices.symbol_record(
            next(p for p in cache.glob("*") if p.is_dir()), "BBCA", self.start, self.end)
        self.assertEqual(record["value_status"], "UNAVAILABLE")
        self.assertIn("HTTP_STATUS_503", record["warning_codes"])


class PublishRowTests(unittest.TestCase):
    def setUp(self):
        self.scope = load_demo_scope()
        self.start, self.end = prices.window(self.scope)
        cache = Path(tempfile.mkdtemp())
        for symbol in self.scope.symbols:
            rows = [] if symbol == "MDKA" else GOOD_ROWS
            prices.archive(cache, body(rows), 200, symbol=symbol,
                           start=self.start, end=self.end, source="synthetic")
        self.payload = prices.ingest(cache, scope=self.scope)

    def test_position_rows_carry_provenance_columns(self):
        rows = publish.position_rows(self.payload)
        self.assertEqual(len(rows), 10)
        self.assertTrue(all(r["contract_version"] == "1.2.0-draft.1" for r in rows))
        self.assertTrue(all(r["data_kind"] == "MEASURED" for r in rows))

    def test_unavailable_symbol_contributes_no_history_rows(self):
        rows = publish.price_history_rows(self.payload)
        self.assertEqual(len(rows), 18)
        self.assertNotIn("MDKA", {r["symbol"] for r in rows})

    def test_run_window_object_is_flattened_to_columns(self):
        row = publish.run_rows(self.payload)[0]
        self.assertNotIn("window", row)
        self.assertEqual(row["window_sessions"], 2)
        self.assertEqual(row["window_start"], "2026-09-08")
        self.assertEqual(row["window_end"], "2026-09-09")

    def test_publish_refuses_an_unrecognised_data_kind(self):
        with self.assertRaises(RegistryError):
            publish.publish(dict(self.payload, data_kind="GUESSED"))

    def test_missing_credentials_are_caught_before_any_request(self):
        posted = []
        with patch.dict("os.environ", {"SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": ""}, clear=False):
            with self.assertRaises(RegistryError):
                publish.upsert("serve_position", publish.position_rows(self.payload),
                               post=lambda *a, **k: posted.append(a))
        self.assertEqual(posted, [])

    def test_unsupported_table_is_rejected(self):
        with self.assertRaises(RegistryError):
            publish.upsert("holdings", [{"symbol": "BBCA"}])

    def test_upsert_sends_rows_and_reports_rejections(self):
        class Response:
            def __init__(self, status):
                self.status_code, self.text, self.headers = status, "", {}

        env = {"SUPABASE_URL": "https://example.supabase.co",
               "SUPABASE_SERVICE_ROLE_KEY": "service-role-key"}
        calls = []

        def post(url, data=None, headers=None, timeout=None):
            calls.append((url, json.loads(data), headers))
            return Response(201)

        with patch.dict("os.environ", env, clear=False):
            sent = publish.upsert("serve_position", publish.position_rows(self.payload), post=post)
        self.assertEqual(sent, 10)
        url, rows, headers = calls[0]
        self.assertEqual(url, "https://example.supabase.co/rest/v1/serve_position")
        self.assertIn("resolution=merge-duplicates", headers["Prefer"])
        self.assertEqual(len(rows), 10)

        def rejecting_post(url, data=None, headers=None, timeout=None):
            return Response(400)

        with patch.dict("os.environ", env, clear=False):
            with self.assertRaises(RegistryError) as caught:
                publish.upsert("serve_position", publish.position_rows(self.payload), post=rejecting_post)
        self.assertIn("PUBLISH_REJECTED", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
