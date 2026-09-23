"""Bounded BBCA range experiment; raw observations and reports, no DB writes.

The documented validator remains strict. Only explicit null side averages whose
three activity measures are valid integer zeros qualify for local compatibility.
This exception is enabled only when the entire observation has no counterexample
or uninspectable side. It neither fills nulls nor changes the source observation.
"""

from collections import Counter, defaultdict
from datetime import date, timedelta
import json
from pathlib import Path
import time
import uuid

from . import daily as d
from .registry import RegistryError, canonical_json, now_utc, sha256, strict_json, utc_timestamp

SYMBOL = "BBCA"
START = "2026-09-01"
END = "2026-09-10"
PARAMS = {"start": START, "end": END}
REQUEST_URL = f"{d.ENDPOINT}?start={START}&end={END}"
META_FIELDS = (d.META_FIELDS - {"requested_trade_date"}) | {"requested_start", "requested_end"}
NULL_COUNTS = ("null_buy_average_count", "null_sell_average_count",
               "null_average_with_zero_side_count", "null_average_with_nonzero_side_count",
               "null_average_with_unverifiable_side_count", "zero_side_with_nonnull_average_count",
               "side_observations_not_evaluable")
TOTAL_FIELDS = {
    "aggregate_value": ("buy_value_total", "sell_value_total", "buy_minus_sell_value"),
    "aggregate_lots": ("buy_lot_total", "sell_lot_total", "buy_minus_sell_lots"),
    "aggregate_frequency": ("buy_frequency_total", "sell_frequency_total", "buy_minus_sell_frequency"),
}


def calendar_check(evidence, symbol=SYMBOL, start=START, end=END):
    if (symbol, start, end) != (SYMBOL, START, END):
        raise RegistryError("UNSUPPORTED_TEST_CASE: only BBCA / 2026-09-01 through 2026-09-10")
    calendar = evidence["calendar"]
    if (calendar.get("reviewed_month") != "2026-09" or calendar.get("closed_weekdays") != [5, 6]
            or not isinstance(calendar.get("closed_weekdays_in_month"), list)
            or not calendar.get("document") or not calendar.get("sha256")):
        raise RegistryError("CALENDAR_EVIDENCE_INVALID: reviewed exchange schedule required before fetch")
    days = [(date.fromisoformat(start) + timedelta(days=i)).isoformat()
            for i in range((date.fromisoformat(end) - date.fromisoformat(start)).days + 1)]
    expected = [day for day in days if date.fromisoformat(day).weekday() not in calendar["closed_weekdays"]
                and day not in calendar["closed_weekdays_in_month"]]
    return {"expected_scheduled_dates": expected,
            "scheduled_closed_dates": sorted(set(days) - set(expected)), "dates_in_request": days,
            "source": calendar, "status": "EXCHANGE_SCHEDULE_VERIFIED",
            "limitation": "Annual schedule does not verify exceptional closures or BBCA suspensions."}


def archive(cache, body, status, *, source="live", retrieved_at=None, content_encoding="identity"):
    if (type(status) is not int or not 100 <= status <= 599 or source not in {"live", "local", "synthetic"}
            or content_encoding not in d.ARCHIVE_ENCODINGS):
        raise RegistryError("INVALID_RANGE_PROVENANCE")
    meta = {"observation_id": str(uuid.uuid4()), "requested_symbol": SYMBOL,
            "requested_start": START, "requested_end": END,
            "retrieved_at": utc_timestamp(retrieved_at or now_utc()), "endpoint": d.ENDPOINT,
            "request_url": REQUEST_URL, "http_status": status, "sha256": sha256(body),
            "source": source, "content_encoding": content_encoding}
    directory = Path(cache) / meta["observation_id"]
    directory.mkdir(parents=True, exist_ok=False)
    (directory / "body.bin").write_bytes(body)
    temporary = directory / "metadata.tmp"
    temporary.write_text(canonical_json(meta) + "\n", encoding="utf-8")
    temporary.replace(directory / "metadata.json")
    return directory, meta


def load_observation(directory):
    try:
        meta = strict_json((Path(directory) / "metadata.json").read_bytes())
        if not isinstance(meta, dict) or set(meta) != META_FIELDS:
            raise RegistryError("INVALID_RANGE_MANIFEST")
        if str(uuid.UUID(meta["observation_id"])) != meta["observation_id"]:
            raise ValueError
        if (meta["requested_symbol"], meta["requested_start"], meta["requested_end"],
                meta["endpoint"], meta["request_url"]) != (SYMBOL, START, END, d.ENDPOINT, REQUEST_URL):
            raise RegistryError("UNSUPPORTED_TEST_CASE: range observation identity mismatch")
        if (type(meta["http_status"]) is not int or not 100 <= meta["http_status"] <= 599
                or meta["source"] not in {"live", "local", "synthetic"}
                or meta["content_encoding"] not in d.ARCHIVE_ENCODINGS):
            raise ValueError
        meta["retrieved_at"] = utc_timestamp(meta["retrieved_at"])
        body = (Path(directory) / "body.bin").read_bytes()
        if sha256(body) != meta["sha256"]:
            raise RegistryError("CHECKSUM_MISMATCH: range observation body differs from manifest")
        return meta, body
    except (OSError, TypeError, ValueError, AttributeError):
        raise RegistryError("INVALID_RANGE_OBSERVATION") from None


def fetch_range(cache, evidence, *, timeout=30, retries=2, get=None, sleep=time.sleep):
    calendar_check(evidence)
    return d.fetch_observation(cache, PARAMS, archive, timeout=timeout, retries=retries, get=get, sleep=sleep)


def acquire_range(cache, evidence, *, observation=None, live=False, force_refresh=False, timeout=30, retries=2):
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
                warnings.append(f"HTTP_STATUS_{meta['http_status']}: previous range response archived")
        except RegistryError as exc:
            warnings.append(str(exc))
    if candidates and not force_refresh:
        return max(candidates)[2], warnings
    if not live:
        raise RegistryError("NO_RANGE_CACHE: replay --observation or explicitly opt in with --live")
    return fetch_range(cache, evidence, timeout=timeout, retries=retries), warnings


def null_pattern(rows):
    result = {name: 0 for name in NULL_COUNTS}
    result["observations"] = []
    result["compatible_paths"] = []
    for path, row in rows:
        for side, prefix in (("buy", "b"), ("sell", "s")):
            average = f"{prefix}avg_per_share"
            fields = (f"{prefix}freq", f"{prefix}lot", f"{prefix}val")
            values = {field: row.get(field) for field in fields} if isinstance(row, dict) else {}
            valid = bool(values) and all(type(v) is int and v >= 0 for v in values.values())
            zero = valid and all(v == 0 for v in values.values())
            nonzero = any(type(v) is int and v > 0 for v in values.values())
            if not isinstance(row, dict) or average not in row or not valid:
                result["side_observations_not_evaluable"] += 1
            if not isinstance(row, dict) or average not in row:
                continue
            if row[average] is None:
                result[f"null_{side}_average_count"] += 1
                state = "ZERO_SIDE" if zero else "NONZERO_SIDE" if nonzero else "UNVERIFIABLE_SIDE"
                result[{"ZERO_SIDE": "null_average_with_zero_side_count",
                        "NONZERO_SIDE": "null_average_with_nonzero_side_count",
                        "UNVERIFIABLE_SIDE": "null_average_with_unverifiable_side_count"}[state]] += 1
                result["observations"].append({"path": f"{path}.{average}", "broker_code": row.get("broker_code"),
                                               "side": side, "status": state})
                if zero:
                    result["compatible_paths"].append(f"{path}.{average}")
            elif zero:
                result["zero_side_with_nonnull_average_count"] += 1
    return result


def inspection(payload, calendar, group_indices=None):
    return d.inspect_schema(payload, start=START, end=END, allowed_dates=calendar["dates_in_request"],
                            multiple_dates=True, group_indices=group_indices)


def apply_compatibility(findings, pattern, enabled):
    # Keep every documented-schema finding for audit; exempt only verified paths.
    paths = set(pattern["compatible_paths"]) if enabled else set()
    findings["documented_schema_findings"] = findings["schema_findings"]
    findings["schema_findings"] = [issue for issue in findings["schema_findings"]
        if not (issue["reason"] == "NULL_REQUIRED_FIELD" and issue["path"] in paths)]
    findings["compatible_null_average_paths"] = sorted(paths)


def qualify_date(payload, indices, registry, calendar, compatibility_enabled):
    subset = dict(payload, data=[payload["data"][index] for index in indices])
    findings, rows, measurable = inspection(subset, calendar, indices)
    day = subset["data"][0]["date"]
    pattern = null_pattern(rows)
    apply_compatibility(findings, pattern, compatibility_enabled)
    codes = [row["broker_code"] for _, row in rows if isinstance(row, dict)
             and isinstance(row.get("broker_code"), str) and row["broker_code"].strip()
             and row["broker_code"] == row["broker_code"].strip()]
    identifiable = set(codes)
    duplicates = sorted(code for code, count in Counter(codes).items() if count > 1)
    unknown = sorted(identifiable - set(registry["broker_codes"]))
    checks = d.reconciliation(rows, findings, measurable and len(indices) == 1, duplicates)
    by_name = {check["name"]: check for check in checks}
    result = dict(findings, trade_date=day, response_group_indices=indices,
        unique_broker_count=len(identifiable) if findings["response_row_count"] is not None else None,
        duplicate_broker_codes=duplicates, unknown_broker_codes=unknown,
        registry_broker_count=len(registry["broker_codes"]),
        registry_brokers_present=sorted(identifiable & set(registry["broker_codes"])),
        registry_brokers_absent=sorted(set(registry["broker_codes"]) - identifiable)
            if findings["response_row_count"] is not None else None,
        broker_comparison_status="EVALUATED" if len(codes) == len(rows) and findings["response_row_count"] is not None else "PARTIAL",
        reconciliation_checks=checks, null_average_pattern=pattern,
        activity_observations=d.activity_observations(rows),
        row_net_value_status=by_name["row_net_value"]["status"], row_net_lot_status=by_name["row_net_lots"]["status"],
        safe_to_call_complete=False)
    result.update({name: pattern[name] for name in NULL_COUNTS})
    for check_name, names in TOTAL_FIELDS.items():
        result.update(zip(names, (by_name[check_name].get(key) for key in ("buy_total", "sell_total", "buy_minus_sell"))))
    # Signatures reveal changing fields/types, without retaining or repairing rows.
    signatures = Counter(canonical_json({field: type(value).__name__ for field, value in row.items()})
                         if isinstance(row, dict) else canonical_json({"$row": type(row).__name__}) for _, row in rows)
    result["row_schema_signatures"] = [{"fields": json.loads(signature), "row_count": count}
                                        for signature, count in sorted(signatures.items())]
    reasons, warnings = ["COVERAGE_UNPROVEN"], []
    if findings["compatible_null_average_paths"]:
        warnings.append("LIVE_SCHEMA_NULLABILITY_DISCREPANCY")
    if findings["schema_findings"]:
        reasons.append("INVALID_SCHEMA")
    if findings["invalid_numeric_fields"]:
        reasons.append("INVALID_NUMERIC_FIELD")
    if pattern["null_average_with_nonzero_side_count"]:
        reasons.append("NULL_AVERAGE_NONZERO_SIDE")
    if pattern["null_average_with_unverifiable_side_count"]:
        reasons.append("NULL_AVERAGE_SIDE_UNVERIFIABLE")
    if duplicates:
        reasons.append("DUPLICATE_BROKER")
    if len(indices) > 1:
        reasons.append("DUPLICATE_DATE_GROUP")
    if unknown:
        reasons.append("UNKNOWN_BROKER")
    if any(check["status"] == "FAIL" for check in checks):
        reasons.append("ROW_NET_MISMATCH")
    if any(check["status"] == "OBSERVED_DIFFERENT" for check in checks):
        warnings.append("AGGREGATE_IMBALANCE")
    if findings["response_row_count"] == 0:
        reasons.append("EMPTY_RESPONSE")
    if day not in calendar["expected_scheduled_dates"]:
        reasons.append("DATE_COVERAGE_UNRESOLVED")
    if set(reasons) & {"INVALID_SCHEMA", "INVALID_NUMERIC_FIELD", "NULL_AVERAGE_NONZERO_SIDE", "NULL_AVERAGE_SIDE_UNVERIFIABLE"}:
        status = "INVALID_SCHEMA"
    elif duplicates or len(indices) > 1:
        status = "INVALID_DUPLICATE_DATA"
    elif "ROW_NET_MISMATCH" in reasons:
        status = "INVALID_ARITHMETIC"
    elif "EMPTY_RESPONSE" in reasons:
        status = "EMPTY_RESPONSE_UNRESOLVED"
    elif "DATE_COVERAGE_UNRESOLVED" in reasons:
        status = "UNEXPECTED_DATE_UNRESOLVED"
    elif "AGGREGATE_IMBALANCE" in warnings:
        status = "AGGREGATE_IMBALANCE_COVERAGE_UNPROVEN"
    else:
        status = "INTERNALLY_RECONCILED_COVERAGE_UNPROVEN"
    result.update(qualification_status=status, reason_codes=reasons + warnings, warning_codes=warnings)
    return result


def qualify(directory, registry, evidence):
    meta, body = load_observation(directory)
    calendar = calendar_check(evidence)
    report = {"report_version": "bbca-range-v2", "requested_symbol": SYMBOL, "requested_start": START,
              "requested_end": END, "observation": meta, "registry_provenance": registry,
              "registry_broker_count": len(registry["broker_codes"]), "calendar": calendar,
              "api_evidence": evidence["api"], "safe_to_call_complete": False,
              "units": {"value": "IDR", "volume": "lots", "frequency": "count; counting convention unspecified",
                        "averages": "per-share prices; rounding/net-average formula unspecified"},
              "daily_qualifications": [], "reason_codes": ["COVERAGE_UNPROVEN"], "warning_codes": [],
              "schema_findings": [], "null_required_fields": [], "missing_required_fields": [],
              "invalid_numeric_fields": [], "response_row_count": None, "response_dates": []}
    if meta["source"] == "synthetic":
        report["reason_codes"].append("SYNTHETIC_OBSERVATION")
    payload, rows, measurable = None, [], False
    if meta["http_status"] != 200:
        report["reason_codes"].append(f"HTTP_STATUS_{meta['http_status']}")
    else:
        try:
            payload = d.decoded_json(meta, body)
            findings, rows, measurable = inspection(payload, calendar)
            report.update(findings)
        except RegistryError as exc:
            report["schema_findings"].append({"path": "$", "reason": str(exc).split(":", 1)[0]})
    pattern = null_pattern(rows)
    null_count = pattern["null_buy_average_count"] + pattern["null_sell_average_count"]
    if pattern["null_average_with_nonzero_side_count"]:
        hypothesis = "COUNTEREXAMPLE_OBSERVED"
    elif not rows or not measurable or pattern["side_observations_not_evaluable"]:
        hypothesis = "INCONCLUSIVE"
    elif not null_count:
        hypothesis = "NO_NULL_AVERAGES_OBSERVED"
    else:
        hypothesis = "SUPPORTED_IN_THIS_OBSERVATION"
    compatible = hypothesis == "SUPPORTED_IN_THIS_OBSERVATION"
    report["null_average_hypothesis"] = {
        "status": hypothesis, "conditional_compatibility_enabled": compatible,
        "rule": "Only explicit null buy/sell average with corresponding frequency, lots AND value valid integer zeros.",
        "scope": "This observation only; net average and all other required fields remain strict.",
        "counts": {name: pattern[name] for name in NULL_COUNTS}}
    apply_compatibility(report, pattern, compatible)
    grouped = defaultdict(list)
    unassigned = []
    if isinstance(payload, dict) and isinstance(payload.get("data"), list):
        for index, group in enumerate(payload["data"]):
            day = group.get("date") if isinstance(group, dict) else None
            try:
                valid_day = isinstance(day, str) and date.fromisoformat(day).isoformat() == day
            except ValueError:
                valid_day = False
            if valid_day:
                grouped[day].append(index)
            else:
                unassigned.append(index)
    report["unassigned_response_group_indices"] = unassigned
    report["duplicate_date_groups"] = sorted(day for day, indices in grouped.items() if len(indices) > 1)
    records = [qualify_date(payload, indices, registry, calendar, compatible) for day, indices in sorted(grouped.items())]
    report["daily_qualifications"] = records
    expected, returned = set(calendar["expected_scheduled_dates"]), set(grouped)
    missing, unexpected = sorted(expected - returned), sorted(returned - expected)
    report.update(expected_scheduled_dates=sorted(expected), returned_dates=sorted(returned),
                  missing_scheduled_dates=missing, unexpected_dates=unexpected)
    report["date_coverage_status"] = "DATE_COVERAGE_UNRESOLVED" if missing or unexpected or unassigned else "SCHEDULED_DATES_OBSERVED"
    report["missing_date_qualifications"] = [{"trade_date": day,
        "qualification_status": "MISSING_SCHEDULED_DATE_UNRESOLVED", "reason_codes": ["DATE_COVERAGE_UNRESOLVED"],
        "possible_explanations": ["BBCA suspension", "extraordinary exchange closure", "provider omission/unavailability"],
        "explanation_verified": False} for day in missing]
    report["absence_semantics"] = {
        "documented_population": "ACTIVE_BROKERS_ONLY", "registry_absence_is_failure": False,
        "interpretation": "Inactive brokers need not appear. No records or zero trades are invented for absent codes.",
        "individual_absence_proven": False,
        "limitation": "Absence alone cannot distinguish inactivity, historical non-membership or an upstream omission."}
    if report["schema_findings"]:
        report["reason_codes"].append("INVALID_SCHEMA")
    if report["invalid_numeric_fields"]:
        report["reason_codes"].append("INVALID_NUMERIC_FIELD")
    if missing or unexpected or unassigned:
        report["reason_codes"].append("DATE_COVERAGE_UNRESOLVED")
    for record in records:
        report["reason_codes"].extend(record["reason_codes"])
        report["warning_codes"].extend(record["warning_codes"])
    report["reason_codes"] = sorted(set(report["reason_codes"]))
    report["warning_codes"] = sorted(set(report["warning_codes"]))
    all_assigned = not unassigned and not report["duplicate_date_groups"] and report["response_row_count"] is not None
    totals = {name: pattern[name] for name in NULL_COUNTS}
    totals["response_row_count"] = report["response_row_count"]
    totals["returned_date_count"] = len(returned)
    for names in TOTAL_FIELDS.values():
        for name in names:
            totals[name] = sum(record[name] for record in records) if records and all_assigned and all(
                record[name] is not None for record in records) else None
    report["range_totals"] = totals
    report["aggregate_equality_observations"] = {name: {
        "dates_evaluated": [r["trade_date"] for r in records if r[names[2]] is not None],
        "equal_dates": [r["trade_date"] for r in records if r[names[2]] == 0],
        "unequal_dates": [r["trade_date"] for r in records if r[names[2]] is not None and r[names[2]] != 0],
        "equal_on_every_returned_date": bool(records) and all_assigned and all(r[names[2]] == 0 for r in records),
        "is_api_guarantee": False} for name, names in TOTAL_FIELDS.items()}
    signature_sets = [sorted(canonical_json(s["fields"]) for s in record["row_schema_signatures"]) for record in records]
    report["schema_variation"] = {"same_observed_field_type_signature_set_every_date": bool(records) and all(
        signatures == signature_sets[0] for signatures in signature_sets),
        "basis": "Exact field names and Python JSON value types, including null; per-date signatures retained."}
    activities = [record["activity_observations"] for record in records]
    report["population_observations"] = {
        "rows_per_date": {r["trade_date"]: r["response_row_count"] for r in records},
        "all_inspectable_rows_have_positive_buy_or_sell_value": bool(rows) and all_assigned
            and sum(a["evaluated_rows"] for a in activities) == len(rows)
            and all(a["rows_not_evaluated"] == 0 and a["active_value_rows"] == a["evaluated_rows"] for a in activities),
        "interpretation": "Positive activity supports active-only behavior, but cannot establish that every active broker was returned."}
    statuses = {r["qualification_status"] for r in records}
    if meta["http_status"] != 200:
        status = "HTTP_FAILURE"
    elif report["schema_findings"] or report["invalid_numeric_fields"] or "INVALID_SCHEMA" in statuses:
        status = "INVALID_SCHEMA"
    elif "INVALID_DUPLICATE_DATA" in statuses:
        status = "INVALID_DUPLICATE_DATA"
    elif "INVALID_ARITHMETIC" in statuses:
        status = "INVALID_ARITHMETIC"
    elif report["date_coverage_status"] == "DATE_COVERAGE_UNRESOLVED":
        status = "DATE_COVERAGE_UNRESOLVED"
    elif statuses == {"INTERNALLY_RECONCILED_COVERAGE_UNPROVEN"}:
        status = "INTERNALLY_RECONCILED_COVERAGE_UNPROVEN"
    else:
        status = "QUALIFICATION_UNRESOLVED"
    report["qualification_status"] = status
    report["has_hard_anomaly"] = status.startswith("INVALID_") or status == "HTTP_FAILURE"
    report["unproven"] = [
        "Every active broker is present with no upstream omission or truncation.",
        "Market board/session scope and independently sourced stock-day totals with matching scope.",
        "Historical registry membership and individual absent-broker inactivity.",
        "Nullability behavior outside this observed BBCA range; price rounding, net-average formula and frequency convention.",
        "Extraordinary exchange closures and BBCA suspensions, independently of the annual schedule."]
    return report


def run(args):
    evidence = d.load_evidence()
    calendar_check(evidence, args.symbol, args.start, args.end)
    registry = d.current_registry(args.registry_db)
    directory, warnings = acquire_range(args.cache, evidence, observation=args.observation, live=args.live,
        force_refresh=args.refresh, timeout=args.timeout, retries=args.retries)
    report = qualify(directory, registry, evidence)
    report.update(cache_warnings=warnings, observation_directory=str(Path(directory).resolve()))
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(args.report).with_suffix(".tmp")
    temporary.write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(args.report)
    return report
