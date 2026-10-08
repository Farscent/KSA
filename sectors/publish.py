"""Write finished results to Supabase; the batch's only outbound write.

This is the Python→frontend seam described in `docs/results-schema.md`. It
carries already-computed rows to the results tables and does no scoring,
derivation or arithmetic of its own — whatever `prices.ingest()` measured is
what lands.

Uses PostgREST directly over `requests` so the package keeps its single
dependency. Writes are upserts keyed on each table's primary key, so a re-run
of the same batch is idempotent rather than duplicating rows.

The service-role key bypasses row level security. It belongs in this batch's
environment only, and must never appear under `web/` or in any NEXT_PUBLIC_*
variable.
"""

from __future__ import annotations

import json
import os
import time

from .registry import RegistryError, RETRY_STATUSES, retry_delay

RESULTS_TABLES = ("serve_position", "serve_price_history", "serve_run",
                  "serve_components", "serve_flow_series")
# PostgREST accepts large arrays, but a bounded batch keeps a failed write's
# blast radius small and its error message readable.
CHUNK_SIZE = 500


def credentials() -> tuple[str, str]:
    """Read and shape-check Supabase credentials at call time, never at import."""
    url = os.environ.get("SUPABASE_URL")
    if not url:
        raise RegistryError("MISSING_SUPABASE_URL: set SUPABASE_URL in the environment; no request made")
    if not url.startswith("https://"):
        raise RegistryError("INVALID_SUPABASE_URL: expected an https:// project URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise RegistryError("MISSING_SUPABASE_KEY: set SUPABASE_SERVICE_ROLE_KEY in the environment; no request made")
    if key != key.strip() or any(ord(c) < 33 or ord(c) > 126 for c in key):
        raise RegistryError("INVALID_SUPABASE_KEY_FORMAT")
    return url.rstrip("/"), key


def position_rows(payload: dict) -> list[dict]:
    version, kind = payload["contract_version"], payload["data_kind"]
    return [dict(record, contract_version=version, data_kind=kind)
            for record in payload["serve_position"]]


def price_history_rows(payload: dict) -> list[dict]:
    """Flatten the nested points into one row per (symbol, trade_date).

    An UNAVAILABLE symbol contributes no rows at all. That absence is the
    honest representation — a gap is not a zero, and `serve_position` already
    carries the reason code explaining it.
    """
    version, kind = payload["contract_version"], payload["data_kind"]
    return [{"symbol": history["symbol"], "trade_date": point["trade_date"],
             "close": point["close"], "volume": point["volume"], "currency": "IDR",
             "contract_version": version, "data_kind": kind}
            for history in payload["serve_price_history"]
            for point in history["points"]]


def run_rows(payload: dict) -> list[dict]:
    """Flatten the contract's nested `window` object into its three columns."""
    record = payload["serve_run"]
    window = record["window"]
    return [{"data_date": record["data_date"], "trade_date": record["trade_date"],
             "window_sessions": window["sessions"], "window_start": window["start"],
             "window_end": window["end"],
             "symbols_requested": record["symbols_requested"],
             "symbols_matched": record["symbols_matched"],
             "cohorts_unavailable": record["cohorts_unavailable"],
             "contract_version": payload["contract_version"]}]


def components_rows(components: list[dict], *, contract_version: str = "1.1.0-draft.1") -> list[dict]:
    """Flatten each record's four nested blocks into prefixed columns.

    Mirrors `run_rows`' flattening of `serve_run.window` — the same pattern,
    applied to four blocks instead of one, so PostgREST never has to interpret
    nested JSON as SQL types.
    """
    rows = []
    for record in components:
        row = {"symbol": record["symbol"], "trade_date": record["trade_date"],
               "scoring_status": record["scoring_status"], "contract_version": contract_version}
        for block in ("concentration", "breadth", "persistence", "coverage"):
            for field, value in record[block].items():
                row[f"{block}_{field}"] = value
        rows.append(row)
    return rows


def flow_series_rows(records: list[dict], *, contract_version: str = "1.1.0-draft.1") -> list[dict]:
    return [{"symbol": r["symbol"], "cohort": r["cohort"], "points": r["points"],
             "currency": r["currency"], "value_status": r["value_status"],
             "reason_codes": r["reason_codes"], "contract_version": contract_version}
            for r in records]


def publish_flow(payload: dict, *, timeout: float = 30, retries: int = 2, post=None,
                 sleep=time.sleep) -> dict:
    """Write a `scoring.score_universe()` payload to the results tables.

    `serve_position` rows for every symbol here must already exist (foreign
    key), so this is meant to run after `publish()`, not instead of it.
    """
    written = {}
    for table, rows in (("serve_components", components_rows(payload["serve_components"])),
                        ("serve_flow_series", flow_series_rows(payload["serve_flow_series"]))):
        written[table] = upsert(table, rows, timeout=timeout, retries=retries, post=post, sleep=sleep)
    return written


def chunked(rows: list[dict], size: int = CHUNK_SIZE):
    for start in range(0, len(rows), size):
        yield rows[start:start + size]


def upsert(table: str, rows: list[dict], *, timeout: float = 30, retries: int = 2,
           post=None, sleep=time.sleep) -> int:
    """Upsert rows into one results table, returning how many were sent."""
    if table not in RESULTS_TABLES:
        raise RegistryError(f"UNSUPPORTED_RESULTS_TABLE: {table}")
    if not rows:
        return 0
    url_base, key = credentials()
    try:
        import requests
    except ImportError:
        raise RegistryError("MISSING_HTTP_DEPENDENCY: install requirements.txt") from None
    post = post or requests.post
    endpoint = f"{url_base}/rest/v1/{table}"
    headers = {"apikey": key, "Authorization": f"Bearer {key}",
               "Content-Type": "application/json",
               "Prefer": "resolution=merge-duplicates,return=minimal"}
    sent = 0
    for batch in chunked(rows):
        body = json.dumps(batch, ensure_ascii=False, allow_nan=False).encode("utf-8")
        for attempt in range(retries + 1):
            try:
                response = post(endpoint, data=body, headers=headers, timeout=timeout)
                status, text = response.status_code, response.text
                retry_after = response.headers.get("Retry-After")
            except Exception:
                if attempt == retries:
                    raise RegistryError(f"PUBLISH_TRANSPORT_FAILED: {table} not written") from None
                sleep(min(2 ** attempt, 8))
                continue
            if 200 <= status < 300:
                sent += len(batch)
                break
            delay = retry_delay(retry_after, attempt) if status in RETRY_STATUSES else None
            if delay is None or attempt == retries:
                # Surface the server's own message: a constraint violation here
                # means the batch measured something the schema forbids, and
                # that must fail loudly rather than write a wrong number.
                raise RegistryError(f"PUBLISH_REJECTED: {table} HTTP {status}: {text[:500]}")
            sleep(delay)
    return sent


def publish(payload: dict, *, timeout: float = 30, retries: int = 2, post=None,
            sleep=time.sleep) -> dict:
    """Write a `prices.ingest()` payload to the results tables.

    Order matters: `serve_position` first, because both other tables' rows
    reference its symbols by foreign key.
    """
    if payload.get("data_kind") not in {"SYNTHETIC_EXAMPLE", "MEASURED"}:
        raise RegistryError("INVALID_DATA_KIND: expected SYNTHETIC_EXAMPLE or MEASURED")
    written = {}
    for table, rows in (("serve_position", position_rows(payload)),
                        ("serve_price_history", price_history_rows(payload)),
                        ("serve_run", run_rows(payload))):
        written[table] = upsert(table, rows, timeout=timeout, retries=retries,
                                post=post, sleep=sleep)
    return written


def run(args):
    from pathlib import Path

    from .registry import strict_json

    payload = strict_json(Path(args.results).read_bytes())
    if not isinstance(payload, dict):
        raise RegistryError("INVALID_RESULTS_FILE: expected a JSON object from ingest-prices")
    written = publish(payload, timeout=args.timeout, retries=args.retries)
    for table in RESULTS_TABLES:
        print(f"{table}: {written[table]} row(s) upserted")
    return written
