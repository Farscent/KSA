from copy import deepcopy
from dataclasses import replace
import gzip
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import requests
from urllib3.response import HTTPResponse

from sectors import daily as d, registry as r
from sectors.__main__ import main

FIXTURES = Path(__file__).parent / "fixtures"


class DailyTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.cache = self.root / "cache"
        self.evidence = d.load_evidence()
        self.payload = json.loads((FIXTURES / "daily-synthetic-valid.json").read_text())
        # Simulated real-source prerequisite; all activity fixtures stay synthetic.
        self.registry = {"broker_codes": ["ZA", "ZB", "ZC"], "latest_applied_snapshot": {"source": "local"}}

    def observation(self, payload=None, *, body=None, status=200, encoding="identity", stamp=None):
        if body is None:
            body = json.dumps(self.payload if payload is None else payload).encode()
        return d.archive(self.cache, body, status, source="synthetic", content_encoding=encoding, retrieved_at=stamp)[0]

    def report(self, payload=None, **kwargs):
        return d.qualify(self.observation(payload, **kwargs), self.registry, self.evidence)

    def response(self, body=None, status=200, headers=None):
        body = json.dumps(self.payload).encode() if body is None else body
        response = requests.Response()
        response.status_code = status
        response.headers.update(headers or {})
        response.raw = HTTPResponse(body=io.BytesIO(body), preload_content=False)
        response.request = requests.Request("GET", d.REQUEST_URL).prepare()
        response.url = d.REQUEST_URL
        return response

    def test_calendar_uses_reviewed_exchange_schedule_and_retains_caveat(self):
        result = d.calendar_check(self.evidence)
        self.assertTrue(result["scheduled_trading_date"])
        self.assertEqual(result["weekday"], "Wednesday")
        self.assertIn("Peng-00171", result["source"]["document"])
        self.assertFalse(result["source"]["extraordinary_closures_verified"])
        closed = deepcopy(self.evidence)
        closed["calendar"]["closed_weekdays_in_month"] = [d.TRADE_DATE]
        self.assertFalse(d.calendar_check(closed)["scheduled_trading_date"])
        missing = deepcopy(self.evidence)
        del missing["calendar"]["reviewed_month"]
        self.assertFalse(d.calendar_check(missing)["scheduled_trading_date"])
        with self.assertRaisesRegex(r.RegistryError, "UNSUPPORTED_TEST_CASE"):
            d.calendar_check(self.evidence, trade_date="2026-09-10")

    @patch.dict(os.environ, {"SECTORS_API_KEY": "synthetic-test-secret"})
    def test_unverified_calendar_stops_before_fetch(self):
        evidence = deepcopy(self.evidence)
        evidence["calendar"]["closed_weekdays_in_month"] = [d.TRADE_DATE]
        with patch("requests.get") as get, self.assertRaisesRegex(r.RegistryError, "TRADING_DATE_NOT_VERIFIED"):
            d.fetch_daily(self.cache, evidence)
        get.assert_not_called()

    def test_valid_schema_counts_absence_and_no_false_complete(self):
        result = self.report()
        self.assertEqual(result["response_row_count"], 2)
        self.assertEqual(result["unique_broker_count"], 2)
        self.assertEqual(result["registry_broker_count"], 3)
        self.assertEqual(result["registry_brokers_present"], ["ZA", "ZB"])
        self.assertEqual(result["registry_brokers_absent"], ["ZC"])
        self.assertEqual(result["unknown_broker_codes"], [])
        self.assertEqual(result["duplicate_broker_codes"], [])
        self.assertEqual(result["schema_findings"], [])
        self.assertFalse(result["safe_to_call_complete"])
        self.assertEqual(result["absence_semantics"]["documented_population"], "ACTIVE_BROKERS_ONLY")
        self.assertFalse(result["absence_semantics"]["zero_activity_proven"])
        self.assertEqual(result["population_status"], "ACTIVE_BROKER_CONTRACT_ACCEPTED")
        self.assertEqual(result["absence_semantics"]["individual_absent_broker_status"], "NOT_OBSERVED_PRESUMED_INACTIVE")
        self.assertNotIn("ABSENCE_SEMANTICS_UNRESOLVED", result["reason_codes"])
        self.assertIn("COVERAGE_UNRESOLVED", result["reason_codes"])
        self.assertEqual(result["schema_status"], "VALID")
        self.assertEqual(result["operational_completeness"], "PASS")
        self.assertTrue(result["safe_for_demo_analysis"])
        self.assertEqual(result["qualification_status"], "OPERATIONALLY_COMPLETE")
        self.assertEqual(result["external_reconciliation"], "NOT_EVALUATED")
        self.assertFalse(result["externally_proven_complete"])
        self.assertEqual(result["activity_observations"]["evaluated_rows"], 2)
        self.assertTrue(all(c["evaluated_rows"] == 2 for c in result["reconciliation_checks"][:2]))

    def test_doc_arithmetic_checks_and_aggregate_observations_separate(self):
        result = self.report()
        checks = {check["name"]: check for check in result["reconciliation_checks"]}
        self.assertEqual(checks["row_net_value"]["status"], "PASS")
        self.assertEqual(checks["row_net_lots"]["status"], "PASS")
        self.assertEqual(checks["aggregate_value"]["buy_total"], 40000)
        self.assertEqual(checks["aggregate_value"]["status"], "OBSERVED_EQUAL")
        self.assertFalse(checks["aggregate_value"]["equality_required"])
        self.assertEqual(checks["independent_stock_day_control"]["status"], "NOT_EVALUATED")

    def test_unbalanced_aggregate_alone_is_not_reconciliation_failure(self):
        self.payload["data"][0]["summary"].pop()
        result = self.report()
        self.assertNotIn("RECONCILIATION_FAILED", result["reason_codes"])
        check = next(c for c in result["reconciliation_checks"] if c["name"] == "aggregate_value")
        self.assertEqual(check["status"], "OBSERVED_DIFFERENT")
        self.assertEqual(check["buy_minus_sell"], 20000)
        self.assertEqual(result["operational_completeness"], "PASS")
        self.assertTrue(result["safe_for_demo_analysis"])

    def test_documented_net_mismatch_is_explicit(self):
        self.payload["data"][0]["summary"][0]["nval"] = 123
        result = self.report()
        self.assertIn("RECONCILIATION_FAILED", result["reason_codes"])
        check = next(c for c in result["reconciliation_checks"] if c["name"] == "row_net_value")
        self.assertEqual(check["status"], "FAIL")
        self.assertEqual(check["mismatches"][0]["expected"], 20000)

    def test_empty_distinct_from_malformed_shape_and_missing_day(self):
        self.payload["data"] = []
        result = self.report()
        self.assertEqual(result["response_row_count"], 0)
        self.assertIn("EMPTY_RESPONSE", result["reason_codes"])
        self.assertFalse(result["safe_to_call_complete"])
        self.assertEqual(result["registry_brokers_absent"], ["ZA", "ZB", "ZC"])
        for payload in [[], {}, {"data": {}}, {"data": [{"date": d.TRADE_DATE}]}]:
            with self.subTest(payload=payload):
                result = self.report(payload)
                self.assertIsNone(result["response_row_count"])
                self.assertIn("SCHEMA_INVALID", result["reason_codes"])
                self.assertNotIn("EMPTY_RESPONSE", result["reason_codes"])

    def test_identity_mismatch_extra_group_and_extra_field_rejected(self):
        for field, value in [("symbol", "TLKM.JK"), ("start", "2026-09-08"), ("end", "2026-09-10")]:
            payload = deepcopy(self.payload)
            payload[field] = value
            self.assertIn("SCHEMA_INVALID", self.report(payload)["reason_codes"])
        self.payload["data"].append(deepcopy(self.payload["data"][0]))
        self.payload["data"][1]["date"] = "2026-09-10"
        result = self.report()
        self.assertEqual(result["response_row_count"], 4)
        self.assertIn("SCHEMA_INVALID", result["reason_codes"])
        self.assertEqual(result["duplicate_broker_codes"], ["ZA", "ZB"])
        self.assertTrue(all(c["status"] == "NOT_EVALUATED" for c in result["reconciliation_checks"]))

    def test_duplicate_unknown_and_malformed_rows_not_dropped(self):
        rows = self.payload["data"][0]["summary"]
        rows.append(deepcopy(rows[0]))
        rows.append(dict(rows[1], broker_code="ZZ"))
        rows.append(None)
        result = self.report()
        self.assertEqual(result["response_row_count"], 5)
        self.assertEqual(result["unique_broker_count"], 3)
        self.assertEqual(result["duplicate_broker_codes"], ["ZA"])
        self.assertEqual(result["unknown_broker_codes"], ["ZZ"])
        self.assertIn("SCHEMA_INVALID", result["reason_codes"])
        self.assertIn("DUPLICATE_BROKER", result["reason_codes"])
        self.assertIn("UNKNOWN_BROKER", result["reason_codes"])

    def test_null_missing_and_invalid_numeric_never_become_zero(self):
        row = self.payload["data"][0]["summary"][0]
        row["bval"] = None
        del row["bfreq"]
        row["blot"] = "3"
        row["sfreq"] = True
        row["sval"] = -1
        row["bavg_per_share"] = float("inf")
        # A syntactically valid JSON exponent may overflow Python float.
        body = json.dumps(self.payload).replace("Infinity", "1e999").encode()
        result = self.report(body=body)
        self.assertEqual(len(result["null_required_fields"]), 1)
        self.assertEqual(len(result["missing_required_fields"]), 1)
        self.assertEqual(len(result["invalid_numeric_fields"]), 4)
        checks = {c["name"]: c for c in result["reconciliation_checks"]}
        self.assertEqual(checks["row_net_value"]["status"], "NOT_EVALUATED")
        self.assertEqual(checks["aggregate_value"]["status"], "NOT_EVALUATED")
        self.assertNotIn("buy_total", checks["aggregate_value"])

    def test_zero_side_null_average_is_accepted_and_raw_null_preserved(self):
        for side in ("b", "s"):
            with self.subTest(side=side):
                payload = deepcopy(self.payload)
                row = payload["data"][0]["summary"][0]
                row.update({side + field: 0 for field in ("freq", "lot", "val")})
                row[side + "avg_per_share"] = None
                row.update(nval=row["bval"] - row["sval"], nlot=row["blot"] - row["slot"])
                original = deepcopy(payload)
                directory = self.observation(payload)
                archived = {name: (directory / name).read_bytes() for name in ("body.bin", "metadata.json")}
                result = d.qualify(directory, self.registry, self.evidence)
                self.assertNotIn("SCHEMA_INVALID", result["reason_codes"])
                self.assertIn("KNOWN_NULLABILITY_DEVIATION", result["reason_codes"])
                self.assertEqual(result["schema_status"], "VALID_WITH_KNOWN_PROVIDER_DEVIATION")
                self.assertEqual(result["operational_completeness"], "PASS")
                self.assertTrue(result["safe_for_demo_analysis"])
                self.assertEqual(len(result["known_provider_deviations"]), 1)
                self.assertEqual(len(result["null_required_fields"]), 1)
                self.assertEqual(len(result["documented_schema_findings"]), 1)
                self.assertEqual(result["schema_findings"], [])
                self.assertEqual(d.decoded_json(*d.load_observation(directory)), original)
                self.assertEqual(payload, original)
                for name, body in archived.items():
                    self.assertEqual((directory / name).read_bytes(), body)
                # The shared inspector still records the published schema deviation
                # without changing even its in-memory input or range behavior.
                self.assertEqual(len(d.inspect_schema(payload)[0]["schema_findings"]), 1)
                self.assertIsNone(row[side + "avg_per_share"])

    def test_null_average_with_any_same_side_activity_remains_invalid(self):
        for side in ("b", "s"):
            for field in ("freq", "lot", "val"):
                with self.subTest(side=side, field=field):
                    payload = deepcopy(self.payload)
                    row = payload["data"][0]["summary"][0]
                    row.update({side + f: 0 for f in ("freq", "lot", "val")})
                    row[side + field] = 1
                    row[side + "avg_per_share"] = None
                    row.update(nval=row["bval"] - row["sval"], nlot=row["blot"] - row["slot"])
                    result = self.report(payload)
                    self.assertEqual(result["schema_status"], "INVALID")
                    self.assertIn("SCHEMA_INVALID", result["reason_codes"])
                    self.assertEqual(result["known_provider_deviations"], [])
                    self.assertEqual(result["operational_completeness"], "FAIL")
                    self.assertFalse(result["safe_for_demo_analysis"])

    def test_operational_failures_cannot_be_accepted(self):
        cases = {
            "identity": lambda p: p.update(symbol="TLKM.JK"),
            "missing_day": lambda p: p.update(data=[]),
            "wrong_day": lambda p: p["data"][0].update(date="2026-09-08"),
            "empty": lambda p: p["data"][0].update(summary=[]),
            "duplicate": lambda p: p["data"][0]["summary"].append(deepcopy(p["data"][0]["summary"][0])),
            "unknown": lambda p: p["data"][0]["summary"][0].update(broker_code="ZZ"),
            "numeric": lambda p: p["data"][0]["summary"][0].update(bval="30000"),
            "null_activity": lambda p: p["data"][0]["summary"][0].update(bval=None),
            "net_value": lambda p: p["data"][0]["summary"][0].update(nval=1),
            "net_lots": lambda p: p["data"][0]["summary"][0].update(nlot=1),
            "net_average_null": lambda p: p["data"][0]["summary"][0].update(navg_per_share=None),
        }
        for name, mutate in cases.items():
            with self.subTest(case=name):
                payload = deepcopy(self.payload)
                mutate(payload)
                result = self.report(payload)
                self.assertEqual(result["operational_completeness"], "FAIL")
                self.assertFalse(result["safe_for_demo_analysis"])
                self.assertFalse(result["externally_proven_complete"])
        self.assertFalse(self.report(status=503)["safe_for_demo_analysis"])
        self.evidence["calendar"]["closed_weekdays_in_month"] = [d.TRADE_DATE]
        self.assertFalse(self.report()["safe_for_demo_analysis"])
        self.evidence = d.load_evidence()
        self.registry["latest_applied_snapshot"]["source"] = "synthetic"
        self.assertFalse(self.report()["safe_for_demo_analysis"])

    def test_null_exception_requires_valid_zeros_and_does_not_hide_other_errors(self):
        for side in ("b", "s"):
            for field in ("freq", "lot", "val"):
                for invalid in (None, False, "0", 0.0, -1):
                    with self.subTest(side=side, field=field, invalid=invalid):
                        payload = deepcopy(self.payload)
                        row = payload["data"][0]["summary"][0]
                        row.update({side + f: 0 for f in ("freq", "lot", "val")})
                        row[side + "avg_per_share"] = None
                        row[side + field] = invalid
                        result = self.report(payload)
                        self.assertEqual(result["known_provider_deviations"], [])
                        self.assertIn("SCHEMA_INVALID", result["reason_codes"])
                        self.assertFalse(result["safe_for_demo_analysis"])
        row = self.payload["data"][0]["summary"][0]
        row.update(bval=0, blot=0, bfreq=0, bavg_per_share=None, sval=None)
        result = self.report()
        self.assertEqual(len(result["known_provider_deviations"]), 1)
        self.assertFalse(any(f["path"].endswith(".bavg_per_share") for f in result["schema_findings"]))
        self.assertIn("SCHEMA_INVALID", result["reason_codes"])
        self.assertFalse(result["safe_for_demo_analysis"])

    def test_duplicate_json_keys_nonfinite_and_invalid_encoding(self):
        for body, encoding in [(b'{"data":[],"data":[]}', "identity"), (b'{', "identity"),
                               (b'NaN', "identity"), (b'\xff', "identity"), (b'bad gzip', "gzip")]:
            with self.subTest(body=body):
                result = self.report(body=body, encoding=encoding)
                self.assertIn("SCHEMA_INVALID", result["reason_codes"])
                self.assertIsNone(result["response_row_count"])

    def test_exact_gzip_bytes_archived_and_verified_before_decoding(self):
        body = gzip.compress(json.dumps(self.payload).encode(), mtime=0)
        directory = self.observation(body=body, encoding="gzip")
        self.assertEqual((directory / "body.bin").read_bytes(), body)
        meta, saved = d.load_observation(directory)
        self.assertEqual(meta["sha256"], r.sha256(body))
        self.assertEqual(d.decoded_json(meta, saved), self.payload)
        (directory / "body.bin").write_bytes(b'tampered')
        with self.assertRaisesRegex(r.RegistryError, "CHECKSUM_MISMATCH"):
            d.load_observation(directory)

    @patch.dict(os.environ, {"SECTORS_API_KEY": "synthetic-test-secret"})
    def test_live_request_fixed_date_raw_auth_and_wire_body_capture(self):
        body = gzip.compress(json.dumps(self.payload).encode(), mtime=0)
        get = Mock(return_value=self.response(body, headers={"Content-Encoding": "gzip"}))
        directory = d.fetch_daily(self.cache, self.evidence, get=get)
        get.assert_called_once_with(d.ENDPOINT, params={"start": d.TRADE_DATE, "end": d.TRADE_DATE},
            headers={"Authorization": "synthetic-test-secret", "Accept": "application/json"},
            timeout=30, allow_redirects=False, stream=True)
        self.assertEqual((directory / "body.bin").read_bytes(), body)
        meta, saved = d.load_observation(directory)
        self.assertEqual(meta["source"], "live")
        self.assertEqual(meta["request_url"], d.REQUEST_URL)
        self.assertNotIn("synthetic-test-secret", json.dumps(meta))
        self.assertNotIn("Authorization", json.dumps(meta))
        self.assertEqual(d.decoded_json(meta, saved), self.payload)

    @patch.dict(os.environ, {}, clear=True)
    def test_missing_key_never_requests(self):
        with patch("requests.get") as get, self.assertRaisesRegex(r.RegistryError, "MISSING_API_KEY"):
            d.fetch_daily(self.cache, self.evidence)
        get.assert_not_called()

    @patch.dict(os.environ, {"SECTORS_API_KEY": "synthetic-test-secret"})
    def test_403_archived_not_retried_and_reports_no_rows(self):
        get = Mock(return_value=self.response(b'{"error": "denied"}', status=403))
        directory = d.fetch_daily(self.cache, self.evidence, get=get)
        get.assert_called_once()
        result = d.qualify(directory, self.registry, self.evidence)
        self.assertIn("HTTP_STATUS_403", result["reason_codes"])
        self.assertIsNone(result["response_row_count"])
        self.assertNotIn("EMPTY_RESPONSE", result["reason_codes"])

    @patch.dict(os.environ, {"SECTORS_API_KEY": "synthetic-test-secret"})
    def test_transient_retry_archives_both_responses(self):
        get = Mock(side_effect=[self.response(b'busy', 503), self.response()])
        sleep = Mock()
        directory = d.fetch_daily(self.cache, self.evidence, get=get, sleep=sleep)
        self.assertEqual(get.call_count, 2)
        sleep.assert_called_once_with(1)
        self.assertEqual(len(list(self.cache.glob("*/body.bin"))), 2)
        self.assertEqual(d.load_observation(directory)[0]["http_status"], 200)

    def test_default_cache_replay_never_fetches(self):
        directory = self.observation()
        with patch.object(d, "fetch_daily") as fetch:
            self.assertEqual(d.acquire_daily(self.cache, self.evidence)[0], directory)
            self.assertEqual(d.acquire_daily(self.cache, self.evidence, live=True)[0], directory)
            fetch.assert_not_called()
        with self.assertRaisesRegex(r.RegistryError, "INVALID_OPTIONS"):
            d.acquire_daily(self.cache, self.evidence, force_refresh=True)

    def test_real_registry_requirement_and_read_only_cli(self):
        db_path = self.root / "registry.sqlite3"
        connection = r.connect(db_path)
        initial = r.load_snapshot(FIXTURES / "synthetic-initial")
        # Simulate local real-source provenance in a temporary test database only.
        r.refresh(connection, replace(initial, source="local"))
        connection.close()
        original_db = db_path.read_bytes()
        registry = d.current_registry(db_path)
        self.assertEqual(len(registry["broker_codes"]), 5)
        directory = self.observation()
        report_path = self.root / "qualification.json"
        with patch("requests.get") as get, patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(main(["qualify-day", "--observation", str(directory), "--registry-db", str(db_path),
                                   "--report", str(report_path)]), 0)
        get.assert_not_called()
        self.assertEqual(db_path.read_bytes(), original_db)
        result = json.loads(report_path.read_text())
        self.assertFalse(result["safe_to_call_complete"])
        self.assertTrue(result["safe_for_demo_analysis"])
        synthetic_db = self.root / "synthetic.sqlite3"
        connection = r.connect(synthetic_db)
        r.refresh(connection, initial)
        connection.close()
        with self.assertRaisesRegex(r.RegistryError, "REAL_REGISTRY_REQUIRED"):
            d.current_registry(synthetic_db)


class ContentEncodingTests(unittest.TestCase):
    """The live API serves zstd; archives predating its support said 'unsupported'."""

    payload = {"symbol": "BBCA.JK", "data": []}

    def body(self):
        return json.dumps(self.payload).encode()

    def test_zstd_body_decodes(self):
        from compression import zstd
        meta = {"content_encoding": "zstd"}
        self.assertEqual(d.decoded_json(meta, zstd.compress(self.body())), self.payload)

    def test_legacy_unsupported_marker_is_recovered_by_magic_number(self):
        """Bodies already paid for must not need a re-fetch to become readable."""
        from compression import zstd
        for encoding, blob in (("zstd", zstd.compress(self.body())),
                               ("gzip", gzip.compress(self.body(), mtime=0)),
                               ("identity", self.body())):
            with self.subTest(encoding=encoding):
                self.assertEqual(d.sniff_encoding(blob), encoding)
                self.assertEqual(d.decoded_json({"content_encoding": "unsupported"}, blob),
                                 self.payload)

    def test_corrupt_zstd_reports_decoding_failure_not_a_crash(self):
        meta = {"content_encoding": "zstd"}
        corrupt = b"\x28\xb5\x2f\xfd" + b"garbage"
        with self.assertRaisesRegex(r.RegistryError, "CONTENT_DECODING_FAILED"):
            d.decoded_json(meta, corrupt)

    def test_transport_records_zstd_rather_than_discarding_it(self):
        self.assertIn("zstd", d.TRANSPORT_ENCODINGS)
        self.assertIn("zstd", d.ARCHIVE_ENCODINGS)


if __name__ == "__main__":
    unittest.main()
