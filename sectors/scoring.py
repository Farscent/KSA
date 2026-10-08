"""Concentration / breadth / persistence / coverage scoring.

This is the engine `CLAUDE.md` lists as "not yet built": it turns raw
per-day, per-broker rows (from `flow.py`) into the `serve_components` /
`serve_flow_series` shapes the frontend already renders, against each
symbol's own baseline. Per the project's founding rule, the four components
are never combined into one score — each is computed and reported
independently, and each carries its own `value_status`/`reason_codes` so
"not flagged" and "not measurable" stay visibly distinct.

Definitions (deterministic, documented here because the contract's
`scoring_status` was `PENDING_DEFINITION` until this module existed):

- **Concentration**: CR3 — the top-3 brokers' share of that day's total sell
  value. `baseline_share` is the mean CR3 across every other day in the
  window. `band`/`band_count` place the day's share into a quintile of the
  window's own share distribution (band 5 = the most concentrated quintile).
- **Breadth**: of the brokers active on both a day and the trading day
  before it, the share whose net position (buy − sell) flipped sign.
  `baseline_share` is the mean of that same ratio across the rest of the
  window. The first session in a window has no prior day and is excluded.
- **Persistence**: over the trailing `PERSISTENCE_SESSIONS` sessions ending
  at `trade_date`, whether each day's aggregate net-value direction matches
  the anchor day's own direction. `longest_run` is the longest consecutive
  streak of matches ending at (and including) the anchor day.
- **Coverage**: the share of that day's total sell value attributable to
  broker codes the current registry can classify into a cohort, and how many
  of the four cohorts (institutional/retail/mixed/unknown) appear at all.

A block is `UNAVAILABLE` — never a fabricated zero — when its window is too
short to compute (fewer than 2 days for breadth, fewer than
`PERSISTENCE_SESSIONS` for persistence) or when there is no sell value at all
that day.
"""

from __future__ import annotations

from contextlib import closing
import json
from pathlib import Path
import sqlite3

from .registry import RegistryError

PERSISTENCE_SESSIONS = 10
BAND_COUNT = 5
COHORTS = ("institutional", "retail", "mixed", "unknown")


def registry_cohorts(db_path: Path) -> dict[str, str]:
    """broker_code -> cohort for the current registry snapshot.

    Mirrors `daily.current_registry`'s prerequisites (real, non-synthetic,
    non-empty registry) but returns the cohort assignment scoring needs,
    which that function does not expose.
    """
    if not Path(db_path).is_file():
        raise RegistryError("REAL_REGISTRY_REQUIRED: current registry database does not exist")
    with closing(sqlite3.connect(Path(db_path).resolve().as_uri() + "?mode=ro", uri=True)) as connection:
        connection.row_factory = sqlite3.Row
        snapshots = connection.execute("SELECT source FROM registry_snapshot").fetchall()
        rows = connection.execute(
            "SELECT broker_code, cohort FROM dim_broker WHERE valid_to IS NULL ORDER BY broker_code").fetchall()
    if not snapshots or not rows or any(s["source"] == "synthetic" for s in snapshots):
        raise RegistryError("REAL_REGISTRY_REQUIRED: synthetic or empty registry cannot score real flow data")
    return {row["broker_code"]: row["cohort"] for row in rows}


def day_sell_total(rows: list[dict]) -> int:
    return sum(row["sval"] for row in rows)


def day_top3_share(rows: list[dict]) -> float | None:
    total = day_sell_total(rows)
    if total <= 0:
        return None
    top3 = sum(sorted((row["sval"] for row in rows), reverse=True)[:3])
    return top3 / total


def quintile_band(value: float, distribution: list[float]) -> int:
    """1..BAND_COUNT, higher band = higher value within its own window."""
    ordered = sorted(distribution)
    rank = sum(1 for v in ordered if v <= value)
    band = max(1, min(BAND_COUNT, -(-rank * BAND_COUNT // len(ordered))))
    return band


def concentration_block(days_rows: dict[str, list[dict]], trade_date: str) -> dict:
    shares = {day: day_top3_share(rows) for day, rows in days_rows.items()}
    today = shares.get(trade_date)
    if today is None:
        return {"basis": "MEASURED", "value_status": "UNAVAILABLE",
                "reason_codes": ["NO_SELL_VALUE_ON_TRADE_DATE"],
                "top_n": None, "share": None, "baseline_share": None, "band": None, "band_count": None}
    others = [v for day, v in shares.items() if day != trade_date and v is not None]
    all_values = [v for v in shares.values() if v is not None]
    return {
        "basis": "MEASURED", "value_status": "AVAILABLE", "reason_codes": [],
        "top_n": 3, "share": round(today, 4),
        "baseline_share": round(sum(others) / len(others), 4) if others else None,
        "band": quintile_band(today, all_values), "band_count": BAND_COUNT,
    }


def net_by_broker(rows: list[dict]) -> dict[str, int]:
    return {row["broker_code"]: row["bval"] - row["sval"] for row in rows}


def breadth_for_day(prior_rows: list[dict], rows: list[dict]) -> tuple[int, int] | None:
    prior_net, net = net_by_broker(prior_rows), net_by_broker(rows)
    active_codes = set(prior_net) & set(net)
    if not active_codes:
        return None
    changed = sum(1 for code in active_codes
                  if (prior_net[code] > 0) != (net[code] > 0) and prior_net[code] != 0 and net[code] != 0)
    return changed, len(active_codes)


def breadth_block(days_rows: dict[str, list[dict]], trade_date: str) -> dict:
    ordered_days = sorted(days_rows)
    if trade_date not in ordered_days or ordered_days.index(trade_date) == 0:
        return {"basis": "MEASURED", "value_status": "UNAVAILABLE",
                "reason_codes": ["BREADTH_NOT_COMPUTED"],
                "changed": None, "active": None, "share": None, "baseline_share": None}
    ratios: dict[str, tuple[int, int]] = {}
    for i in range(1, len(ordered_days)):
        result = breadth_for_day(days_rows[ordered_days[i - 1]], days_rows[ordered_days[i]])
        if result:
            ratios[ordered_days[i]] = result
    if trade_date not in ratios:
        return {"basis": "MEASURED", "value_status": "UNAVAILABLE",
                "reason_codes": ["BREADTH_NOT_COMPUTED"],
                "changed": None, "active": None, "share": None, "baseline_share": None}
    changed, active = ratios[trade_date]
    others = [c / a for day, (c, a) in ratios.items() if day != trade_date and a > 0]
    return {
        "basis": "MEASURED", "value_status": "AVAILABLE", "reason_codes": [],
        "changed": changed, "active": active,
        "share": round(changed / active, 4) if active else None,
        "baseline_share": round(sum(others) / len(others), 4) if others else None,
    }


def persistence_block(days_rows: dict[str, list[dict]], trade_date: str) -> dict:
    """Is the concentration anomaly a one-day blip or a multi-day pattern?

    `session_flags` is oldest-first over the trailing PERSISTENCE_SESSIONS
    window ending at the anchor: True where that session's top-3 sell share
    sat on the same side of the symbol's own baseline as the anchor session.
    `same_direction` counts those sessions, `longest_run` is the longest
    consecutive streak anywhere in the window.

    This deliberately does not use a net buy/sell direction; see the comment
    below on why a market-wide net is identically zero.
    """
    ordered_days = sorted(days_rows)
    if trade_date not in ordered_days:
        return {"basis": "MEASURED", "value_status": "UNAVAILABLE",
                "reason_codes": ["PERSISTENCE_NOT_COMPUTED"],
                "same_direction": None, "of_sessions": None, "longest_run": None, "session_flags": None}
    anchor_index = ordered_days.index(trade_date)
    window_days = ordered_days[max(0, anchor_index - PERSISTENCE_SESSIONS + 1):anchor_index + 1]
    if len(window_days) < PERSISTENCE_SESSIONS:
        return {"basis": "MEASURED", "value_status": "UNAVAILABLE",
                "reason_codes": ["PERSISTENCE_NOT_COMPUTED"],
                "same_direction": None, "of_sessions": None, "longest_run": None, "session_flags": None}

    # A market-wide net direction cannot be the measure here. Broker buys and
    # sells are identically equal every session — verified against the real
    # window, where `sum(bval) - sum(sval)` is exactly 0 on every trade date —
    # so summing every broker's net scores all ten symbols the same and says
    # nothing. That is the zero-sum trap this project's thesis names.
    #
    # Persistence therefore tracks the *structure*: whether each session's
    # top-3 sell concentration sat on the same side of the symbol's own
    # baseline as the anchor session did. "Same direction" keeps its literal
    # meaning — same side of baseline — over a quantity that actually varies.
    shares = {day: day_top3_share(rows) for day, rows in days_rows.items()}
    anchor_share = shares.get(trade_date)
    baseline_values = [v for day, v in shares.items() if day != trade_date and v is not None]
    if anchor_share is None or not baseline_values:
        return {"basis": "MEASURED", "value_status": "UNAVAILABLE",
                "reason_codes": ["PERSISTENCE_NOT_COMPUTED"],
                "same_direction": None, "of_sessions": None, "longest_run": None, "session_flags": None}
    baseline = sum(baseline_values) / len(baseline_values)
    anchor_elevated = anchor_share > baseline

    def matches(day: str) -> bool:
        share = shares.get(day)
        return share is not None and (share > baseline) == anchor_elevated

    flags = [matches(day) for day in window_days]
    longest = current = 0
    for flag in flags:
        current = current + 1 if flag else 0
        longest = max(longest, current)
    return {
        "basis": "MEASURED", "value_status": "AVAILABLE", "reason_codes": [],
        "same_direction": sum(flags), "of_sessions": len(flags),
        "longest_run": longest, "session_flags": flags,
    }


def coverage_block(rows: list[dict], cohorts: dict[str, str]) -> dict:
    total = day_sell_total(rows)
    if total <= 0:
        return {"basis": "MEASURED", "value_status": "UNAVAILABLE",
                "reason_codes": ["NO_SELL_VALUE_ON_TRADE_DATE"],
                "matched_share": None, "cohorts_available": None, "cohorts_total": len(COHORTS),
                "completeness": "UNKNOWN"}
    matched_value = sum(row["sval"] for row in rows if row["broker_code"] in cohorts)
    present_cohorts = {cohorts.get(row["broker_code"], "unknown") for row in rows}
    matched_share = round(matched_value / total, 4)
    completeness = "FULL" if matched_share >= 0.98 else "PARTIAL" if matched_share > 0 else "UNKNOWN"
    return {
        "basis": "MEASURED", "value_status": "AVAILABLE", "reason_codes": [],
        "matched_share": matched_share, "cohorts_available": len(present_cohorts),
        "cohorts_total": len(COHORTS), "completeness": completeness,
    }


def components_record(symbol: str, trade_date: str, days_rows: dict[str, list[dict]],
                      cohorts: dict[str, str]) -> dict:
    return {
        "symbol": symbol, "trade_date": trade_date, "scoring_status": "SCORED",
        "concentration": concentration_block(days_rows, trade_date),
        "breadth": breadth_block(days_rows, trade_date),
        "persistence": persistence_block(days_rows, trade_date),
        "coverage": coverage_block(days_rows.get(trade_date, []), cohorts),
    }


def flow_series_records(symbol: str, days_rows: dict[str, list[dict]],
                        cohorts: dict[str, str]) -> list[dict]:
    """Cumulative net-value series per cohort, oldest first.

    A cohort with no rows anywhere in the window is UNAVAILABLE with an
    empty `points` array — never a flat line at zero standing in for
    missing data, per the contract's own rule.
    """
    ordered_days = sorted(days_rows)
    records = []
    for cohort in COHORTS:
        running = 0
        points = []
        seen_any = False
        for day in ordered_days:
            cohort_rows = [row for row in days_rows[day] if cohorts.get(row["broker_code"], "unknown") == cohort]
            if cohort_rows:
                seen_any = True
            running += sum(row["bval"] - row["sval"] for row in cohort_rows)
            points.append({"trade_date": day, "cumulative_net_value": running})
        records.append({
            "symbol": symbol, "cohort": cohort,
            "points": points if seen_any else [],
            "currency": "IDR",
            "value_status": "AVAILABLE" if seen_any else "UNAVAILABLE",
            "reason_codes": [] if seen_any else ["COHORT_NOT_OBSERVED"],
        })
    return records


def score_universe(raw_rows: dict[str, dict[str, list[dict]]], trade_date: str,
                   registry_db: Path) -> dict:
    """Score every symbol in `raw_rows` (as produced by `flow.ingest`).

    `raw_rows[symbol][day]` is a list of plain broker-row dicts.
    """
    cohorts = registry_cohorts(registry_db)
    components, flow_series = [], []
    for symbol, days in raw_rows.items():
        components.append(components_record(symbol, trade_date, days, cohorts))
        flow_series.extend(flow_series_records(symbol, days, cohorts))
    return {"serve_components": components, "serve_flow_series": flow_series}


def run(args):
    """CLI glue: read an `ingest-flow` report, score it, write a results file."""
    from .registry import strict_json

    payload = strict_json(Path(args.flow_report).read_bytes())
    if not isinstance(payload, dict) or "raw_rows" not in payload:
        raise RegistryError("INVALID_FLOW_REPORT: expected an ingest-flow results file")
    trade_date = args.trade_date or payload.get("trade_date") or payload["window"]["end"]
    scored = score_universe(payload["raw_rows"], trade_date, args.registry_db)
    result = {"contract_version": "1.1.0-draft.1", "contract_status": "UNDER_REVIEW",
              "data_kind": "MEASURED", "trade_date": trade_date, **scored}
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(args.report).with_suffix(".tmp")
    temporary.write_text(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
                         encoding="utf-8")
    temporary.replace(args.report)
    return result
