"""Run with python -m sectors; see README.md for offline and opt-in commands."""

import argparse
import json
from pathlib import Path
import sqlite3
import sys

from .registry import RegistryError, acquire, capture, connect, profile, refresh, validate


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Offline-first broker registry foundation")
    commands = parser.add_subparsers(dest="command", required=True)
    registry = commands.add_parser("registry", help="Replay/cache/profile and transactionally refresh dim_broker")
    source = registry.add_mutually_exclusive_group()
    source.add_argument("--snapshot", type=Path, help="Directory containing body.bin and metadata.json")
    source.add_argument("--live", action="store_true", help="Allow live fetch on cache miss; reads SECTORS_API_KEY")
    registry.add_argument("--refresh", action="store_true", help="With --live, bypass cache")
    registry.add_argument("--cache", type=Path, default=Path("data/registry-cache"))
    registry.add_argument("--db", type=Path, default=Path("data/sectors.sqlite3"))
    registry.add_argument("--profile-only", action="store_true")
    registry.add_argument("--timeout", type=float, default=15)
    registry.add_argument("--retries", type=int, default=2)
    local = commands.add_parser("import-snapshot", help="Archive a local response body without network access")
    local.add_argument("--body", type=Path, required=True)
    local.add_argument("--retrieved-at", required=True, help="Actual retrieval timestamp including timezone")
    local.add_argument("--http-status", type=int, required=True)
    local.add_argument("--synthetic", action="store_true")
    local.add_argument("--cache", type=Path, default=Path("data/registry-cache"))
    daily = commands.add_parser("qualify-day", help="Qualify exactly BBCA / 2026-09-09 without writing serving or registry tables")
    daily.add_argument("--symbol", choices=["BBCA"], default="BBCA")
    daily.add_argument("--trade-date", choices=["2026-09-09"], default="2026-09-09")
    daily_source = daily.add_mutually_exclusive_group()
    daily_source.add_argument("--observation", type=Path)
    daily_source.add_argument("--live", action="store_true")
    daily.add_argument("--refresh", action="store_true")
    daily.add_argument("--cache", type=Path, default=Path("data/daily-cache"))
    daily.add_argument("--registry-db", type=Path, default=Path("data/sectors.sqlite3"))
    daily.add_argument("--report", type=Path, default=Path("data/qualification/BBCA-2026-09-09.json"))
    daily.add_argument("--timeout", type=float, default=30)
    daily.add_argument("--retries", type=int, default=2)
    prices = commands.add_parser("ingest-prices",
        help="Acquire the daily close window for the frozen demo universe; writes a results file, not the database")
    prices_source = prices.add_mutually_exclusive_group()
    prices_source.add_argument("--observation", type=Path, help="Replay a single archived symbol window")
    prices_source.add_argument("--live", action="store_true",
        help="Allow live fetch on cache miss; reads SECTORS_API_KEY. Costs 1 API credit per symbol")
    prices.add_argument("--refresh", action="store_true", help="With --live, bypass cache")
    prices.add_argument("--cache", type=Path, default=Path("data/price-cache"))
    prices.add_argument("--report", type=Path, default=Path("data/results/prices.json"))
    prices.add_argument("--timeout", type=float, default=30)
    prices.add_argument("--retries", type=int, default=2)
    published = commands.add_parser("publish",
        help="Upsert an ingest-prices results file into the Supabase results tables")
    published.add_argument("--results", type=Path, default=Path("data/results/prices.json"))
    published.add_argument("--timeout", type=float, default=30)
    published.add_argument("--retries", type=int, default=2)
    flow = commands.add_parser("ingest-flow",
        help="Acquire broker-summary rows for the frozen demo universe over the price window")
    flow.add_argument("--live", action="store_true",
        help="Allow live fetch on cache miss; reads SECTORS_API_KEY. ~7 credits per symbol")
    flow.add_argument("--refresh", action="store_true", help="With --live, bypass cache")
    flow.add_argument("--cache", type=Path, default=Path("data/flow-cache"))
    flow.add_argument("--report", type=Path, default=Path("data/results/flow-raw.json"))
    flow.add_argument("--timeout", type=float, default=30)
    flow.add_argument("--retries", type=int, default=2)
    score = commands.add_parser("score-flow",
        help="Compute concentration/breadth/persistence/coverage from an ingest-flow report")
    score.add_argument("--flow-report", type=Path, default=Path("data/results/flow-raw.json"))
    score.add_argument("--registry-db", type=Path, default=Path("data/sectors.sqlite3"))
    score.add_argument("--trade-date", default=None, help="Defaults to the flow report's own trade_date")
    score.add_argument("--report", type=Path, default=Path("data/results/flow-scored.json"))
    publish_flow = commands.add_parser("publish-flow",
        help="Upsert a score-flow results file into serve_components / serve_flow_series")
    publish_flow.add_argument("--results", type=Path, default=Path("data/results/flow-scored.json"))
    publish_flow.add_argument("--timeout", type=float, default=30)
    publish_flow.add_argument("--retries", type=int, default=2)
    args = parser.parse_args(argv)
    try:
        if args.command == "qualify-day":
            from .daily import run
            result = run(args)
            print(json.dumps(result, indent=2))
            return 1 if result["qualification_status"] == "INVALID" else 0
        elif args.command == "ingest-prices":
            from .prices import run
            result = run(args)
            unavailable = [r["symbol"] for r in result["serve_position"] if r["value_status"] == "UNAVAILABLE"]
            print(json.dumps({"window": result["window"], "run": result["serve_run"],
                              "symbols_unavailable": unavailable,
                              "cache_warnings": result["cache_warnings"],
                              "report": str(args.report)}, indent=2))
            return 0
        elif args.command == "publish":
            from .publish import run
            run(args)
            return 0
        elif args.command == "ingest-flow":
            from .flow import run
            result = run(args)
            matched = {symbol: len(days) for symbol, days in result["raw_rows"].items()}
            print(json.dumps({"window": result["window"], "days_matched_per_symbol": matched,
                              "cache_warnings": result["cache_warnings"], "report": str(args.report)},
                             indent=2))
            return 0
        elif args.command == "score-flow":
            from .scoring import run
            result = run(args)
            print(json.dumps({"trade_date": result["trade_date"],
                              "symbols_scored": len(result["serve_components"]),
                              "flow_series_records": len(result["serve_flow_series"]),
                              "report": str(args.report)}, indent=2))
            return 0
        elif args.command == "publish-flow":
            from .publish import publish_flow
            from .registry import strict_json

            payload = strict_json(args.results.read_bytes())
            written = publish_flow(payload, timeout=args.timeout, retries=args.retries)
            for table in ("serve_components", "serve_flow_series"):
                print(f"{table}: {written[table]} row(s) upserted")
            return 0
        elif args.command == "import-snapshot":
            snapshot = capture(args.cache, args.body.read_bytes(), retrieved_at=args.retrieved_at,
                               http_status=args.http_status, source="synthetic" if args.synthetic else "local")
            print(json.dumps({"snapshot": snapshot.metadata(), "path": str(args.cache / snapshot.snapshot_id)}))
            validate(snapshot)
        else:
            snapshot, warnings = acquire(args.cache, snapshot_path=args.snapshot, live=args.live,
                                         force_refresh=args.refresh, timeout=args.timeout, retries=args.retries)
            result = {"snapshot": snapshot.metadata(), "cache_warnings": warnings,
                      "profile": profile(validate(snapshot))}
            if not args.profile_only:
                connection = connect(args.db)
                try:
                    result["refresh"] = refresh(connection, snapshot)
                finally:
                    connection.close()
            print(json.dumps(result, indent=2))
        return 0
    except RegistryError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except (OSError, sqlite3.Error):
        print("STORAGE_ERROR: check file permissions, free space, and database integrity", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
