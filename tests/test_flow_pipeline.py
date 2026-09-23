"""End-to-end: flow.ingest -> scoring.score_universe -> publish row-shaping.

Uses only synthetic/local archived observations and a hand-built registry
database — no network, no live API key — to prove the three new modules
actually fit together, not just that each passes in isolation.
"""

import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from sectors import flow, publish, scoring
from sectors.demo import DemoScope


def broker_row(code, bval, sval):
    return {"broker_code": code, "bfreq": 1, "blot": 1, "bval": bval,
            "bavg_per_share": 1.0, "sfreq": 1, "slot": 1, "sval": sval,
            "savg_per_share": 1.0, "nlot": 0, "nval": bval - sval, "navg_per_share": 1.0}


def chunk_body(symbol, days_rows):
    return json.dumps({
        "symbol": f"{symbol}.JK",
        "data": [{"date": day, "summary": rows} for day, rows in days_rows.items()],
    }).encode("utf-8")


def build_registry_db(path: Path):
    connection = sqlite3.connect(path)
    connection.executescript(Path("sectors/schema.sql").read_text())
    connection.execute(
        "INSERT INTO registry_snapshot VALUES (?, ?, ?, ?, ?, ?)",
        ("snap-1", "2026-09-09T00:00:00Z", "https://api.sectors.app/v2/brokers/", 200, "x" * 64, "local"))
    for code, cohort in (("AA", "institutional"), ("BB", "retail"), ("CC", "institutional")):
        connection.execute(
            "INSERT INTO dim_broker VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (f"v-{code}", code, f"Broker {code}", 0, cohort, None,
             "2020-01-01T00:00:00Z", None, "snap-1", f"hash-{code}"))
    connection.commit()
    connection.close()


class EndToEndPipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.registry_db = self.tmp / "registry.sqlite3"
        build_registry_db(self.registry_db)
        self.cache = self.tmp / "flow-cache"

    def archive_symbol(self, symbol, start, end, rows_per_day):
        flow.archive(self.cache, chunk_body(symbol, rows_per_day), 200,
                    symbol=symbol, start=start, end=end, source="synthetic")

    def test_ingest_then_score_then_row_shape_for_two_symbols(self):
        scope = DemoScope(symbols=("BBRI", "BBCA"), end_date=__import__("datetime").date(2026, 9, 9),
                          lookback_trading_days=20)
        # Archive only the final <=14-day chunk (the one containing the two
        # target trading days); earlier chunks are left uncached on purpose,
        # to prove a partial ingest degrades to a warning per missing chunk
        # rather than fabricating the missing days.
        full_start, full_end = flow.price_window(scope)
        final_chunk_start, final_chunk_end = flow.chunk_ranges(full_start, full_end)[-1]
        for symbol, mix in (
            ("BBRI", {"2026-09-08": [broker_row("AA", 40, 60), broker_row("BB", 30, 10)],
                      "2026-09-09": [broker_row("AA", 60, 40), broker_row("BB", 10, 30)]}),
            ("BBCA", {"2026-09-08": [broker_row("CC", 10, 90)],
                      "2026-09-09": [broker_row("CC", 90, 10)]}),
        ):
            self.archive_symbol(symbol, final_chunk_start, final_chunk_end, mix)

        ingested = flow.ingest(self.cache, scope=scope)
        self.assertTrue(all("NO_FLOW_CACHE" in w for w in ingested["cache_warnings"]))
        self.assertEqual(set(ingested["raw_rows"]), {"BBRI", "BBCA"})
        for symbol in ("BBRI", "BBCA"):
            self.assertEqual(set(ingested["raw_rows"][symbol]), {"2026-09-08", "2026-09-09"})

        scored = scoring.score_universe(ingested["raw_rows"], "2026-09-09", self.registry_db)
        self.assertEqual(len(scored["serve_components"]), 2)
        self.assertEqual(len(scored["serve_flow_series"]), 2 * len(scoring.COHORTS))

        bbri = next(r for r in scored["serve_components"] if r["symbol"] == "BBRI")
        # BBRI sell values 09-09: AA=40, BB=30 -> total 70, top3(=all)=70 -> share 1.0
        self.assertEqual(bbri["concentration"]["value_status"], "AVAILABLE")
        self.assertEqual(bbri["concentration"]["share"], 1.0)
        self.assertEqual(bbri["coverage"]["completeness"], "FULL")

        # Row-shaping for publish must survive a JSON round trip identically.
        rows = publish.components_rows(scored["serve_components"])
        self.assertEqual({r["symbol"] for r in rows}, {"BBRI", "BBCA"})
        self.assertIn("concentration_share", rows[0])
        self.assertIn("breadth_changed", rows[0])
        series_rows = publish.flow_series_rows(scored["serve_flow_series"])
        self.assertEqual(len(series_rows), 2 * len(scoring.COHORTS))
        json.dumps(rows)  # must be plain-JSON-serializable for PostgREST
        json.dumps(series_rows)


if __name__ == "__main__":
    unittest.main()
