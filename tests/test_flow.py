import unittest

from sectors.flow import chunk_ranges, parse_chunk_rows
from sectors.registry import RegistryError


class ChunkRangesTests(unittest.TestCase):
    def test_chunks_never_exceed_fourteen_days(self):
        ranges = chunk_ranges("2026-06-12", "2026-09-09")
        from datetime import date
        for start, end in ranges:
            span = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
            self.assertLessEqual(span, 14)

    def test_chunks_cover_the_whole_window_contiguously_with_no_gaps(self):
        ranges = chunk_ranges("2026-06-12", "2026-09-09")
        self.assertEqual(ranges[0][0], "2026-06-12")
        self.assertEqual(ranges[-1][1], "2026-09-09")
        from datetime import date, timedelta
        for (_, prev_end), (next_start, _) in zip(ranges, ranges[1:]):
            self.assertEqual(date.fromisoformat(next_start),
                             date.fromisoformat(prev_end) + timedelta(days=1))

    def test_single_day_window_yields_one_chunk(self):
        self.assertEqual(chunk_ranges("2026-09-09", "2026-09-09"), [("2026-09-09", "2026-09-09")])

    def test_inverted_window_is_rejected(self):
        with self.assertRaises(RegistryError):
            chunk_ranges("2026-09-09", "2026-09-01")


class ParseChunkRowsTests(unittest.TestCase):
    def test_valid_multi_day_payload_groups_by_date(self):
        row = {"broker_code": "AA", "bfreq": 1, "blot": 1, "bval": 100,
               "bavg_per_share": 1.0, "sfreq": 1, "slot": 1, "sval": 50,
               "savg_per_share": 1.0, "nlot": 0, "nval": 50, "navg_per_share": 1.0}
        payload = {"symbol": "BBRI.JK", "start": "2026-09-08", "end": "2026-09-09",
                   "data": [{"date": "2026-09-08", "summary": [row]},
                            {"date": "2026-09-09", "summary": [row]}]}
        by_date, findings, measurable = parse_chunk_rows(payload, "BBRI", "2026-09-08", "2026-09-09")
        self.assertTrue(measurable)
        self.assertEqual(findings["schema_findings"], [])
        self.assertEqual(set(by_date), {"2026-09-08", "2026-09-09"})

    def test_symbol_identity_mismatch_is_flagged(self):
        payload = {"symbol": "WRONG.JK", "start": "2026-09-09", "end": "2026-09-09", "data": []}
        _, findings, _ = parse_chunk_rows(payload, "BBRI", "2026-09-09", "2026-09-09")
        self.assertTrue(any(f["reason"] == "RESPONSE_IDENTITY_MISMATCH" for f in findings["schema_findings"]))

    def test_date_outside_requested_window_is_not_measurable(self):
        payload = {"symbol": "BBRI.JK", "start": "2026-09-09", "end": "2026-09-09",
                   "data": [{"date": "2099-01-01", "summary": []}]}
        _, findings, measurable = parse_chunk_rows(payload, "BBRI", "2026-09-09", "2026-09-09")
        self.assertFalse(measurable)

    def test_live_foreign_and_domestic_fields_are_accepted(self):
        """The live endpoint returns per-broker foreign/domestic splits.

        Rejecting them made every real response SCHEMA_INVALID, which scored
        the entire universe as unmeasurable.
        """
        row = {"broker_code": "AA", "bfreq": 1, "blot": 1, "bval": 100,
               "bavg_per_share": 1.0, "sfreq": 1, "slot": 1, "sval": 50,
               "savg_per_share": 1.0, "nlot": 0, "nval": 50, "navg_per_share": 1.0,
               "f_bfreq": 1, "f_blot": 1, "f_bval": 10, "f_bavg_per_share": 1.0,
               "f_sfreq": 1, "f_slot": 1, "f_sval": 5, "f_savg_per_share": 1.0,
               "d_bavg_per_share": 1.0, "d_savg_per_share": 1.0}
        payload = {"symbol": "BBRI.JK", "start": "2026-09-09", "end": "2026-09-09",
                   "data": [{"date": "2026-09-09", "summary": [row]}]}
        by_date, findings, measurable = parse_chunk_rows(payload, "BBRI", "2026-09-09", "2026-09-09")
        self.assertTrue(measurable)
        self.assertEqual(findings["schema_findings"], [])
        self.assertEqual(len(by_date["2026-09-09"]), 1)

    def test_unknown_extra_field_is_still_rejected(self):
        row = {"broker_code": "AA", "bfreq": 1, "blot": 1, "bval": 100,
               "bavg_per_share": 1.0, "sfreq": 1, "slot": 1, "sval": 50,
               "savg_per_share": 1.0, "nlot": 0, "nval": 50, "navg_per_share": 1.0,
               "surprise_field": 1}
        payload = {"symbol": "BBRI.JK", "start": "2026-09-09", "end": "2026-09-09",
                   "data": [{"date": "2026-09-09", "summary": [row]}]}
        _, findings, measurable = parse_chunk_rows(payload, "BBRI", "2026-09-09", "2026-09-09")
        self.assertFalse(measurable)
        self.assertTrue(any(f["reason"] == "UNEXPECTED_ROW_SHAPE" for f in findings["schema_findings"]))

    def test_all_null_core_row_is_excluded_never_zero_filled(self):
        """A broker-day the provider reports as entirely null is not a zero trade.

        Summing it as 0 would both crash on None and, once coerced, invent a
        data point. It is excluded and counted instead.
        """
        core = {f: None for f in ("bfreq", "blot", "bval", "bavg_per_share", "sfreq", "slot",
                                  "sval", "savg_per_share", "nlot", "nval", "navg_per_share")}
        null_row = {"broker_code": "AA", **core, "f_bval": 20600000, "f_sval": 11138297000}
        good = {"broker_code": "BB", "bfreq": 1, "blot": 1, "bval": 100,
                "bavg_per_share": 1.0, "sfreq": 1, "slot": 1, "sval": 50,
                "savg_per_share": 1.0, "nlot": 0, "nval": 50, "navg_per_share": 1.0}
        payload = {"symbol": "BBRI.JK", "start": "2026-09-09", "end": "2026-09-09",
                   "data": [{"date": "2026-09-09", "summary": [null_row, good]}]}
        by_date, findings, measurable = parse_chunk_rows(payload, "BBRI", "2026-09-09", "2026-09-09")
        self.assertTrue(measurable)
        self.assertEqual(len(findings["unreported_rows"]), 1)
        self.assertEqual(findings["unreported_rows"][0]["broker_code"], "AA")
        kept = by_date["2026-09-09"]
        self.assertEqual([r["broker_code"] for _, r in kept], ["BB"])


if __name__ == "__main__":
    unittest.main()
