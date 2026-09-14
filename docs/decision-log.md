# Foundation decision log

Recorded 2026-09-11. “Confirmed” denotes the user's metric/project requirements;
“implementation choice” denotes local engineering behavior for this milestone;
“proposed” and “pending” do not imply approval. No real data was fetched during
the initial foundation verification. A subsequent user-run live registry fetch
succeeded; see [verification.md](verification.md). Daily trading-data availability
has not been established.

## Confirmed requirements

| Topic | Decision |
| --- | --- |
| Ownership | Farhan: ingestion and deterministic scoring. Harfi: app consuming stable `serve_*` outputs. |
| Metric definitions | Follow [metric-note.md](metric-note.md): fixed scope, stated grains and formulas, 60 preceding exchange trading days excluding the scored day. |
| Zero denominator | Null plus reason code; exact serving vocabulary still pending. |
| Interpretation | Broker intermediary classifications; no investor-identity inference, price prediction, causality, or trading recommendation. |
| Raw lineage | Preserve response bytes and provenance; normalize null cohort only downstream. |
| History | Record observed classification changes; no invented effective dates or silent historical backdating. |
| Delivery scope | Registry foundation and completeness handoff; no full backfill or production scoring yet. |

## Documentation evidence, not runtime proof

The [official registry documentation](https://docs.sectors.app/api-references/v2/indonesia/brokers/broker-registry),
checked 2026-09-11, documents the unfiltered registry endpoint, source fields,
nullable cohort/license type, and four cohort labels. It lists a one-credit request
cost. This does not establish account entitlement, remaining credits, quota, rate
limits, or the contents/completeness of a real response.

The [daily per-symbol documentation](https://docs.sectors.app/api-references/v2/indonesia/brokers/broker-summary-by-symbol)
describes daily rows for active brokers and a date range up to 14 days. That is a
candidate for the next-stage completeness experiment, not evidence that any chosen
stock-day is available or reconciles. Confirm the account's applicable constraints
before planning calls; do not extrapolate quota from the documented range.

## Implementation choices made for this milestone

| Choice | Behavior and rationale |
| --- | --- |
| Runtime/storage | Empty repo: Python standard library and SQLite. A subsequent live-transport fix uses `requests` for live fetching and transport tests; offline replay remains standard-library-only. |
| Capture | Fresh UUID per observation, exact bytes, SHA-256, UTC retrieval time, endpoint, HTTP status, provenance source; no headers/secrets in metadata. |
| Cache | Latest valid nonempty snapshot reused indefinitely unless explicit live refresh; selected age and invalid-entry warnings visible. No network on an offline miss. |
| Request resilience | Local default 15-second socket timeout, two retries; transient statuses only; bounded Retry-After; no redirects. These are client settings, not provider limits. |
| Validation | Reject entire snapshot on duplicate code, schema drift, malformed JSON, wrong types, or unexpected cohort. No silent row dropping or new-cohort coercion. |
| Empty response | Profile as zero brokers with null shares and `EMPTY_REGISTRY`; refuse dimension refresh. This is a registry safeguard, not the scoring coverage policy. |
| Canonical attributes | Hash name, foreign flag, derived cohort, license type. Null and explicit unknown cohort are equivalent in derived history; original values remain archived. |
| Time semantics | Observation timestamps in UTC; strictly increasing new snapshot application; identical applied snapshot replays allowed at any time. |
| Missing registry broker | Retain current version and report absence. Disappearance is not an approved deletion/closure signal. |
| Provenance isolation | Synthetic snapshots cannot mix with real/local observations in one database. |

## Proposed and pending decisions

| Topic | Status | Evidence or decision still required |
| --- | --- | --- |
| Five-day persistence | Proposed | Approve counting daily conditions in five trading dates including the scored date; five fully evaluated conditions require at least 65 trading dates. |
| Thresholds and baseline statistic | Pending | Define comparison statistic and thresholds; no numeric thresholds approved. |
| Daily structural rule | Pending | Agree exact logical condition combining approved measures. |
| Severity formula | Pending | Agree formula, scale, nullability, and interpretation. |
| Coverage policy | Pending | Establish required broker universe, missing-input behavior, and acceptable completeness/reconciliation evidence. |
| Missing-day persistence | Pending | Decide whether/how incomplete days invalidate the five-day result; no silent omission or imputation. |
| API access/quota | Partially verified; quota pending | A live unfiltered registry request succeeded on 2026-09-11. Available quota/credits, renewal period, and access to required daily endpoints remain unverified. |
| Request limits | Pending | Confirm account rate/concurrency limits, pagination/caps, allowed range semantics, and retry budget before backfill planning. |
| Ten demo symbols | Pending | User-selected or explicitly approved ten-symbol list; none supplied or invented. |
| End date | Fixed for one-day experiment; broader demo pending | User selected BBCA / 2026-09-09 for qualification only. This does not select the ten-symbol demo's end date. |
| Daily completeness | Experiment executed; not COMPLETE | The [one-day result](daily-qualification.md) contains 76 active broker rows with matching net arithmetic and balanced totals; 25 zero-side average nulls contradict the non-nullable published schema. Individual absences, market/session scope, upstream completeness and an independent control remain unresolved. |
| Classification history | Pending | Establish whether dated effective classifications exist, first reliable observation, treatment before that time, and trade-date/as-of timestamp mapping. Observed current data is not historical truth. |
| Exchange calendar | Pending | Establish authoritative trading dates, sessions/timezone, holidays, suspensions, and missing-vs-zero activity semantics. |
| Stable `serve_*` contract | Pending | Farhan and Harfi agree fields, versioning, metric reasons, freshness, coverage flags, and permitted interpretation after completeness and scoring decisions. |

The fixed one-stock-day validator and archived observation now exist. Next concrete
step: resolve the zero-side average nullability contract and obtain market/session
scope plus an independent matching control before approving completeness or
scaling ingestion. The future application must read prepared serving results;
Run Scan must not initiate live Sectors requests.

| Completeness pilot symbol | Confirmed | BBCA — selected as the first high-liquidity stock for daily broker-data qualification. |
| Completeness pilot date | Confirmed | 2026-09-09 — selected as a completed historical weekday with buffer from the latest session. Exchange-session validity must still be checked explicitly by the completeness workflow. |
| Completeness pilot scope | Confirmed | Exactly 1 symbol × 1 trade date. No backfill or scoring during this experiment. |
