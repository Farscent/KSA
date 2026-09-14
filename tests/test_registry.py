from dataclasses import replace
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import requests

from sectors import registry as r
from sectors.__main__ import main

FIXTURES = Path(__file__).parent / "fixtures"


class FoundationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cache = self.root / "cache"
        self.db = r.connect(self.root / "test.sqlite3")
        self.addCleanup(self.db.close)
        self.initial = r.load_snapshot(FIXTURES / "synthetic-initial")
        self.rows = r.validate(self.initial)

    def snapshot(self, rows=None, *, stamp="2040-01-02T00:00:00Z", status=200, body=None):
        return r.capture(self.cache, body if body is not None else json.dumps(
            self.rows if rows is None else rows).encode(),
            retrieved_at=stamp, http_status=status, source="synthetic")

    def test_documented_shape_raw_preservation_and_null_normalization(self):
        original = self.initial.body
        self.assertIsNone(self.rows[-1]["cohort"])
        r.refresh(self.db, self.initial)
        self.assertEqual(self.db.execute("SELECT cohort FROM dim_broker WHERE broker_code = 'ZE'").fetchone()[0], "unknown")
        self.assertIsNone(self.rows[-1]["cohort"])
        self.assertEqual(self.initial.body, original)
        self.assertIsNone(self.db.execute("SELECT license_type FROM dim_broker WHERE broker_code = 'ZE'").fetchone()[0])

    def test_profile_counts_and_registry_shares(self):
        report = r.profile(self.rows)
        self.assertEqual(report["broker_count"], 5)
        for cohort, count in zip(r.COHORTS, [1, 1, 1, 2]):
            self.assertEqual(report["cohorts"][cohort], {"broker_count": count, "registry_share": count / 5})
        self.assertIn("not trading coverage", report["measure"])
        self.assertEqual(sum(item["registry_share"] for item in report["cohorts"].values()), 1)

    def test_empty_profile_and_refresh_guard(self):
        report = r.profile([])
        self.assertEqual(report["reason_code"], "EMPTY_REGISTRY")
        self.assertTrue(all(item["registry_share"] is None for item in report["cohorts"].values()))
        with self.assertRaisesRegex(r.RegistryError, "EMPTY_REGISTRY"):
            r.refresh(self.db, self.snapshot([]))

    def test_invalid_fixtures(self):
        cases = {"synthetic-malformed": "MALFORMED_JSON", "synthetic-wrong-shape": "INVALID_SOURCE_SHAPE",
                 "synthetic-duplicate": "DUPLICATE_BROKER_CODE", "synthetic-unexpected": "UNEXPECTED_COHORT"}
        for name, code in cases.items():
            with self.subTest(name=name), self.assertRaisesRegex(r.RegistryError, code):
                r.refresh(self.db, r.load_snapshot(FIXTURES / name))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM registry_snapshot").fetchone()[0], 0)

    def test_strict_types_fields_and_json(self):
        cases = [dict(self.rows[0], is_foreign=1), dict(self.rows[0], name=""),
                 dict(self.rows[0], code=" ZA"), dict(self.rows[0], license_type=[]),
                 dict(self.rows[0], cohort=["retail"]), dict(self.rows[0], extra="unexpected")]
        missing = self.rows[0].copy()
        del missing["cohort"]
        cases.extend([missing, None])
        for row in cases:
            with self.subTest(row=row), self.assertRaises(r.RegistryError):
                r.validate(self.snapshot([row]))
        for body in [b'[{"code":"ZA","code":"ZB"}]', b'[NaN]', b'\xff']:
            with self.subTest(body=body), self.assertRaisesRegex(r.RegistryError, "MALFORMED_JSON"):
                r.validate(self.snapshot(body=body))

    def test_capture_bytes_before_validation_and_checksum(self):
        body = b'  {"malformed":\r\n'
        snapshot = self.snapshot(body=body)
        directory = self.cache / snapshot.snapshot_id
        self.assertEqual((directory / "body.bin").read_bytes(), body)
        self.assertEqual(r.load_snapshot(directory).sha256, r.sha256(body))
        with self.assertRaisesRegex(r.RegistryError, "MALFORMED_JSON"):
            r.validate(snapshot)
        (directory / "body.bin").write_bytes(b'[]')
        with self.assertRaisesRegex(r.RegistryError, "CHECKSUM_MISMATCH"):
            r.load_snapshot(directory)

    def test_manifest_validation(self):
        for field, value in [("http_status", True), ("retrieved_at", "2040-01-01"),
                             ("snapshot_id", "invalid"), ("endpoint", "https://example.test/"),
                             ("source", []), ("Authorization", "synthetic-secret")]:
            snapshot = self.snapshot()
            directory = self.cache / snapshot.snapshot_id
            meta = snapshot.metadata()
            meta[field] = value
            (directory / "metadata.json").write_text(json.dumps(meta))
            with self.subTest(field=field), self.assertRaises(r.RegistryError):
                r.load_snapshot(directory)

    def test_exact_replay_and_later_identical_body(self):
        first = r.refresh(self.db, self.initial)
        self.assertEqual(first["inserted_versions"], 5)
        self.assertTrue(r.refresh(self.db, self.initial)["already_applied"])
        self.assertEqual(r.refresh(self.db, self.snapshot(body=self.initial.body))["inserted_versions"], 0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM dim_broker").fetchone()[0], 5)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM registry_snapshot").fetchone()[0], 2)

    def test_changed_attributes_one_new_version_and_boundary_join(self):
        r.refresh(self.db, self.initial)
        changed = r.load_snapshot(FIXTURES / "synthetic-changed")
        outcome = r.refresh(self.db, changed)
        self.assertEqual(outcome["inserted_versions"], 1)
        self.assertEqual(outcome["changed_brokers"], 1)
        versions = self.db.execute("SELECT * FROM dim_broker WHERE broker_code = 'ZA' ORDER BY valid_from").fetchall()
        self.assertEqual(len(versions), 2)
        self.assertEqual(versions[0]["valid_to"], versions[1]["valid_from"])
        self.assertIsNone(versions[1]["valid_to"])
        active = self.db.execute("""SELECT cohort FROM dim_broker WHERE broker_code = 'ZA'
            AND valid_from <= ? AND (valid_to IS NULL OR ? < valid_to)""",
            (changed.retrieved_at, changed.retrieved_at)).fetchall()
        self.assertEqual([row[0] for row in active], ["retail"])
        before = self.db.execute("SELECT COUNT(*) FROM dim_broker WHERE valid_from <= '2039-01-01'").fetchone()[0]
        self.assertEqual(before, 0)
        self.assertTrue(r.refresh(self.db, self.initial)["already_applied"])
        self.assertTrue(r.refresh(self.db, changed)["already_applied"])
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM dim_broker").fetchone()[0], 6)

    def test_all_tracked_attributes_trigger_versions(self):
        for field, value in [("name", "Synthetic Renamed Broker"), ("is_foreign", True),
                             ("license_type", "Synthetic changed license"), ("cohort", "retail")]:
            with self.subTest(field=field):
                db = r.connect(self.root / (field + ".sqlite3"))
                try:
                    r.refresh(db, self.initial)
                    rows = [dict(row) for row in self.rows]
                    rows[0][field] = value
                    self.assertEqual(r.refresh(db, self.snapshot(rows))["inserted_versions"], 1)
                finally:
                    db.close()

    def test_canonical_hash_order_and_null_unknown_equivalence(self):
        r.refresh(self.db, self.initial)
        rows = [{key: row[key] for key in reversed(list(row))} for row in reversed(self.rows)]
        rows[0]["cohort"] = "unknown"
        self.assertEqual(r.refresh(self.db, self.snapshot(rows))["inserted_versions"], 0)

    def test_missing_brokers_retained_and_reappearance(self):
        r.refresh(self.db, self.initial)
        outcome = r.refresh(self.db, self.snapshot(self.rows[:-1]))
        self.assertEqual(outcome["missing_brokers_retained"], ["ZE"])
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM dim_broker WHERE valid_to IS NULL").fetchone()[0], 5)
        self.assertEqual(r.refresh(self.db, self.snapshot(stamp="2040-01-03T00:00:00Z"))["inserted_versions"], 0)

    def test_out_of_order_and_equal_timestamp_rejected(self):
        r.refresh(self.db, self.initial)
        for stamp in ["2039-12-31T00:00:00Z", "2040-01-01T00:00:00Z"]:
            with self.subTest(stamp=stamp), self.assertRaisesRegex(r.RegistryError, "OUT_OF_ORDER"):
                r.refresh(self.db, self.snapshot(stamp=stamp))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM registry_snapshot").fetchone()[0], 1)

    def test_snapshot_id_collision_rejected(self):
        r.refresh(self.db, self.initial)
        with self.assertRaisesRegex(r.RegistryError, "SNAPSHOT_ID_CONFLICT"):
            r.refresh(self.db, replace(self.initial, retrieved_at="2040-01-02T00:00:00.000000Z"))

    def test_unchanged_observation_advances_ordering_watermark(self):
        r.refresh(self.db, self.initial)
        r.refresh(self.db, self.snapshot(stamp="2040-01-03T00:00:00Z"))
        with self.assertRaisesRegex(r.RegistryError, "OUT_OF_ORDER"):
            r.refresh(self.db, r.load_snapshot(FIXTURES / "synthetic-changed"))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM dim_broker").fetchone()[0], 5)

    def test_no_overlaps_and_one_current_enforced_in_sql(self):
        r.refresh(self.db, self.initial)
        r.refresh(self.db, r.load_snapshot(FIXTURES / "synthetic-changed"))
        overlap = self.db.execute("""SELECT COUNT(*) FROM dim_broker a JOIN dim_broker b
            ON a.broker_code=b.broker_code AND a.broker_version_id < b.broker_version_id
            AND (a.valid_to IS NULL OR b.valid_from < a.valid_to)
            AND (b.valid_to IS NULL OR a.valid_from < b.valid_to)""").fetchone()[0]
        self.assertEqual(overlap, 0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM dim_broker WHERE valid_to IS NULL").fetchone()[0], 5)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE dim_broker SET valid_to=NULL WHERE broker_code='ZA' AND valid_to IS NOT NULL")
        self.db.rollback()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO dim_broker SELECT 'collision', broker_code, broker_name,
                is_foreign, cohort, license_type, valid_from, valid_to, source_snapshot_id,
                attribute_hash FROM dim_broker WHERE broker_code='ZA' AND valid_to IS NULL""")
        self.db.rollback()

    def test_refresh_rolls_back_close_insert_and_ledger_on_failure(self):
        r.refresh(self.db, self.initial)
        self.db.execute("""CREATE TRIGGER test_failure BEFORE INSERT ON dim_broker
            WHEN NEW.broker_code = 'ZA' BEGIN SELECT RAISE(ABORT, 'injected failure'); END""")
        with self.assertRaises(sqlite3.IntegrityError):
            r.refresh(self.db, r.load_snapshot(FIXTURES / "synthetic-changed"))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM registry_snapshot").fetchone()[0], 1)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM dim_broker WHERE valid_to IS NULL").fetchone()[0], 5)
        self.assertFalse(self.db.in_transaction)

    def test_synthetic_real_provenance_guard(self):
        r.refresh(self.db, self.initial)
        with self.assertRaisesRegex(r.RegistryError, "MIXED_PROVENANCE"):
            r.refresh(self.db, replace(self.snapshot(), source="live"))

    def test_cache_default_and_explicit_live_gate(self):
        with patch.object(r, "fetch_live") as live:
            with self.assertRaisesRegex(r.RegistryError, "NO_VALID_CACHE"):
                r.acquire(self.cache)
            snapshot = self.snapshot()
            for allow_live in [False, True]:
                result, _ = r.acquire(self.cache, live=allow_live)
                self.assertEqual(result.snapshot_id, snapshot.snapshot_id)
            live.assert_not_called()
            r.acquire(self.cache, live=True, force_refresh=True)
            live.assert_called_once()
        with self.assertRaisesRegex(r.RegistryError, "INVALID_OPTIONS"):
            r.acquire(self.cache, force_refresh=True)

    def test_bad_cache_is_flagged_without_network(self):
        good = self.snapshot()
        self.snapshot(body=b'{', stamp="2040-01-03T00:00:00Z")
        self.snapshot(status=503, stamp="2040-01-04T00:00:00Z")
        result, warnings = r.acquire(self.cache)
        self.assertEqual(result.snapshot_id, good.snapshot_id)
        self.assertEqual(len(warnings), 2)

    def response(self, status=200, body=None, headers=None):
        response = requests.Response()
        response.status_code = status
        response._content = self.initial.body if body is None else body
        response._content_consumed = True
        response.headers.update(headers or {})
        response.request = requests.Request("GET", r.ENDPOINT).prepare()
        response.url = r.ENDPOINT
        return response

    @patch.dict("os.environ", {"SECTORS_API_KEY": "synthetic-test-secret"})
    def test_live_mock_headers_timeout_and_raw_archive(self):
        get = Mock(return_value=self.response())
        snapshot = r.fetch_live(self.cache, get=get, timeout=7)
        get.assert_called_once_with(
            r.ENDPOINT, headers={"Authorization": "synthetic-test-secret", "Accept": "application/json"},
            timeout=7, allow_redirects=False,
        )
        meta = (self.cache / snapshot.snapshot_id / "metadata.json").read_text()
        self.assertNotIn("secret", meta)
        self.assertNotIn("Authorization", meta)
        self.assertEqual(r.load_snapshot(self.cache / snapshot.snapshot_id).body, self.initial.body)

    @patch.dict("os.environ", {"SECTORS_API_KEY": "synthetic-test-secret"}, clear=True)
    def test_live_prepared_request_matches_standalone_requests_get(self):
        # Exercise real requests preparation/session defaults, intercepting only
        # the final adapter so neither request can reach an external service.
        sent = []

        def send(adapter, prepared, **kwargs):
            sent.append((prepared, kwargs, adapter.max_retries.total))
            response = self.response()
            response.request = prepared
            response.url = prepared.url
            return response

        with patch("requests.sessions.get_netrc_auth", return_value=None), \
                patch("requests.adapters.HTTPAdapter.send", autospec=True, side_effect=send):
            with requests.get(r.ENDPOINT, headers={"Authorization": "synthetic-test-secret",
                                                  "Accept": "application/json"}, timeout=30):
                pass
            r.fetch_live(self.cache, timeout=30)
        self.assertEqual(len(sent), 2)
        standalone, project = sent
        for prepared, settings, adapter_retries in sent:
            self.assertEqual(prepared.method, "GET")
            self.assertEqual(prepared.url, r.ENDPOINT)
            self.assertEqual(prepared.headers["Authorization"], "synthetic-test-secret")
            self.assertEqual(prepared.headers["Accept"], "application/json")
            self.assertEqual(prepared.headers["User-Agent"], requests.utils.default_user_agent())
            self.assertIsNone(prepared.body)
            self.assertTrue(settings["verify"])
            self.assertIsNone(settings["cert"])
            self.assertEqual(settings["proxies"], {})
            self.assertEqual(adapter_retries, 0)
        self.assertEqual(dict(project[0].headers), dict(standalone[0].headers))
        self.assertEqual(project[1], standalone[1])

    @patch.dict("os.environ", {"SECTORS_API_KEY": "synthetic-test-secret"})
    def test_redirect_is_archived_without_a_second_request(self):
        with patch("requests.adapters.HTTPAdapter.send", return_value=self.response(
                302, b'redirect response', {"Location": "https://example.test/"})) as send:
            with self.assertRaisesRegex(r.RegistryError, "HTTP_STATUS_302"):
                r.fetch_live(self.cache)
        send.assert_called_once()
        snapshot = r.load_snapshot(next(self.cache.iterdir()))
        self.assertEqual(snapshot.http_status, 302)
        self.assertEqual(snapshot.body, b'redirect response')

    @patch.dict("os.environ", {"SECTORS_API_KEY": "synthetic-test-secret"})
    def test_403_cli_archives_once_without_opening_or_modifying_database(self):
        r.refresh(self.db, self.initial)
        db_path = self.root / "test.sqlite3"
        before = db_path.read_bytes()
        body = b'{"error_code":1010}'
        with patch("requests.get", return_value=self.response(403, body)) as get, \
                patch("sectors.__main__.connect") as connect, \
                patch("sys.stderr", new_callable=io.StringIO) as err:
            self.assertEqual(main(["registry", "--live", "--refresh", "--cache", str(self.cache),
                                   "--db", str(db_path)]), 1)
        self.assertIn("HTTP_STATUS_403", err.getvalue())
        self.assertNotIn("synthetic-test-secret", err.getvalue())
        get.assert_called_once()
        connect.assert_not_called()
        self.assertEqual(db_path.read_bytes(), before)
        snapshots = list(self.cache.iterdir())
        self.assertEqual(len(snapshots), 1)
        self.assertEqual(r.load_snapshot(snapshots[0]).body, body)

    def test_key_whitespace_is_rejected_before_request(self):
        for key in [" synthetic-test-secret", "synthetic-test-secret\n", "synthetic\ttest-secret"]:
            with self.subTest(key=key), patch.dict("os.environ", {"SECTORS_API_KEY": key}), \
                    patch("requests.get") as get:
                with self.assertRaisesRegex(r.RegistryError, "INVALID_API_KEY_FORMAT"):
                    r.fetch_live(self.cache)
                get.assert_not_called()

    def test_requests_is_optional_for_offline_replay(self):
        with patch.dict(sys.modules, {"requests": None}), patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(main(["registry", "--snapshot", str(FIXTURES / "synthetic-initial"),
                                   "--db", str(self.root / "offline-only.sqlite3")]), 0)
            with patch.dict("os.environ", {"SECTORS_API_KEY": "synthetic-test-secret"}):
                with self.assertRaisesRegex(r.RegistryError, "MISSING_HTTP_DEPENDENCY"):
                    r.fetch_live(self.cache)

    @patch.dict("os.environ", {"SECTORS_API_KEY": "synthetic-test-secret"})
    def test_retry_transient_http_and_archive_every_response(self):
        get = Mock(side_effect=[self.response(429, b'{}', {"Retry-After": "3"}),
                               self.response(status=503, body=b'busy'), self.response()])
        sleep = Mock()
        r.fetch_live(self.cache, get=get, sleep=sleep)
        self.assertEqual(get.call_count, 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [3, 2])
        self.assertEqual(len(list(self.cache.glob("*/body.bin"))), 3)

    @patch.dict("os.environ", {"SECTORS_API_KEY": "synthetic-test-secret"})
    def test_transport_retries_bounded_and_error_sanitized(self):
        get = Mock(side_effect=requests.ConnectionError("synthetic-test-secret"))
        with self.assertRaisesRegex(r.RegistryError, "FETCH_TRANSPORT_FAILED") as caught:
            r.fetch_live(self.cache, get=get, sleep=Mock())
        self.assertEqual(get.call_count, 3)
        self.assertNotIn("synthetic-test-secret", str(caught.exception))

    @patch.dict("os.environ", {"SECTORS_API_KEY": "synthetic-test-secret"})
    def test_http_retries_exhaust_without_database_change(self):
        get = Mock(side_effect=[self.response(503, b'unavailable') for _ in range(3)])
        with self.assertRaisesRegex(r.RegistryError, "HTTP_STATUS_503"):
            r.fetch_live(self.cache, get=get, sleep=Mock())
        self.assertEqual(get.call_count, 3)
        self.assertEqual(len(list(self.cache.glob("*/body.bin"))), 3)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM registry_snapshot").fetchone()[0], 0)

    @patch.dict("os.environ", {"SECTORS_API_KEY": "synthetic-test-secret"})
    def test_permanent_error_malformed_success_and_long_retry_after_not_retried(self):
        for status, body, headers in [(401, b'{}', {}), (403, b'{}', {}), (302, b'', {}), (200, b'{', {}),
                                      (429, b'{}', {"Retry-After": "120"})]:
            get = Mock(return_value=self.response(status, body, headers))
            with self.subTest(status=status), self.assertRaises(r.RegistryError):
                r.fetch_live(self.cache, get=get, sleep=Mock())
            self.assertEqual(get.call_count, 1)
        self.assertEqual(len(list(self.cache.glob("*/body.bin"))), 5)

    def test_retry_after_date_and_options_validation(self):
        date = (datetime.now(timezone.utc) + timedelta(seconds=120)).strftime("%a, %d %b %Y %H:%M:%S GMT")
        self.assertIsNone(r.retry_delay(date, 0))
        self.assertEqual(r.retry_delay("invalid", 0), 1)
        for timeout, retries in [(0, 2), (61, 2), (float("nan"), 2), (15, 4), (15, -1)]:
            with self.assertRaisesRegex(r.RegistryError, "INVALID_FETCH_OPTIONS"):
                r.fetch_live(self.cache, timeout=timeout, retries=retries)

    @patch.dict("os.environ", {"SECTORS_API_KEY": "synthetic-test-secret"})
    def test_storage_failure_does_not_retry_network(self):
        get = Mock(return_value=self.response())
        with patch.object(r, "capture", side_effect=OSError), self.assertRaises(OSError):
            r.fetch_live(self.cache, get=get, sleep=Mock())
        self.assertEqual(get.call_count, 1)

    @patch.dict("os.environ", {}, clear=True)
    def test_missing_credentials_no_network(self):
        with patch("requests.get") as get:
            with self.assertRaisesRegex(r.RegistryError, "MISSING_API_KEY"):
                r.fetch_live(self.cache)
            get.assert_not_called()

    def test_cli_replay_profile_errors_and_no_network(self):
        db = self.root / "cli.sqlite3"
        with patch("requests.get") as network, patch("sys.stdout", new_callable=io.StringIO) as out:
            self.assertEqual(main(["registry", "--snapshot", str(FIXTURES / "synthetic-initial"), "--db", str(db)]), 0)
            self.assertEqual(json.loads(out.getvalue())["refresh"]["inserted_versions"], 5)
            network.assert_not_called()
        with patch("sys.stderr", new_callable=io.StringIO) as err:
            self.assertEqual(main(["registry", "--snapshot", str(FIXTURES / "synthetic-malformed"), "--db", str(db)]), 1)
            self.assertIn("MALFORMED_JSON", err.getvalue())

    def test_cli_import_cache_profile_without_database(self):
        with patch("requests.get") as network, patch("sys.stdout", new_callable=io.StringIO) as out:
            self.assertEqual(main(["import-snapshot", "--body", str(FIXTURES / "synthetic-initial" / "body.bin"),
                                   "--retrieved-at", "2040-01-01T07:00:00+07:00", "--http-status", "200",
                                   "--synthetic", "--cache", str(self.cache)]), 0)
            imported = json.loads(out.getvalue())
            self.assertEqual(imported["snapshot"]["retrieved_at"], self.initial.retrieved_at)
            out.seek(0)
            out.truncate()
            db = self.root / "must-not-exist.sqlite3"
            self.assertEqual(main(["registry", "--cache", str(self.cache), "--profile-only", "--db", str(db)]), 0)
            self.assertEqual(json.loads(out.getvalue())["profile"]["broker_count"], 5)
            self.assertFalse(db.exists())
            network.assert_not_called()


if __name__ == "__main__":
    unittest.main()
