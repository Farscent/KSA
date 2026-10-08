# Application serving contract — 1.2.0-draft.1 (additive extension)

Version: **`1.2.0-draft.1`**. Status: **UNDER_REVIEW with Harfi**.

This extends [`1.1.0-draft.1`](serve-contract-1.1.md) **additively**, on the same
terms that version extends `1.0.0-draft.1`. Both earlier drafts and all their
fixtures are unchanged and continue to pass their own tests
(`tests/test_serve_contract.py`, `tests/test_serve_contract_v11.py` assert exact
key sets), so nothing in them may be edited in place.

Two changes force a new version rather than an edit:

1. **`data_kind` gains `MEASURED`.** Every payload in `1.0` and `1.1` was
   `SYNTHETIC_EXAMPLE` — hand-written reference data. Real daily closes ingested
   from the Sectors API are measurements, and must not be labelled as examples.
2. **A new output, `serve_price_history`**, carrying the daily close window that
   backs the portfolio value series.

Envelope shape is otherwise unchanged (`contract_version`, `contract_status`,
`output`, `data_kind`, `description`, `records`), with `contract_version` exactly
`"1.2.0-draft.1"`.

## `data_kind`

| Value | Meaning |
| --- | --- |
| `SYNTHETIC_EXAMPLE` | Hand-written reference data. Carried over from `1.0.0-draft.1`; still the value used by every committed fixture. |
| `MEASURED` | Ingested from the Sectors API by the scheduled Python batch and written unmodified except for the documented type coercions below. New in this version. |

`MEASURED` says only that the numbers were observed rather than invented. It makes
no claim about completeness — that remains `value_status` and `reason_codes`' job,
exactly as in `1.1.0-draft.1`.

Consumers must accept both values. A consumer that hard-requires
`SYNTHETIC_EXAMPLE` will reject real data; `web/lib/contract/guards.ts`'s
`assertEnvelope` was widened for precisely this reason.

## `serve_position` (carried over, now `MEASURED`)

Field shape is **identical** to `1.1.0-draft.1` — no field added, removed, or
retyped. What changes is provenance: `close` and `close_date` are now the real
IDX close for the symbol, ingested from the Sectors daily transaction endpoint,
and the envelope's `data_kind` is `MEASURED`.

`name` and `sector` remain reference data rather than measurements. They are
served from a committed constant (`sectors/demo.py`), not fetched per run — a
company's display name and sector label do not change daily, and spending API
credits to re-read them every batch would be waste.

The `UNAVAILABLE` path is unchanged and still load-bearing: a symbol with no close
for the requested window is emitted with `close: null`, `close_date: null`,
`value_status: "UNAVAILABLE"`, `reason_codes: ["PRICE_NOT_YET_INGESTED"]`. Real
ingestion does not retire this path — it must still render as the word
"unavailable", never as `Rp 0` and never as an omitted row.

## `serve_price_history`

Grain: `(symbol)`, with one nested point per trading session. Supplies the
portfolio value series that replaces the illustrative sparkline, and the close
window the scoring engine's own baseline is computed against.

| Field | Type | Meaning |
| --- | --- | --- |
| `symbol` | string | One of the frozen ten. |
| `points` | array of objects | Ascending by `trade_date`, no duplicate dates. Empty exactly when `value_status` is `UNAVAILABLE`. |
| `currency` | `"IDR"` | No scaling in the payload. |
| `value_status` | `AVAILABLE`, `UNAVAILABLE` | Whether `points` is populated. |
| `reason_codes` | unique string array | Empty when `AVAILABLE`; `["PRICE_NOT_YET_INGESTED"]` when not. |

Each element of `points`:

| Field | Type | Meaning |
| --- | --- | --- |
| `trade_date` | `YYYY-MM-DD` | IDX trading session. Non-trading days are absent, not zero-filled. |
| `close` | positive integer | Close in whole IDR. |
| `volume` | nonnegative integer or null | Shares traded. Null when the provider omitted it. |

Two rules the producer must honor:

- **Gaps are absences, not zeros.** A session with no recorded close is omitted
  from `points`. A consumer summing a portfolio across dates must treat a missing
  symbol-date as "unknown" and return null for that date's total, the same
  discipline `computeTotals` already applies to a missing close.
- **`points` is never partially trusted.** If the provider returns a window
  shorter than requested, that is reported as-is with the real dates it covers;
  the window is never padded to look complete.

## Window

The ingested window ends at the frozen demo end date
(`sectors/demo-scope.json`, `2026-09-09`) and runs 90 calendar days back, which is
the maximum the daily transaction endpoint serves in one request and yields
roughly 60 trading sessions. The frozen date is not moved by this version.

## Storage

`1.2.0-draft.1` is the first version delivered to the frontend through Supabase
rather than as a JSON envelope on disk. The table definitions are the committed
schema for that boundary — see `docs/results-schema.md` and
`supabase/migrations/0001_results.sql`. Column names mirror the field names above
one-for-one, with one documented exception: `serve_run`'s nested `window` object
is flattened to `window_sessions` / `window_start` / `window_end`, since Postgres
has no natural nested-object column and `window` is a reserved word.

When delivered as a table rather than an envelope, `contract_version` and
`data_kind` travel as columns on each row instead of on a wrapper.
