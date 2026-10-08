"""Daily close ingestion for the frozen demo universe; raw archive, no DB writes.

One request per symbol against the Sectors daily transaction endpoint, which
serves up to a 90-day window and costs 1 API credit per call — ten credits for
the whole demo universe. The whole-market daily-close endpoint is deliberately
not used: it is paginated over ~950 tickers and costs roughly 32 credits *per
day* pulled, which would be ~2000 credits for the same window.

Archive the HTTP body bytes before decoding or parsing, exactly as `daily.py`
does. A symbol the provider returns nothing for is reported UNAVAILABLE, never
backfilled, never zero-filled, and a session the provider omits stays absent
from the series rather than being interpolated.
"""

from __future__ import annotations

from datetime import date, timedelta
import json
from pathlib import Path
import time
import uuid

from . import daily as d
from .demo import REFERENCE_DATA, load_demo_scope
from .registry import RegistryError, canonical_json, now_utc, sha256, strict_json, utc_timestamp

CONTRACT_VERSION = "1.2.0-draft.1"
DATA_KIND = "MEASURED"
ENDPOINT_TEMPLATE = "https://api.sectors.app/v2/daily/{symbol}/"
# The provider clamps wider ranges to the most recent 90 days ending at `end`.
# Requesting exactly 90 keeps the archived request identical to what was served.
WINDOW_DAYS = 90
META_FIELDS = {"observation_id", "requested_symbol", "requested_start", "requested_end",
               "retrieved_at", "endpoint", "request_url", "http_status", "sha256",
               "source", "content_encoding"}
UNAVAILABLE_REASON = "PRICE_NOT_YET_INGESTED"


def window(scope=None) -> tuple[str, str]:
    """Calendar bounds of the ingestion window, ending at the frozen demo date."""
    scope = scope or load_demo_scope()
    end = scope.end_date
    return (end - timedelta(days=WINDOW_DAYS - 1)).isoformat(), end.isoformat()


def endpoint_for(symbol: str) -> str:
    if not isinstance(symbol, str) or not symbol.isupper() or not symbol.isalpha():
        raise RegistryError("INVALID_SYMBOL: expected an uppercase alphabetic IDX symbol")
    return ENDPOINT_TEMPLATE.format(symbol=symbol)


def request_url(symbol: str, start: str, end: str) -> str:
    return f"{endpoint_for(symbol)}?start={start}&end={end}"


def archive(cache, body, status, *, symbol, start, end, source="live",
            retrieved_at=None, content_encoding="identity"):
    if (type(status) is not int or not 100 <= status <= 599
            or source not in {"live", "local", "synthetic"}
            or content_encoding not in d.ARCHIVE_ENCODINGS):
        raise RegistryError("INVALID_PRICE_PROVENANCE")
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
            raise RegistryError("INVALID_PRICE_MANIFEST")
        if str(uuid.UUID(meta["observation_id"])) != meta["observation_id"]:
            raise ValueError
        symbol, start, end = meta["requested_symbol"], meta["requested_start"], meta["requested_end"]
        if (meta["endpoint"], meta["request_url"]) != (endpoint_for(symbol), request_url(symbol, start, end)):
            raise RegistryError("PRICE_OBSERVATION_IDENTITY_MISMATCH: manifest URL differs from its own request")
        if date.fromisoformat(start) > date.fromisoformat(end):
            raise ValueError
        if (type(meta["http_status"]) is not int or not 100 <= meta["http_status"] <= 599
                or meta["source"] not in {"live", "local", "synthetic"}
                or meta["content_encoding"] not in d.ARCHIVE_ENCODINGS):
            raise ValueError
        meta["retrieved_at"] = utc_timestamp(meta["retrieved_at"])
        body = (Path(directory) / "body.bin").read_bytes()
        if sha256(body) != meta["sha256"]:
            raise RegistryError("CHECKSUM_MISMATCH: price observation body differs from manifest")
        return meta, body
    except (OSError, TypeError, ValueError, AttributeError):
        raise RegistryError("INVALID_PRICE_OBSERVATION") from None


def fetch_symbol(cache, symbol, start, end, *, timeout=30, retries=2, get=None, sleep=time.sleep):
    def archive_response(cache_dir, body, status, *, content_encoding="identity"):
        return archive(cache_dir, body, status, symbol=symbol, start=start, end=end,
                       content_encoding=content_encoding)

    return d.fetch_observation(cache, {"start": start, "end": end}, archive_response,
                               timeout=timeout, retries=retries, get=get, sleep=sleep,
                               endpoint=endpoint_for(symbol))


def acquire_symbol(cache, symbol, start, end, *, observation=None, live=False,
                   force_refresh=False, timeout=30, retries=2):
    """Replay from cache by default; reach the network only on an explicit --live."""
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
            if (meta["requested_symbol"], meta["requested_start"], meta["requested_end"]) != (symbol, start, end):
                continue
            if meta["http_status"] == 200:
                candidates.append((meta["retrieved_at"], meta["observation_id"], directory))
            else:
                warnings.append(f"HTTP_STATUS_{meta['http_status']}: previous {symbol} price response archived")
        except RegistryError as exc:
            warnings.append(f"{symbol}: {exc}")
    if candidates and not force_refresh:
        return max(candidates)[2], warnings
    if not live:
        raise RegistryError(f"NO_PRICE_CACHE: no cached {symbol} window; replay --observation or opt in with --live")
    return fetch_symbol(cache, symbol, start, end, timeout=timeout, retries=retries), warnings


def parse_points(payload, symbol, start, end):
    """Extract (trade_date, close, volume) points, reporting what is unusable.

    Accepts either a bare list of daily rows or an object wrapping one under
    `data`/`results`, since the provider's envelope is not pinned by a reviewed
    schema the way the broker-summary response is. Anything that does not parse
    cleanly is counted as a finding rather than coerced into a number.
    """
    rows = payload
    if isinstance(payload, dict):
        for key in ("data", "results"):
            if isinstance(payload.get(key), list):
                rows = payload[key]
                break
    findings, points, seen = [], [], set()
    if not isinstance(rows, list):
        return [], [{"path": "$", "reason": "UNEXPECTED_PAYLOAD_SHAPE"}]
    for index, row in enumerate(rows):
        path = f"$[{index}]"
        if not isinstance(row, dict):
            findings.append({"path": path, "reason": "ROW_NOT_AN_OBJECT"})
            continue
        day, close = row.get("date"), row.get("close")
        volume = row.get("volume")
        try:
            valid_day = isinstance(day, str) and date.fromisoformat(day).isoformat() == day
        except ValueError:
            valid_day = False
        if not valid_day:
            findings.append({"path": f"{path}.date", "reason": "INVALID_DATE"})
            continue
        if not (start <= day <= end):
            findings.append({"path": f"{path}.date", "reason": "DATE_OUTSIDE_REQUESTED_WINDOW"})
            continue
        if day in seen:
            findings.append({"path": f"{path}.date", "reason": "DUPLICATE_DATE"})
            continue
        # bool is an int subclass; reject it explicitly rather than storing True as 1.
        if type(close) is not int or close <= 0:
            findings.append({"path": f"{path}.close", "reason": "INVALID_CLOSE"})
            continue
        if volume is not None and (type(volume) is not int or volume < 0):
            findings.append({"path": f"{path}.volume", "reason": "INVALID_VOLUME"})
            volume = None
        seen.add(day)
        points.append({"trade_date": day, "close": close, "volume": volume})
    points.sort(key=lambda point: point["trade_date"])
    return points, findings


def symbol_record(directory, symbol, start, end):
    """Build the price-history record for one symbol from its archived body."""
    meta, body = load_observation(directory)
    warnings = []
    points, findings = [], []
    if meta["http_status"] != 200:
        warnings.append(f"HTTP_STATUS_{meta['http_status']}")
    else:
        try:
            points, findings = parse_points(d.decoded_json(meta, body), symbol, start, end)
        except RegistryError as exc:
            findings = [{"path": "$", "reason": str(exc).split(":", 1)[0]}]
    if meta["source"] == "synthetic":
        warnings.append("SYNTHETIC_OBSERVATION")
    available = bool(points)
    return {
        "symbol": symbol,
        "points": points,
        "currency": "IDR",
        "value_status": "AVAILABLE" if available else "UNAVAILABLE",
        "reason_codes": [] if available else [UNAVAILABLE_REASON],
        "observation": meta,
        "schema_findings": findings,
        "warning_codes": sorted(set(warnings)),
    }


def position_record(history):
    """Latest close per symbol, derived from that symbol's own history.

    Nothing is invented: the close is the last point actually returned, and its
    date is that point's date. A symbol with no points is UNAVAILABLE with the
    reason code the contract and the frontend already expect.
    """
    symbol = history["symbol"]
    name, sector = REFERENCE_DATA[symbol]
    latest = history["points"][-1] if history["points"] else None
    return {
        "symbol": symbol,
        "name": name,
        "sector": sector,
        "close": latest["close"] if latest else None,
        "close_date": latest["trade_date"] if latest else None,
        "currency": "IDR",
        "value_status": "AVAILABLE" if latest else "UNAVAILABLE",
        "reason_codes": [] if latest else [UNAVAILABLE_REASON],
    }


def run_record(histories, start, end, scope):
    """Provenance for this batch: what was asked for and what actually resolved."""
    matched = [h for h in histories if h["value_status"] == "AVAILABLE"]
    sessions = sorted({point["trade_date"] for h in matched for point in h["points"]})
    return {
        "data_date": date.today().isoformat(),
        "trade_date": max(sessions) if sessions else end,
        "window": {"sessions": len(sessions) or 1,
                   "start": min(sessions) if sessions else start,
                   "end": max(sessions) if sessions else end},
        "symbols_requested": len(scope.symbols),
        "symbols_matched": len(matched),
        # Cohort resolution belongs to the broker-flow batch, not price ingestion.
        "cohorts_unavailable": 0,
    }


def ingest(cache, *, observation=None, live=False, force_refresh=False, timeout=30,
           retries=2, scope=None):
    """Acquire every demo symbol's window and build the serve_* payloads."""
    scope = scope or load_demo_scope()
    start, end = window(scope)
    if observation is not None and len(scope.symbols) > 1:
        raise RegistryError("INVALID_OPTIONS: --observation replays a single symbol only")
    histories, warnings = [], []
    for symbol in scope.symbols:
        directory, symbol_warnings = acquire_symbol(
            cache, symbol, start, end, observation=observation, live=live,
            force_refresh=force_refresh, timeout=timeout, retries=retries)
        warnings.extend(symbol_warnings)
        history = symbol_record(directory, symbol, start, end)
        history["observation_directory"] = str(Path(directory).resolve())
        histories.append(history)
    positions = [position_record(history) for history in histories]
    return {
        "contract_version": CONTRACT_VERSION,
        "contract_status": "UNDER_REVIEW",
        "data_kind": DATA_KIND,
        "window": {"start": start, "end": end},
        "serve_run": run_record(histories, start, end, scope),
        "serve_position": positions,
        "serve_price_history": histories,
        "cache_warnings": sorted(set(warnings)),
    }


def run(args):
    result = ingest(args.cache, observation=args.observation, live=args.live,
                    force_refresh=args.refresh, timeout=args.timeout, retries=args.retries)
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(args.report).with_suffix(".tmp")
    temporary.write_text(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
                         encoding="utf-8")
    temporary.replace(args.report)
    return result
