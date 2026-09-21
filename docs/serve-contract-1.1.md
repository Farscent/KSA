# Application serving contract — 1.1.0-draft.1 (additive extension)

Version: **`1.1.0-draft.1`**. Status: **UNDER_REVIEW with Harfi**.

This extends [`1.0.0-draft.1`](serve-contract.md) **additively**. That version and
its fixtures (`tests/fixtures/serve_alert.json`, `serve_alert_evidence.json`) are
unchanged and continue to pass their own tests — `tests/test_serve_contract.py`
asserts exact key sets, so nothing in that draft may be edited in place; new fields
and new outputs go into this version instead. See `docs/decision-log.md` ("Frontend
design import") for why this version exists: the imported design project renders
significantly more than `1.0.0-draft.1` carries, and per the project's own rule
("write as a committed schema file before either side builds against it") that
surface is specified here before the Next.js build consumes it.

Same envelope shape as `1.0.0-draft.1` (`contract_version`, `contract_status`,
`output`, `data_kind`, `description`, `records`), with `contract_version` exactly
`"1.1.0-draft.1"`. `serve_alert` and `serve_alert_evidence` carry over with the
**same field shapes**, extended in this draft to cover two flagged demo symbols
(`BBCA`, `ANTM`) instead of one, so the frontend has more than a single row to
render. All records in every output below reference only the frozen ten-symbol
demo universe (`sectors/demo-scope.json`), except `serve_peer_screen`'s `excluded`
list, which by design ranges over candidates outside that universe — the peer
screen operates on the broader sector, not just the symbols the demo happens to hold.

Six outputs are new.

## `serve_run`

Grain: one record per batch run. Carries what the frontend's provenance strip and
run-status bar need that no other output has a natural home for.

| Field | Type | Meaning |
| --- | --- | --- |
| `data_date` | `YYYY-MM-DD` | The date the batch ran / data was published. |
| `trade_date` | `YYYY-MM-DD` | The IDX trade date scored. |
| `window` | object `{sessions, start, end}` | The session window actually used. `sessions` is a positive integer; `start`/`end` are its calendar bounds. This is **not assumed to be 60** — the frozen `lookback_trading_days: 20` supplies 20 today, and the frontend's flow chart renders whatever `sessions` says, not a hardcoded 60. |
| `symbols_requested` | integer | Size of the demo universe requested. |
| `symbols_matched` | integer | How many of those resolved to data this run; `<= symbols_requested`. |
| `cohorts_unavailable` | integer | Count of cohort records this run could not resolve, for the "Cohorts unavailable" provenance line. |

## `serve_position`

Grain: `(symbol)`. One row per frozen demo symbol — reference data the design's
Holdings table, Dashboard, and headline valuation strip need and `serve_alert`
does not carry (name, sector, price).

| Field | Type | Meaning |
| --- | --- | --- |
| `symbol` | string | One of the frozen ten. |
| `name` | nonempty string | Display company name. |
| `sector` | nonempty string | Display sector label, used for the sector-exposure donut. |
| `close` | positive integer or null | Latest close in whole IDR. Null when `value_status` is `UNAVAILABLE`. |
| `close_date` | `YYYY-MM-DD` or null | Date of that close. |
| `currency` | `"IDR"` | No scaling in the payload, matching `1.0.0-draft.1`'s rule. |
| `value_status` | `AVAILABLE`, `UNAVAILABLE` | Whether `close`/`close_date` are populated. |
| `reason_codes` | unique string array | Empty when `AVAILABLE`; `["PRICE_NOT_YET_INGESTED"]` when not. |

The fixture deliberately leaves one symbol (`MDKA`) `UNAVAILABLE` so the frontend's
unavailable-price path — never rendering it as `Rp 0` or omitting the row — is
exercised by real fixture data, not assumed.

## `serve_components`

Grain: `(symbol, trade_date)`. The concentration/breadth/persistence severity
components the design renders as four separate cards, **reported separately with
no combined score** — per `CLAUDE.md`'s thesis and `AGENTS.md`'s explicit rule that
severity must never collapse into one opaque number.

Concentration is CR3 (top-3 broker share of sell value against its own baseline
share), and breadth is the share/count of brokers that changed side — this
supersedes `seller_hhi` / `inst_sell_breadth` wording from an earlier revision of
`CLAUDE.md`; see the decision log entry.

Every component block shares this shape:

| Field | Type | Meaning |
| --- | --- | --- |
| `basis` | `EXAMPLE_VALUE`, `MEASURED` | Whether the numbers are real measurements or placeholder example values pending scoring definition — the design's amber "Example values — scoring not finalised" badge. Only `coverage` may be `MEASURED` in this draft; the other three are `EXAMPLE_VALUE` until scoring is defined. |
| `value_status` | `AVAILABLE`, `UNAVAILABLE` | Whether this block's numeric fields are populated. |
| `reason_codes` | unique string array | Empty when `AVAILABLE`; nonempty when not (e.g. `BREADTH_NOT_COMPUTED`). |

| Record field | Type | Meaning |
| --- | --- | --- |
| `symbol`, `trade_date` | as elsewhere | Identity. |
| `scoring_status` | `PENDING_DEFINITION` | Matches `serve_alert.scoring_status` — components are not yet a scored signal. |
| `concentration` | block + `top_n`, `share`, `baseline_share`, `band`, `band_count` | `share`/`baseline_share` are fractions in `[0,1]`; `band`/`band_count` back the design's 5-segment indicator. |
| `breadth` | block + `changed`, `active`, `share`, `baseline_share` | `changed` brokers out of `active` brokers; `share` is `changed/active`. |
| `persistence` | block + `same_direction`, `of_sessions`, `longest_run`, `session_flags` | `session_flags` is a boolean array, oldest first, length `of_sessions`, backing the design's tick strip. |
| `coverage` | block (`basis: MEASURED`) + `matched_share`, `cohorts_available`, `cohorts_total`, `completeness` | `completeness` is `FULL`, `PARTIAL`, or `UNKNOWN`. This block alone is measured, not an example. |

The fixture leaves ANTM's `breadth` block `UNAVAILABLE` on purpose, so "not
computed" and "computed as zero" stay visibly distinct in real fixture data.

## `serve_flow_series`

Grain: `(symbol, cohort)`. Backs the 60-(or however many)-session cumulative
cohort flow chart.

| Field | Type | Meaning |
| --- | --- | --- |
| `symbol`, `cohort` | as elsewhere | Identity; `cohort` includes `unknown`. |
| `points` | array of `{trade_date, cumulative_net_value}` | Sorted ascending by date. `cumulative_net_value` is a signed integer in whole IDR. |
| `currency` | `"IDR"` | |
| `value_status` | `AVAILABLE`, `UNAVAILABLE` | |
| `reason_codes` | unique string array | Empty when `AVAILABLE`. |

`UNAVAILABLE` requires `points: []` — never a flat line at zero standing in for
missing data. Point count matches `serve_run.window.sessions` when available.

## `serve_peer_screen`

Grain: `(symbol)`. Backs the peer-comparison screen, with exclusions shown before
the shortlist as the design and `AGENTS.md` both require.

| Field | Type | Meaning |
| --- | --- | --- |
| `symbol` | string | The held symbol being screened against peers. |
| `peer_set_label` | nonempty string | e.g. `"Financials · large-cap banks"`. |
| `screened` | integer | Total candidates considered; `>= len(excluded) + len(shortlist)`, since a candidate can be screened without being singled out either way. |
| `excluded` | array of `{symbol, name, reason_code, reason_text, detail}` | Every exclusion has a plain-text reason and a supporting detail string — never a bare rejection. |
| `shortlist` | unique string array | Peer symbols that passed the screen. Never includes `symbol` itself. |
| `scorecard` | array of `{label, note, unit, cells}` | One row per compared metric. `unit` is one of `IDR`, `SHARE`, `PERCENT`, `COUNT`, `RATIO_LABEL`. `RATIO_LABEL` cells (e.g. `"9 / 41"`) carry a pre-formatted plain-text value for the same reason `title`/`explanation`/`summary` are free text elsewhere in this contract — they are a display label, not a monetary amount subject to the no-scaling rule. |

Each scorecard cell is `{symbol, value, value_status, reason_codes}` with the same
`AVAILABLE`/`UNAVAILABLE` null-discipline as everywhere else in this contract — the
fixture leaves one cell (`BBNI`'s data-coverage) `UNAVAILABLE` to exercise it.

## `serve_narrative`

Grain: `(symbol, trade_date)`. The plain-language explanation, still LLM-authored
narration over already-computed numbers per `CLAUDE.md`'s "LLM never sees raw data
and never does math" rule — this output is the mechanism that makes that rule
checkable, not a relaxation of it.

| Field | Type | Meaning |
| --- | --- | --- |
| `symbol`, `trade_date` | as elsewhere | Identity. |
| `paragraphs` | array of nonempty strings | Plain text, no HTML, no client-side parsing of prose — same rule as `serve_alert.summary`. |
| `grounded_in` | unique string array of field paths | Every path must resolve to a field that exists on another `1.1.0-draft.1` output for this symbol/date. A path the narration was not actually given must not appear here, and a number the narration states must trace to one of these paths. |

The ANTM fixture record demonstrates the rule concretely: because ANTM's
`serve_components.breadth` block is `UNAVAILABLE` this run, its narrative's
`grounded_in` list contains no `serve_components.breadth.*` path, and its prose
never states a "brokers changed side" figure — the narration cannot state what it
was not given.

## Fixtures

All in `tests/fixtures/`, suffixed `_v11` to keep them alongside (not instead of)
the `1.0.0-draft.1` fixtures: `serve_run_v11.json`, `serve_position_v11.json`,
`serve_alert_v11.json`, `serve_alert_evidence_v11.json`, `serve_components_v11.json`,
`serve_flow_series_v11.json`, `serve_peer_screen_v11.json`, `serve_narrative_v11.json`.
Validated by `tests/test_serve_contract_v11.py`, run alongside (not replacing)
`tests/test_serve_contract.py`.

All envelopes are labeled `SYNTHETIC_EXAMPLE`. Nothing here is scored output —
`signal_state` stays `NOT_EVALUATED`, `score`/`severity` stay `null`, and
`scoring_status` stays `PENDING_DEFINITION` throughout, exactly as in
`1.0.0-draft.1`. This draft only adds the *shape* the frontend renders; filling it
with real batch output is separate work (see `CLAUDE.md`'s "Not yet built" list).

## Product agreement needed with Harfi

Same five open items as `1.0.0-draft.1` §"Product agreement needed with Harfi",
plus:

6. Confirm `basis: EXAMPLE_VALUE` vs `MEASURED` as the right way to distinguish
   "this number is a stand-in pending scoring" from "this number is a real
   measurement" — used here so `coverage` (measured today) and
   `concentration`/`breadth`/`persistence` (example today) don't share one
   ambiguous status field.
7. Confirm the `RATIO_LABEL` unit is an acceptable narrow exception to "no
   formatting in the payload," scoped to non-monetary ratio display cells only.
8. Agree who is responsible for keeping `serve_narrative.grounded_in` in sync with
   whatever fields the eventual scoring engine actually adds or removes.
