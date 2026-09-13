"""Qualification of exactly BBCA / 2026-09-09; never writes registry tables.

Archive HTTP body bytes before content decoding or JSON parsing. Report malformed
rows and uncertainty rather than repairing data or inferring absent-broker trades.
"""

from __future__ import annotations

from collections import Counter
from contextlib import closing
from datetime import date
import gzip
import json
import math
import os
from pathlib import Path
import sqlite3
import time
import uuid
import zlib

from .registry import RegistryError, RETRY_STATUSES, canonical_json, now_utc, retry_delay, sha256, strict_json, utc_timestamp

SYMBOL = "BBCA"
TRADE_DATE = "2026-09-09"
ENDPOINT = "https://api.sectors.app/v2/broker-summary/BBCA/"
PARAMS = {"start": TRADE_DATE, "end": TRADE_DATE}
REQUEST_URL = f"{ENDPOINT}?start={TRADE_DATE}&end={TRADE_DATE}"
EVIDENCE_PATH = Path(__file__).with_name("evidence") / "bbca-2026-09-09.json"
INTEGER_FIELDS = {"bfreq", "blot", "bval", "sfreq", "slot", "sval", "nlot", "nval"}
AVERAGE_FIELDS = {"bavg_per_share", "savg_per_share", "navg_per_share"}
ROW_FIELDS = INTEGER_FIELDS | AVERAGE_FIELDS | {"broker_code"}
NONNEGATIVE_FIELDS = (INTEGER_FIELDS - {"nlot", "nval"}) | {"bavg_per_share", "savg_per_share"}
META_FIELDS = {"observation_id", "requested_symbol", "requested_trade_date", "retrieved_at",
               "endpoint", "request_url", "http_status", "sha256", "source", "content_encoding"}


def load_evidence(path: Path = EVIDENCE_PATH) -> dict:
    evidence = strict_json(Path(path).read_bytes())
    if not isinstance(evidence, dict) or evidence.get("requested_symbol") != SYMBOL or evidence.get("requested_trade_date") != TRADE_DATE:
        raise RegistryError("CALENDAR_EVIDENCE_INVALID: expected reviewed BBCA one-day evidence")
    calendar = evidence.get("calendar")
    if not isinstance(calendar, dict) or calendar.get("reviewed_month") != "2026-09" or not calendar.get("document") or not calendar.get("sha256"):
        raise RegistryError("CALENDAR_EVIDENCE_INVALID: missing authoritative calendar review")
    return evidence


def calendar_check(evidence: dict, symbol: str = SYMBOL, trade_date: str = TRADE_DATE) -> dict:
    if (symbol, trade_date) != (SYMBOL, TRADE_DATE):
        raise RegistryError("UNSUPPORTED_TEST_CASE: only BBCA / 2026-09-09 is qualified")
    calendar = evidence["calendar"]
    day = date.fromisoformat(trade_date)
    # Weekday is insufficient without the reviewed exchange holiday calendar.
    applicable = (calendar.get("reviewed_month") == trade_date[:7]
                  and calendar.get("closed_weekdays") == [5, 6]
                  and isinstance(calendar.get("closed_weekdays_in_month"), list)
                  and day.weekday() not in calendar["closed_weekdays"]
                  and trade_date not in calendar["closed_weekdays_in_month"])
    return {"status": "SCHEDULED_TRADING_DATE_VERIFIED" if applicable else "TRADING_DATE_NOT_VERIFIED",
            "scheduled_trading_date": applicable, "weekday": day.strftime("%A"),
            "source": calendar, "scope": "Exchange schedule; does not certify BBCA suspension status."}


def archive(cache: Path, body: bytes, status: int, *, source: str = "live",
            retrieved_at: str | None = None, content_encoding: str = "identity") -> tuple[Path, dict]:
    if type(status) is not int or not 100 <= status <= 599 or source not in {"live", "local", "synthetic"}:
        raise RegistryError("INVALID_DAILY_PROVENANCE")
    if content_encoding not in {"identity", "gzip", "deflate", "unsupported"}:
        raise RegistryError("INVALID_CONTENT_ENCODING")
    meta = {"observation_id": str(uuid.uuid4()), "requested_symbol": SYMBOL,
            "requested_trade_date": TRADE_DATE, "retrieved_at": utc_timestamp(retrieved_at or now_utc()),
            "endpoint": ENDPOINT, "request_url": REQUEST_URL, "http_status": status,
            "sha256": sha256(body), "source": source, "content_encoding": content_encoding}
    directory = Path(cache) / meta["observation_id"]
    directory.mkdir(parents=True, exist_ok=False)
    (directory / "body.bin").write_bytes(body)
    temporary = directory / "metadata.tmp"
    temporary.write_text(canonical_json(meta) + "\n", encoding="utf-8")
    temporary.replace(directory / "metadata.json")
    return directory, meta


def load_observation(directory: Path) -> tuple[dict, bytes]:
    try:
        meta = strict_json((Path(directory) / "metadata.json").read_bytes())
        if not isinstance(meta, dict) or set(meta) != META_FIELDS:
            raise RegistryError("INVALID_DAILY_MANIFEST")
        if str(uuid.UUID(meta["observation_id"])) != meta["observation_id"]:
            raise ValueError
        if (meta["requested_symbol"], meta["requested_trade_date"], meta["endpoint"], meta["request_url"]) != (SYMBOL, TRADE_DATE, ENDPOINT, REQUEST_URL):
            raise RegistryError("UNSUPPORTED_TEST_CASE: observation identity differs from the fixed request")
        if type(meta["http_status"]) is not int or not 100 <= meta["http_status"] <= 599:
            raise ValueError
        if meta["source"] not in {"live", "local", "synthetic"} or meta["content_encoding"] not in {"identity", "gzip", "deflate", "unsupported"}:
            raise ValueError
        meta["retrieved_at"] = utc_timestamp(meta["retrieved_at"])
        body = (Path(directory) / "body.bin").read_bytes()
        if sha256(body) != meta["sha256"]:
            raise RegistryError("CHECKSUM_MISMATCH: daily observation body differs from manifest")
        return meta, body
    except (OSError, TypeError, ValueError, AttributeError):
        raise RegistryError("INVALID_DAILY_OBSERVATION") from None


def decoded_json(meta: dict, body: bytes):
    try:
        if meta["content_encoding"] == "gzip":
            body = gzip.decompress(body)
        elif meta["content_encoding"] == "deflate":
            body = zlib.decompress(body)
        elif meta["content_encoding"] != "identity":
            raise RegistryError("CONTENT_ENCODING_UNSUPPORTED: original bytes remain archived")
    except (OSError, EOFError, zlib.error):
        raise RegistryError("CONTENT_DECODING_FAILED: original bytes remain archived") from None
    return strict_json(body)


def fetch_daily(cache: Path, evidence: dict, *, timeout: float = 30, retries: int = 2,
                get=None, sleep=time.sleep) -> Path:
    if not calendar_check(evidence)["scheduled_trading_date"]:
        raise RegistryError("TRADING_DATE_NOT_VERIFIED: no request made")
    return fetch_observation(cache, PARAMS, archive, timeout=timeout, retries=retries, get=get, sleep=sleep)


def fetch_observation(cache: Path, params: dict, archive_response, *, timeout: float = 30,
                      retries: int = 2, get=None, sleep=time.sleep) -> Path:
    """Shared daily transport; caller validates its fixed calendar/request first."""
    if not math.isfinite(timeout) or not 0 < timeout <= 60 or not 0 <= retries <= 3:
        raise RegistryError("INVALID_FETCH_OPTIONS: timeout (0, 60]; retries 0..3")
    key = os.environ.get("SECTORS_API_KEY")
    if not key:
        raise RegistryError("MISSING_API_KEY: set SECTORS_API_KEY in the environment; no request made")
    if key != key.strip() or any(ord(c) < 33 or ord(c) > 126 for c in key):
        raise RegistryError("INVALID_API_KEY_FORMAT")
    try:
        import requests
        from urllib3.exceptions import HTTPError as TransportReadError
    except ImportError:
        raise RegistryError("MISSING_HTTP_DEPENDENCY: install requirements.txt") from None
    get = get or requests.get
    for attempt in range(retries + 1):
        try:
            with get(ENDPOINT, params=params, headers={"Authorization": key, "Accept": "application/json"},
                     timeout=timeout, allow_redirects=False, stream=True) as response:
                status = response.status_code
                # Preserve the entity body exactly as received, including gzip.
                body = response.raw.read(decode_content=False)
                encoding = response.headers.get("Content-Encoding", "identity").lower().strip()
                encoding = encoding if encoding in {"identity", "gzip", "deflate"} else "unsupported"
                retry_after = response.headers.get("Retry-After")
        except (requests.RequestException, TransportReadError, OSError):
            if attempt == retries:
                raise RegistryError("FETCH_TRANSPORT_FAILED: no complete daily response captured") from None
            sleep(min(2 ** attempt, 8))
            continue
        directory, _ = archive_response(cache, body, status, content_encoding=encoding)
        delay = retry_delay(retry_after, attempt)
        if status not in RETRY_STATUSES or attempt == retries or delay is None:
            return directory  # Include permanent failures in the qualification report.
        sleep(delay)
    raise AssertionError("unreachable")


def acquire_daily(cache: Path, evidence: dict, *, observation: Path | None = None,
                  live: bool = False, force_refresh: bool = False, timeout: float = 30,
                  retries: int = 2) -> tuple[Path, list[str]]:
    if observation is not None:
        if live or force_refresh:
            raise RegistryError("INVALID_OPTIONS: replay cannot use live/refresh")
        load_observation(observation)
        return observation, []
    if force_refresh and not live:
        raise RegistryError("INVALID_OPTIONS: --refresh requires --live")
    candidates, warnings = [], []
    for directory in sorted(Path(cache).glob("*")):
        if not directory.is_dir():
            continue
        try:
            meta, _ = load_observation(directory)
            if meta["http_status"] == 200:
                candidates.append((meta["retrieved_at"], meta["observation_id"], directory))
            else:
                warnings.append(f"HTTP_STATUS_{meta['http_status']}: previous daily response archived")
        except RegistryError as exc:
            warnings.append(str(exc))
    if candidates and not force_refresh:
        return max(candidates)[2], warnings
    if not live:
        raise RegistryError("NO_DAILY_CACHE: replay --observation or explicitly opt in with --live")
    return fetch_daily(cache, evidence, timeout=timeout, retries=retries), warnings


def current_registry(path: Path) -> dict:
    if not Path(path).is_file():
        raise RegistryError("REAL_REGISTRY_REQUIRED: current registry database does not exist")
    with closing(sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        snapshots = [dict(row) for row in connection.execute("SELECT * FROM registry_snapshot ORDER BY retrieved_at")]
        rows = connection.execute("SELECT broker_code, source_snapshot_id FROM dim_broker WHERE valid_to IS NULL ORDER BY broker_code").fetchall()
    if not snapshots or not rows or any(s["source"] == "synthetic" for s in snapshots):
        raise RegistryError("REAL_REGISTRY_REQUIRED: synthetic or empty registry cannot qualify real daily data")
    codes = [row["broker_code"] for row in rows]
    if len(codes) != len(set(codes)):
        raise RegistryError("INVALID_CURRENT_REGISTRY: duplicate current broker")
    return {"broker_codes": codes, "latest_applied_snapshot": snapshots[-1],
            "version_source_snapshot_ids": sorted({row["source_snapshot_id"] for row in rows}),
            "comparison_basis": "Current observed registry; not proof of membership or classification on the trade date."}


def inspect_schema(payload, *, start=TRADE_DATE, end=TRADE_DATE, allowed_dates=None,
                   multiple_dates=False, group_indices=None) -> tuple[dict, list, bool]:
    """Strict documented schema; range callers supply identity and reviewed dates.

    Nullability is never relaxed here. Qualifiers apply their analysis policies
    separately, retaining these original findings.
    """
    allowed_dates = {TRADE_DATE} if allowed_dates is None else set(allowed_dates)
    findings = {"schema_findings": [], "null_required_fields": [], "missing_required_fields": [],
                "invalid_numeric_fields": [], "response_row_count": None, "response_dates": []}
    issues = findings["schema_findings"]

    def fields(value, expected, path):
        if not isinstance(value, dict):
            issues.append({"path": path, "reason": "EXPECTED_OBJECT"})
            return False
        for field in sorted(expected - set(value)):
            findings["missing_required_fields"].append(f"{path}.{field}")
            issues.append({"path": f"{path}.{field}", "reason": "MISSING_REQUIRED_FIELD"})
        for field in sorted(expected & set(value)):
            if value[field] is None:
                findings["null_required_fields"].append(f"{path}.{field}")
                issues.append({"path": f"{path}.{field}", "reason": "NULL_REQUIRED_FIELD"})
        for field in sorted(set(value) - expected):
            issues.append({"path": f"{path}.{field}", "reason": "UNEXPECTED_FIELD"})
        return True

    if not fields(payload, {"symbol", "start", "end", "data"}, "$" ):
        return findings, [], False
    identity_ok = True
    for field, expected in (("symbol", "BBCA.JK"), ("start", start), ("end", end)):
        if payload.get(field) != expected:
            identity_ok = False
            issues.append({"path": f"$.{field}", "reason": "RESPONSE_IDENTITY_MISMATCH", "expected": expected})
    if not isinstance(payload.get("data"), list):
        issues.append({"path": "$.data", "reason": "EXPECTED_ARRAY"})
        return findings, [], False
    rows, measurable = [], identity_ok
    known_count = True
    for index, group in enumerate(payload["data"]):
        index = group_indices[index] if group_indices is not None else index
        path = f"$.data[{index}]"
        if not fields(group, {"date", "summary"}, path):
            measurable = known_count = False
            continue
        if not isinstance(group.get("date"), str) or group["date"] not in allowed_dates:
            issues.append({"path": f"{path}.date", "reason": "RESPONSE_DATE_MISMATCH", "expected": sorted(allowed_dates)})
            measurable = False
        if isinstance(group.get("date"), str):
            findings["response_dates"].append(group["date"])
        if not isinstance(group.get("summary"), list):
            issues.append({"path": f"{path}.summary", "reason": "EXPECTED_ARRAY"})
            measurable = known_count = False
            continue
        for row_index, row in enumerate(group["summary"]):
            row_path = f"{path}.summary[{row_index}]"
            rows.append((row_path, row))
            if not fields(row, ROW_FIELDS, row_path):
                measurable = False
                continue
            code = row.get("broker_code")
            if not isinstance(code, str) or not code.strip() or code != code.strip():
                issues.append({"path": f"{row_path}.broker_code", "reason": "INVALID_BROKER_CODE"})
            for field in sorted(INTEGER_FIELDS | AVERAGE_FIELDS):
                if field not in row or row[field] is None:
                    continue
                value = row[field]
                valid = type(value) is int if field in INTEGER_FIELDS else type(value) in {int, float}
                if valid and type(value) is float:
                    valid = math.isfinite(value)
                if valid and field in NONNEGATIVE_FIELDS:
                    valid = value >= 0
                if not valid:
                    findings["invalid_numeric_fields"].append({"path": f"{row_path}.{field}",
                        "reason": "EXPECTED_FINITE_NONNEGATIVE_NUMBER" if field in NONNEGATIVE_FIELDS else "EXPECTED_FINITE_NUMBER",
                        "expected_type": "integer" if field in INTEGER_FIELDS else "number",
                        "observed_type": type(value).__name__})
    if len(payload["data"]) > 1 and not multiple_dates:
        issues.append({"path": "$.data", "reason": "MULTIPLE_GROUPS_FOR_SINGLE_DAY"})
        measurable = False
    findings["response_row_count"] = len(rows) if known_count else None
    return findings, rows, measurable


def reconciliation(rows: list, findings: dict, measurable: bool, duplicates: list) -> list[dict]:
    checks = []
    invalid_paths = {item["path"] for item in findings["invalid_numeric_fields"]}

    def ready(fields):
        return (measurable and bool(rows) and not duplicates and all(
            isinstance(row, dict) and all(field in row and row[field] is not None
                and f"{path}.{field}" not in invalid_paths for field in fields)
            for path, row in rows))

    for name, buy, sell, net, unit in (
        ("row_net_value", "bval", "sval", "nval", "IDR"),
        ("row_net_lots", "blot", "slot", "nlot", "lots"),
    ):
        check = {"name": name, "unit": unit, "basis": "Documented net = buy - sell; exact integer arithmetic."}
        if ready({buy, sell, net}):
            mismatches = [{"path": path, "broker_code": row.get("broker_code"), "reported": row[net],
                           "expected": row[buy] - row[sell]} for path, row in rows if row[net] != row[buy] - row[sell]]
            check.update(status="FAIL" if mismatches else "PASS", mismatches=mismatches, evaluated_rows=len(rows))
        else:
            check.update(status="NOT_EVALUATED", reason="EMPTY_INVALID_AMBIGUOUS_OR_DUPLICATE_INPUT")
        checks.append(check)
    for name, buy, sell, unit in (("aggregate_value", "bval", "sval", "IDR"),
                                  ("aggregate_lots", "blot", "slot", "lots"),
                                  ("aggregate_frequency", "bfreq", "sfreq", "frequency count")):
        check = {"name": name, "unit": unit, "equality_required": False,
                 "basis": "Descriptive totals only: common market/session scope and frequency counting semantics are not established."}
        if ready({buy, sell}):
            buy_total, sell_total = sum(row[buy] for _, row in rows), sum(row[sell] for _, row in rows)
            check.update(status="OBSERVED_EQUAL" if buy_total == sell_total else "OBSERVED_DIFFERENT",
                         buy_total=buy_total, sell_total=sell_total, buy_minus_sell=buy_total - sell_total)
        else:
            check.update(status="NOT_EVALUATED", reason="EMPTY_INVALID_AMBIGUOUS_OR_DUPLICATE_INPUT")
        checks.append(check)
    checks.extend([
        {"name": "average_price_reconstruction", "status": "NOT_EVALUATED",
         "reason": "LOT_CONVERSION_AVERAGE_ROUNDING_AND_NET_AVERAGE_RULES_NOT_ESTABLISHED"},
        {"name": "independent_stock_day_control", "status": "NOT_EVALUATED",
         "reason": "NO_INDEPENDENT_TOTAL_WITH_VERIFIED_MATCHING_SCOPE"},
    ])
    return checks


def activity_observations(rows: list) -> dict:
    """Describe null averages/zero activity without relaxing source validation."""
    result = {"evaluated_rows": 0, "rows_not_evaluated": 0, "active_value_rows": 0,
              "both_values_zero_rows": 0, "zero_buy_side_rows": 0, "zero_sell_side_rows": 0,
              "null_average_observations": []}
    for path, row in rows:
        if not isinstance(row, dict) or not all(type(row.get(f)) is int and row[f] >= 0 for f in ("bval", "sval")):
            result["rows_not_evaluated"] += 1
            continue
        result["evaluated_rows"] += 1
        active = row["bval"] > 0 or row["sval"] > 0
        result["active_value_rows"] += int(active)
        result["both_values_zero_rows"] += int(not active)
        for side, label in (("b", "buy"), ("s", "sell")):
            side_fields = [side + field for field in ("freq", "lot", "val")]
            zero_side = all(type(row.get(field)) is int and row[field] == 0 for field in side_fields)
            result[f"zero_{label}_side_rows"] += int(zero_side)
            average = side + "avg_per_share"
            if average in row and row[average] is None:
                result["null_average_observations"].append({
                    "path": f"{path}.{average}", "broker_code": row.get("broker_code"),
                    "side_frequency_lots_value_all_zero": zero_side,
                    "interpretation": "Consistent with an undefined average on a zero-activity side; still a published-schema nullability discrepancy."
                        if zero_side else "Null average is not explained by verified zero-side activity.",
                })
    result["basis"] = "Observed rows only. No activity or averages are synthesized for absent brokers."
    return result


def qualify(directory: Path, registry: dict, evidence: dict) -> dict:
    meta, body = load_observation(directory)
    calendar = calendar_check(evidence)
    report = {"report_version": "daily-qualification-v2", "generated_at": now_utc(),
              "requested_symbol": SYMBOL, "requested_trade_date": TRADE_DATE,
              "observation": meta, "calendar": calendar, "registry_provenance": registry,
              "registry_broker_count": len(registry["broker_codes"]),
              "response_row_count": None, "unique_broker_count": None,
              "duplicate_broker_codes": [], "registry_brokers_present": [], "registry_brokers_absent": [],
              "unknown_broker_codes": [], "null_required_fields": [], "missing_required_fields": [],
              "invalid_numeric_fields": [], "schema_findings": [], "reconciliation_checks": [],
              "units": {"bval/sval/nval": "IDR", "blot/slot/nlot": "lots",
                        "bfreq/sfreq": "frequency counts; counting convention unspecified",
                        "bavg_per_share/savg_per_share/navg_per_share": "per-share averages; IDR/share inferred from value currency; net-average definition and rounding unspecified"},
              "api_evidence": evidence["api"], "reason_codes": [], "safe_to_call_complete": False,
              "externally_proven_complete": False, "external_reconciliation": "NOT_EVALUATED"}
    reasons = report["reason_codes"]
    if not calendar["scheduled_trading_date"]:
        reasons.append("TRADING_DATE_NOT_VERIFIED")
    if meta["source"] == "synthetic":
        reasons.append("SYNTHETIC_OBSERVATION")
    if meta["http_status"] != 200:
        reasons.append(f"HTTP_STATUS_{meta['http_status']}")
        payload, rows, measurable = None, [], False
    else:
        try:
            payload = decoded_json(meta, body)
            findings, rows, measurable = inspect_schema(payload)
            report.update(findings)
        except RegistryError as exc:
            payload, rows, measurable = None, [], False
            report["schema_findings"].append({"path": "$", "reason": str(exc).split(":", 1)[0]})
    # Preserve the documented findings and raw nulls; only the reviewed same-side
    # zero-activity exception is nonfatal for this single-day demo policy.
    report["activity_observations"] = activity_observations(rows)
    report["known_provider_deviations"] = []
    for path, row in rows:
        if not isinstance(row, dict):
            continue
        for side in ("b", "s"):
            average = side + "avg_per_share"
            if (average in row and row[average] is None and all(
                    type(row.get(side + field)) is int and row[side + field] == 0
                    for field in ("val", "lot", "freq"))):
                report["known_provider_deviations"].append({
                    "path": f"{path}.{average}", "broker_code": row.get("broker_code"),
                    "status": "KNOWN_NULLABILITY_DEVIATION",
                    "basis": "Explicit null average with valid same-side value, lots and frequency all zero; raw null preserved.",
                })
    accepted_paths = {item["path"] for item in report["known_provider_deviations"]}
    report["documented_schema_findings"] = report["schema_findings"]
    report["schema_findings"] = [item for item in report["schema_findings"]
        if not (item["reason"] == "NULL_REQUIRED_FIELD" and item["path"] in accepted_paths)]
    if accepted_paths:
        reasons.append("KNOWN_NULLABILITY_DEVIATION")
    if report["schema_findings"]:
        reasons.append("SCHEMA_INVALID")
    if report["invalid_numeric_fields"]:
        reasons.append("INVALID_NUMERIC_FIELD")
    report["schema_status"] = ("NOT_EVALUATED" if meta["http_status"] != 200 else
                               "INVALID" if report["schema_findings"] or report["invalid_numeric_fields"] else
                               "VALID_WITH_KNOWN_PROVIDER_DEVIATION" if accepted_paths else "VALID")
    if report["response_row_count"] == 0:
        reasons.append("EMPTY_RESPONSE")
    codes = [row["broker_code"] for _, row in rows if isinstance(row, dict)
             and isinstance(row.get("broker_code"), str) and row["broker_code"].strip()
             and row["broker_code"] == row["broker_code"].strip()]
    # Malformed records are still counted and flagged, never silently dropped.
    # Comparisons below cover only identifiable codes and say when that is partial.
    identifiable = set(codes)
    report["broker_comparison_basis"] = "Identifiable source codes; consult schema findings for any unidentifiable rows. Absence is not classified as missing data."
    report["broker_comparison_status"] = ("NOT_EVALUATED" if report["response_row_count"] is None else
                                           "PARTIAL" if len(codes) != len(rows) else "EVALUATED")
    report["registry_brokers_present"] = sorted(identifiable & set(registry["broker_codes"]))
    if report["response_row_count"] is not None:
        report["unique_broker_count"] = len(identifiable)
        report["registry_brokers_absent"] = sorted(set(registry["broker_codes"]) - identifiable)
    report["unknown_broker_codes"] = sorted(identifiable - set(registry["broker_codes"]))
    report["duplicate_broker_codes"] = sorted(code for code, count in Counter(codes).items() if count > 1)
    if report["duplicate_broker_codes"]:
        reasons.append("DUPLICATE_BROKER")
    if report["unknown_broker_codes"]:
        reasons.append("UNKNOWN_BROKER")
    report["reconciliation_checks"] = reconciliation(rows, report, measurable, report["duplicate_broker_codes"])
    if any(check["status"] == "FAIL" for check in report["reconciliation_checks"]):
        reasons.append("RECONCILIATION_FAILED")
    report["population_status"] = "ACTIVE_BROKER_CONTRACT_ACCEPTED"
    report["absence_semantics"] = {
        "documented_population": "ACTIVE_BROKERS_ONLY",
        "inference": "Under the documented contract, zero-activity brokers need not appear.",
        "individual_absent_broker_status": "NOT_OBSERVED_PRESUMED_INACTIVE",
        "zero_activity_proven": False,
        "reason": "Demo policy accepts the active-broker contract without inventing activity or rows. Current registry membership does not prove historical membership.",
    }
    reasons.append("COVERAGE_UNRESOLVED")
    report["unproven"] = [
        "Actual response covers every active broker without upstream omission or truncation.",
        "Market board/session scope and a matching independent stock-day control total.",
        "Meaning of each absent current-registry broker on the historical trading date.",
        "Historical registry membership/cohorts and any exceptional closure or BBCA suspension.",
    ]
    # run() obtains this provenance through current_registry(), which checks the
    # whole snapshot ledger read-only. Also reject absent/synthetic prerequisites
    # when the qualifier is invoked directly (e.g. by an offline test).
    registry_ok = (bool(registry["broker_codes"])
        and len(registry["broker_codes"]) == len(set(registry["broker_codes"]))
        and registry.get("latest_applied_snapshot", {}).get("source") in {"live", "local"})
    report["registry_status"] = "PASS" if registry_ok else "FAIL"
    if not registry_ok:
        reasons.append("REAL_REGISTRY_REQUIRED")
    expected_day = report.get("response_dates") == [TRADE_DATE]
    if meta["http_status"] == 200 and not expected_day:
        reasons.append("EXPECTED_TRADING_DAY_GROUP_MISSING_OR_INVALID")
    checks = {
        "http_200": meta["http_status"] == 200,
        "response_identity": isinstance(payload, dict) and all(payload.get(field) == expected
            for field, expected in (("symbol", "BBCA.JK"), ("start", TRADE_DATE), ("end", TRADE_DATE))),
        "expected_trading_day_group": expected_day,
        "nonempty_response": report["response_row_count"] is not None and report["response_row_count"] > 0,
        "unique_broker_codes": not report["duplicate_broker_codes"],
        "known_broker_codes": not report["unknown_broker_codes"],
        "analysis_schema": report["schema_status"] in {"VALID", "VALID_WITH_KNOWN_PROVIDER_DEVIATION"},
        "row_net_value": report["reconciliation_checks"][0]["status"] == "PASS",
        "row_net_lots": report["reconciliation_checks"][1]["status"] == "PASS",
        "reviewed_trading_calendar": calendar["scheduled_trading_date"],
        "real_registry": registry_ok,
    }
    report["operational_checks"] = {name: "PASS" if passed else "FAIL" for name, passed in checks.items()}
    report["safe_for_demo_analysis"] = all(checks.values())
    report["operational_completeness"] = "PASS" if report["safe_for_demo_analysis"] else "FAIL"
    report["qualification_status"] = "OPERATIONALLY_COMPLETE" if report["safe_for_demo_analysis"] else "INVALID"
    report["conclusion"] = (
        "Safe for demo analysis under the accepted operational policy. " if report["safe_for_demo_analysis"] else
        "Not safe for demo analysis: operational prerequisites or data checks failed. "
    ) + "External market-wide completeness remains unproven; no trusted matching-scope independent control exists."
    return report


def run(args) -> dict:
    evidence = load_evidence()
    if not calendar_check(evidence, args.symbol, args.trade_date)["scheduled_trading_date"]:
        raise RegistryError("TRADING_DATE_NOT_VERIFIED")
    registry = current_registry(args.registry_db)  # Check read-only prerequisites before fetching.
    directory, warnings = acquire_daily(args.cache, evidence, observation=args.observation,
        live=args.live, force_refresh=args.refresh, timeout=args.timeout, retries=args.retries)
    report = qualify(directory, registry, evidence)
    report["cache_warnings"] = warnings
    report["observation_directory"] = str(directory)
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(args.report).with_suffix(".tmp")
    temporary.write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(args.report)
    return report
