"""Multi-symbol, multi-day broker-summary ingestion for the frozen demo universe.

Generalises `daily.py`, which is deliberately pinned to `SYMBOL = "BBCA"` /
`TRADE_DATE = "2026-09-09"` for its single-day qualification exercise. This
module reuses `daily.fetch_observation` for transport (same auth, retry and
archive-before-parse discipline) but issues one request per symbol per
<=14-day chunk, because `/v2/broker-summary/{symbol}/` clamps wider ranges.

For the frozen window (`prices.window()`, currently ~61 sessions / 90 calendar
days) that is 7 chunks per symbol, 10 symbols: 70 API credits total, each
credit spent once and then cached on disk exactly like `prices.py`.

Never zero-fills. A day a symbol's chunk omits, or a chunk the provider errors
on, stays absent from that symbol's day list; `scoring.py` treats absence as
"not measured", never as "zero flow".
"""

from __future__ import annotations

from datetime import date, timedelta
import json
import math
from pathlib import Path
import time
import uuid

from . import daily as d
from .demo import load_demo_scope
from .prices import window as price_window
from .registry import RegistryError, canonical_json, now_utc, sha256, strict_json, utc_timestamp

CONTRACT_VERSION = "1.1.0-draft.1"
DATA_KIND = "MEASURED"
ENDPOINT_TEMPLATE = "https://api.sectors.app/v2/broker-summary/{symbol}/"
CHUNK_DAYS = 14  # provider's documented maximum range per call
META_FIELDS = {"observation_id", "requested_symbol", "requested_start", "requested_end",
               "retrieved_at", "endpoint", "request_url", "http_status", "sha256",
               "source", "content_encoding"}

# Alongside the core `daily.ROW_FIELDS`, the live endpoint splits each broker's
# buying and selling into foreign and domestic components. We record them but
# never score them: concentration/breadth/persistence read only the core
# fields, and the foreign/domestic split is a separate signal that belongs to
# `/v2/foreign-flow/` rather than to this metric. Listing them explicitly keeps
# the parser strict — any field outside these two sets is still a finding.
FOREIGN_ROW_FIELDS = {"f_bfreq", "f_blot", "f_bval", "f_bavg_per_share",
                      "f_sfreq", "f_slot", "f_sval", "f_savg_per_share"}
DOMESTIC_ROW_FIELDS = {"d_bavg_per_share", "d_savg_per_share"}
OPTIONAL_ROW_FIELDS = FOREIGN_ROW_FIELDS | DOMESTIC_ROW_FIELDS
# The core value fields `scoring.py` sums. All three must be present for a row
# to be scoreable; see the "unreported_rows" branch in `parse_chunk_rows`.
SCORED_FIELDS = ("bval", "sval", "nval")


def endpoint_for(symbol: str) -> str:
    if not isinstance(symbol, str) or not symbol.isupper() or not symbol.isalpha():
        raise RegistryError("INVALID_SYMBOL: expected an uppercase alphabetic IDX symbol")
    return ENDPOINT_TEMPLATE.format(symbol=symbol)


def request_url(symbol: str, start: str, end: str) -> str:
    return f"{endpoint_for(symbol)}?start={start}&end={end}"


def chunk_ranges(start: str, end: str, *, chunk_days: int = CHUNK_DAYS) -> list[tuple[str, str]]:
    """Split [start, end] into <=chunk_days inclusive windows, oldest first."""
    start_d, end_d = date.fromisoformat(start), date.fromisoformat(end)
    if start_d > end_d:
        raise RegistryError("INVALID_WINDOW: start is after end")
    ranges, cursor = [], start_d
    while cursor <= end_d:
        chunk_end = min(cursor + timedelta(days=chunk_days - 1), end_d)
        ranges.append((cursor.isoformat(), chunk_end.isoformat()))
        cursor = chunk_end + timedelta(days=1)
    return ranges


def archive(cache, body, status, *, symbol, start, end, source="live",
            retrieved_at=None, content_encoding="identity"):
    if (type(status) is not int or not 100 <= status <= 599
            or source not in {"live", "local", "synthetic"}
            or content_encoding not in d.ARCHIVE_ENCODINGS):
        raise RegistryError("INVALID_FLOW_PROVENANCE")
    meta = {"observation_id": str(uuid.uuid4()), "requested_symbol": symbol,
            "requested_start": start, "requested_end": end,
            "retrieved_at": utc_timestamp(retrieved_at or now_utc()),
            "endpoint": endpoint_for(symbol), "request_url": request_url(symbol, start, end),
            "http_status": status, "sha256": sha256(body), "source": source,
            "content_encoding": content_encoding}
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
            raise RegistryError("INVALID_FLOW_MANIFEST")
        if str(uuid.UUID(meta["observation_id"])) != meta["observation_id"]:
            raise ValueError
        symbol, start, end = meta["requested_symbol"], meta["requested_start"], meta["requested_end"]
        if (meta["endpoint"], meta["request_url"]) != (endpoint_for(symbol), request_url(symbol, start, end)):
            raise RegistryError("FLOW_OBSERVATION_IDENTITY_MISMATCH: manifest URL differs from its own request")
        if date.fromisoformat(start) > date.fromisoformat(end):
            raise ValueError
        if (type(meta["http_status"]) is not int or not 100 <= meta["http_status"] <= 599
                or meta["source"] not in {"live", "local", "synthetic"}
                or meta["content_encoding"] not in d.ARCHIVE_ENCODINGS):
            raise ValueError
        meta["retrieved_at"] = utc_timestamp(meta["retrieved_at"])
        body = (Path(directory) / "body.bin").read_bytes()
        if sha256(body) != meta["sha256"]:
            raise RegistryError("CHECKSUM_MISMATCH: flow observation body differs from manifest")
        return meta, body
    except (OSError, TypeError, ValueError, AttributeError):
        raise RegistryError("INVALID_FLOW_OBSERVATION") from None


def fetch_chunk(cache, symbol, start, end, *, timeout=30, retries=2, get=None, sleep=time.sleep):
    def archive_response(cache_dir, body, status, *, content_encoding="identity"):
        return archive(cache_dir, body, status, symbol=symbol, start=start, end=end,
                       content_encoding=content_encoding)

    return d.fetch_observation(cache, {"start": start, "end": end}, archive_response,
                               timeout=timeout, retries=retries, get=get, sleep=sleep,
                               endpoint=endpoint_for(symbol))


def acquire_chunk(cache, symbol, start, end, *, live=False, force_refresh=False,
                  timeout=30, retries=2):
    """Replay from cache by default; reach the network only on an explicit --live."""
    if force_refresh and not live:
        raise RegistryError("INVALID_OPTIONS: --refresh requires --live")
    candidates, warnings = [], []
    for directory in sorted(Path(cache).glob("*")):
        if not directory.is_dir():
            continue
        try:
            meta, _ = load_observation(directory)
            if (meta["requested_symbol"], meta["requested_start"], meta["requested_end"]) != (symbol, start, end):
                continue
            if meta["http_status"] == 200:
                candidates.append((meta["retrieved_at"], meta["observation_id"], directory))
            else:
                warnings.append(f"HTTP_STATUS_{meta['http_status']}: previous {symbol} {start}..{end} flow response archived")
        except RegistryError as exc:
            warnings.append(f"{symbol} {start}..{end}: {exc}")
    if candidates and not force_refresh:
        return max(candidates)[2], warnings
    if not live:
        raise RegistryError(
            f"NO_FLOW_CACHE: no cached {symbol} {start}..{end} broker-summary chunk; opt in with --live")
    return fetch_chunk(cache, symbol, start, end, timeout=timeout, retries=retries), warnings


def parse_chunk_rows(payload, symbol, start, end):
    """Validate one multi-day broker-summary chunk for an arbitrary symbol.

    `daily.inspect_schema` cannot be reused directly: it hardcodes the
    expected `symbol` field as the literal `"BBCA.JK"`, which is correct only
    for that module's single pinned qualification case. This performs the
    equivalent structural and row-level checks (reusing `daily.ROW_FIELDS` /
    `INTEGER_FIELDS` / `AVERAGE_FIELDS` / `NONNEGATIVE_FIELDS` for row shape)
    against the requested symbol and date range instead.
    """
    findings = {"schema_findings": [], "invalid_numeric_fields": [], "unreported_rows": []}
    issues = findings["schema_findings"]
    allowed_dates = {day.isoformat() for day in _daterange(start, end)}
    by_date: dict[str, list[tuple[str, dict]]] = {}

    if not isinstance(payload, dict):
        issues.append({"path": "$", "reason": "EXPECTED_OBJECT"})
        return by_date, findings, False
    if payload.get("symbol") not in (f"{symbol}.JK", symbol):
        issues.append({"path": "$.symbol", "reason": "RESPONSE_IDENTITY_MISMATCH", "expected": f"{symbol}.JK"})
    if not isinstance(payload.get("data"), list):
        issues.append({"path": "$.data", "reason": "EXPECTED_ARRAY"})
        return by_date, findings, False

    measurable = not issues
    for index, group in enumerate(payload["data"]):
        path = f"$.data[{index}]"
        if not isinstance(group, dict) or "date" not in group or "summary" not in group:
            issues.append({"path": path, "reason": "EXPECTED_DATE_AND_SUMMARY"})
            measurable = False
            continue
        day = group["date"]
        if not isinstance(day, str) or day not in allowed_dates:
            issues.append({"path": f"{path}.date", "reason": "RESPONSE_DATE_OUTSIDE_REQUESTED_WINDOW"})
            measurable = False
            continue
        if not isinstance(group["summary"], list):
            issues.append({"path": f"{path}.summary", "reason": "EXPECTED_ARRAY"})
            measurable = False
            continue
        rows = []
        for row_index, row in enumerate(group["summary"]):
            row_path = f"{path}.summary[{row_index}]"
            if (not isinstance(row, dict) or not d.ROW_FIELDS <= set(row)
                    or set(row) - d.ROW_FIELDS - OPTIONAL_ROW_FIELDS):
                issues.append({"path": row_path, "reason": "UNEXPECTED_ROW_SHAPE"})
                measurable = False
                continue
            code = row.get("broker_code")
            if not isinstance(code, str) or not code.strip() or code != code.strip():
                issues.append({"path": f"{row_path}.broker_code", "reason": "INVALID_BROKER_CODE"})
                measurable = False
                continue
            bad = False
            for field in sorted(d.INTEGER_FIELDS | d.AVERAGE_FIELDS):
                value = row.get(field)
                if value is None:
                    continue
                valid = type(value) is int if field in d.INTEGER_FIELDS else type(value) in {int, float}
                if valid and type(value) is float:
                    valid = math.isfinite(value)
                if valid and field in d.NONNEGATIVE_FIELDS:
                    valid = value >= 0
                if not valid:
                    findings["invalid_numeric_fields"].append({"path": f"{row_path}.{field}"})
                    bad = True
            if bad:
                measurable = False
                continue
            present = [field for field in SCORED_FIELDS if row[field] is not None]
            if not present:
                # The provider reports the whole core aggregate as null for a
                # handful of broker-days while still carrying foreign splits.
                # That is "not reported", not "traded zero": scoring must never
                # see it, and it must never be summed as a 0. Counted, not
                # treated as a schema fault, because the response is well formed.
                findings["unreported_rows"].append({"path": row_path, "broker_code": code})
                continue
            if len(present) != len(SCORED_FIELDS):
                # A partially null core is not a shape we have ever observed;
                # surface it rather than scoring half a row.
                findings["invalid_numeric_fields"].append({"path": f"{row_path}.core", "reason": "PARTIAL_NULL_CORE"})
                measurable = False
                continue
            rows.append((row_path, row))
        by_date.setdefault(day, []).extend(rows)
    return by_date, findings, measurable


def _daterange(start, end):
    start_d, end_d = date.fromisoformat(start), date.fromisoformat(end)
    cursor = start_d
    while cursor <= end_d:
        yield cursor
        cursor += timedelta(days=1)


def symbol_days(cache, symbol, chunks, *, live=False, force_refresh=False, timeout=30, retries=2):
    """Acquire every chunk for one symbol and merge into a per-day row map.

    A day already covered by an earlier (still-fresh) chunk is not
    duplicated. A chunk that fails to acquire (no cache, not --live) or
    whose response fails schema validation contributes nothing for its days
    rather than raising the whole ingest — the caller records the warning.
    """
    days: dict[str, list[tuple[str, dict]]] = {}
    warnings: list[str] = []
    for start, end in chunks:
        try:
            directory, chunk_warnings = acquire_chunk(cache, symbol, start, end, live=live,
                                                       force_refresh=force_refresh, timeout=timeout, retries=retries)
            warnings.extend(chunk_warnings)
        except RegistryError as exc:
            warnings.append(f"{symbol} {start}..{end}: {exc}")
            continue
        meta, body = load_observation(directory)
        if meta["http_status"] != 200:
            warnings.append(f"{symbol} {start}..{end}: HTTP_STATUS_{meta['http_status']}")
            continue
        try:
            payload = d.decoded_json(meta, body)
        except RegistryError as exc:
            warnings.append(f"{symbol} {start}..{end}: {exc}")
            continue
        by_date, findings, measurable = parse_chunk_rows(payload, symbol, start, end)
        if findings["schema_findings"]:
            warnings.append(f"{symbol} {start}..{end}: SCHEMA_INVALID ({len(findings['schema_findings'])} finding(s))")
        if findings["unreported_rows"]:
            warnings.append(f"{symbol} {start}..{end}: UNREPORTED_BROKER_ROWS "
                            f"({len(findings['unreported_rows'])} excluded, never zero-filled)")
        if not measurable:
            continue
        for day, rows in by_date.items():
            # Path prefixes were only for validation diagnostics; every
            # downstream consumer (scoring.py, the JSON report) wants plain
            # row dicts, so drop them here rather than at every call site.
            days.setdefault(day, [row for _, row in rows])
    return days, warnings


def ingest(cache, *, live=False, force_refresh=False, timeout=30, retries=2, scope=None):
    """Acquire broker-summary rows for every demo symbol across the price window.

    `raw_rows` maps symbol -> trade_date -> list of plain broker row dicts,
    exactly the shape `scoring.py` consumes. Nothing here computes CR3,
    breadth or persistence — this module only fetches and validates.
    """
    scope = scope or load_demo_scope()
    start, end = price_window(scope)
    chunks = chunk_ranges(start, end)
    by_symbol, all_warnings = {}, []
    for symbol in scope.symbols:
        days, warnings = symbol_days(cache, symbol, chunks, live=live,
                                     force_refresh=force_refresh, timeout=timeout, retries=retries)
        by_symbol[symbol] = days
        all_warnings.extend(warnings)
    return {
        "contract_version": CONTRACT_VERSION,
        "data_kind": DATA_KIND,
        "trade_date": scope.end_date.isoformat(),
        "window": {"start": start, "end": end},
        "raw_rows": by_symbol,
        "cache_warnings": sorted(set(all_warnings)),
    }


def run(args):
    result = ingest(args.cache, live=args.live, force_refresh=args.refresh,
                    timeout=args.timeout, retries=args.retries)
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(args.report).with_suffix(".tmp")
    temporary.write_text(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
                         encoding="utf-8")
    temporary.replace(args.report)
    return result
