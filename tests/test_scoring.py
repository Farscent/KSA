import unittest

from sectors import scoring


def row(code, bval, sval):
    return {"broker_code": code, "bval": bval, "sval": sval, "nval": bval - sval}


class ConcentrationTests(unittest.TestCase):
    def test_known_cr3_share(self):
        # Total sell = 100; top-3 sellers = 60+25+10 = 95 -> CR3 share 0.95.
        days = {
            "2026-09-09": [row("A", 0, 60), row("B", 0, 25), row("C", 0, 10), row("D", 0, 5)],
            "2026-09-08": [row("A", 0, 30), row("B", 0, 30), row("C", 0, 30), row("D", 0, 10)],
        }
        block = scoring.concentration_block(days, "2026-09-09")
        self.assertEqual(block["value_status"], "AVAILABLE")
        self.assertEqual(block["share"], 0.95)
        self.assertAlmostEqual(block["baseline_share"], 0.9)
        self.assertEqual(block["band_count"], scoring.BAND_COUNT)

    def test_no_sell_value_is_unavailable_not_zero(self):
        days = {"2026-09-09": [row("A", 100, 0)]}
        block = scoring.concentration_block(days, "2026-09-09")
        self.assertEqual(block["value_status"], "UNAVAILABLE")
        self.assertIsNone(block["share"])
        self.assertEqual(block["reason_codes"], ["NO_SELL_VALUE_ON_TRADE_DATE"])


class BreadthTests(unittest.TestCase):
    def test_known_flip_count(self):
        # Prior day: A net buy, B net buy, C net sell.
        # Trade day:  A net sell (flipped), B net buy (same), C net buy (flipped).
        prior = {"2026-09-08": [row("A", 50, 10), row("B", 50, 10), row("C", 10, 50)]}
        today = {"2026-09-09": [row("A", 10, 50), row("B", 60, 10), row("C", 50, 10)]}
        days = {**prior, **today}
        block = scoring.breadth_block(days, "2026-09-09")
        self.assertEqual(block["value_status"], "AVAILABLE")
        self.assertEqual(block["active"], 3)
        self.assertEqual(block["changed"], 2)
        self.assertAlmostEqual(block["share"], 2 / 3, places=3)

    def test_first_session_in_window_is_unavailable(self):
        days = {"2026-09-09": [row("A", 50, 10)]}
        block = scoring.breadth_block(days, "2026-09-09")
        self.assertEqual(block["value_status"], "UNAVAILABLE")
        self.assertEqual(block["reason_codes"], ["BREADTH_NOT_COMPUTED"])
        self.assertIsNone(block["changed"])


class PersistenceTests(unittest.TestCase):
    # Two hand-computable session shapes, both selling exactly 100 in total:
    # concentrated -> CR3 = 99/100, diffuse -> CR3 = 75/100.
    CONCENTRATED = (97, 1, 1, 1)
    DIFFUSE = (25, 25, 25, 25)

    def _sessions(self, pattern):
        """Build 10 consecutive sessions from a 'C'/'D' pattern, anchor last."""
        days = {}
        for i, kind in enumerate(pattern):
            svals = self.CONCENTRATED if kind == "C" else self.DIFFUSE
            day = f"2026-08-{21 + i:02d}"
            days[day] = [row(code, 0, sval) for code, sval in zip("ABCD", svals)]
        return days, sorted(days)[-1]

    def test_known_longest_run(self):
        # C C D C C C D D C C(anchor): 7 concentrated sessions, longest streak 3.
        # Baseline over the 9 non-anchor sessions = (6*0.99 + 3*0.75)/9 = 0.91,
        # so a concentrated session is above it and a diffuse one below.
        days, anchor = self._sessions("CCDCCCDDCC")
        block = scoring.persistence_block(days, anchor)
        self.assertEqual(block["value_status"], "AVAILABLE")
        self.assertEqual(block["of_sessions"], 10)
        self.assertEqual(block["same_direction"], 7)
        self.assertEqual(block["longest_run"], 3)
        self.assertEqual(block["session_flags"],
                         [True, True, False, True, True, True, False, False, True, True])

    def test_zero_sum_nets_do_not_flatten_persistence(self):
        """Regression: every session nets to exactly zero across brokers.

        Real broker summaries always balance — total buys equal total sells to
        the rupiah — so a persistence measure built on a market-wide net
        direction scores every symbol identically. Concentration still varies,
        so the block must stay AVAILABLE and discriminating.
        """
        days, anchor = self._sessions("CCDCCCDDCC")
        for rows in days.values():
            total = sum(r["sval"] for r in rows)
            # Redistribute the same total as buys, so each session nets to 0.
            for r in rows:
                r["bval"] = total // len(rows)
                r["nval"] = r["bval"] - r["sval"]
            self.assertEqual(sum(r["bval"] for r in rows), sum(r["sval"] for r in rows))
        block = scoring.persistence_block(days, anchor)
        self.assertEqual(block["value_status"], "AVAILABLE")
        self.assertEqual(block["same_direction"], 7)
        self.assertEqual(block["longest_run"], 3)

    def test_short_window_is_unavailable(self):
        days = {"2026-09-09": [row("A", 0, 100)]}
        block = scoring.persistence_block(days, "2026-09-09")
        self.assertEqual(block["value_status"], "UNAVAILABLE")
        self.assertIsNone(block["longest_run"])


class CoverageTests(unittest.TestCase):
    def test_matched_share_and_cohort_count(self):
        cohorts = {"A": "institutional", "B": "retail"}
        rows = [row("A", 0, 60), row("B", 0, 30), row("Z", 0, 10)]  # Z unknown to registry
        block = scoring.coverage_block(rows, cohorts)
        self.assertEqual(block["value_status"], "AVAILABLE")
        self.assertEqual(block["matched_share"], 0.9)
        self.assertEqual(block["cohorts_available"], 3)  # institutional, retail, unknown
        self.assertEqual(block["completeness"], "PARTIAL")

    def test_no_sell_value_is_unavailable(self):
        block = scoring.coverage_block([row("A", 100, 0)], {"A": "institutional"})
        self.assertEqual(block["value_status"], "UNAVAILABLE")
        self.assertEqual(block["completeness"], "UNKNOWN")


class FlowSeriesTests(unittest.TestCase):
    def test_cumulative_net_value_and_unobserved_cohort(self):
        cohorts = {"A": "institutional"}
        days = {
            "2026-09-08": [row("A", 100, 40)],  # net +60
            "2026-09-09": [row("A", 20, 70)],   # net -50, cumulative +10
        }
        records = scoring.flow_series_records("BBCA", days, cohorts)
        by_cohort = {r["cohort"]: r for r in records}
        self.assertEqual(by_cohort["institutional"]["value_status"], "AVAILABLE")
        self.assertEqual(
            [p["cumulative_net_value"] for p in by_cohort["institutional"]["points"]],
            [60, 10],
        )
        # retail never appears in any row -> UNAVAILABLE with an empty series,
        # never a flat zero line standing in for missing data.
        self.assertEqual(by_cohort["retail"]["value_status"], "UNAVAILABLE")
        self.assertEqual(by_cohort["retail"]["points"], [])


if __name__ == "__main__":
    unittest.main()
