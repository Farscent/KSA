## Current implementation progress

The broker registry foundation, `dim_broker` SCD2, and BBCA one-day qualification
are complete. The demo universe is now frozen in a single checked-in
[configuration](sectors/demo-scope.json); see [demo scope](docs/demo-scope.md).
The first versioned [serving contract](docs/serve-contract.md),
`1.0.0-draft.1`, is now under review with Harfi, with example-only JSON fixtures.

### What has been implemented

The pipeline can capture, validate, profile, cache, and replay the Sectors broker registry. Broker metadata is persisted in SQLite using a versioned `dim_broker` table following SCD Type 2 principles, allowing historical broker classifications to be preserved instead of overwritten.

The implementation currently supports:

* Strict validation of `/v2/brokers/` registry responses
* Offline replay using archived snapshots
* Snapshot provenance including retrieval timestamp, source, HTTP status, and SHA-256
* Broker cohort profiling for `institutional`, `retail`, `mixed`, and `unknown`
* SQLite persistence
* Versioned broker history using `[valid_from, valid_to)` intervals
* Idempotent snapshot replay
* Detection of changed broker attributes
* Retention of historical broker classifications
* Synthetic fixtures for deterministic testing
* Explicit live fetching with bounded retries and caching
* Accepted BBCA one-day qualification under the demo operational policy
* Offline loading and validation of the frozen demo universe configuration
* Draft `serve_alert` / `serve_alert_evidence` contract and deterministic fixture validation
* Daily close ingestion for the frozen ten-symbol universe (`sectors/prices.py`), archived and replayable offline
* Supabase results publication (`sectors/publish.py`) over the committed schema in `supabase/migrations/`

### Verification completed

The SCD2 behavior has been manually verified using the synthetic fixtures.

Initial registry replay:

```text
broker_count:       5
inserted_versions:  5
changed_brokers:    0
```

Replaying the exact same snapshot:

```text
already_applied:    true
inserted_versions:  0
changed_brokers:    0
```

This confirms that replaying the same observation is idempotent and does not create duplicate history.

Replaying the newer changed snapshot:

```text
broker_count:       5
inserted_versions:  1
changed_brokers:    1
```

This confirms that when one broker's tracked classification changes, the pipeline creates exactly one new historical broker version rather than overwriting the previous state.

The synthetic cohort profile changed from:

```text
institutional: 20%
retail:        20%
mixed:         20%
unknown:       40%
```

to:

```text
institutional:  0%
retail:        40%
mixed:         20%
unknown:       40%
```

which is consistent with exactly one broker changing classification from institutional to retail.

### Project checklist

| Milestone                                     | Status                                      |
| --------------------------------------------- | ------------------------------------------- |
| Align on signal thesis: structure ≠ direction | In progress                                 |
| Broker registry foundation                    | Complete: capture, cache, replay, validation, and profiling |
| `dim_broker` SCD2                             | Complete                                    |
| BBCA one-day qualification                    | Complete and accepted for demo operational policy; external completeness unproven |
| Demo universe and fixed end date              | Frozen; [scope and initial lookback](docs/demo-scope.md) |
| API credit grant                             | 1,000 hackathon team credits according to official competition rules, as supplied in the project decision |
| Endpoint credit consumption and rate limits   | Verified per-endpoint from `docs.sectors.app` (see `AGENTS.md`'s billing table); a live account balance is still unconfirmed |
| `serve_*` contract with Harfi                 | Under review: `1.0.0-draft.1`; not yet stable |
| `serve_alert.json` / `serve_alert_evidence.json` fixtures | Complete: hand-written synthetic contract examples; no actual scored output |
| Results-table schema committed                | Complete: `supabase/migrations/`, documented in [results schema](docs/results-schema.md) |
| Daily close ingestion (10 symbols, 90-day window) | Complete: `python -m sectors ingest-prices`; 1 API credit per symbol |
| Publication to Supabase                       | Complete: `python -m sectors publish`; upserts, re-runnable |
| Multi-stock broker-flow ingestion             | Complete and **run live**: `python -m sectors ingest-flow --live` (`sectors/flow.py`), 70 credits, all 10 symbols x 61 sessions cached in `data/flow-cache/` |
| Scoring                                      | Complete and **run on live data**: `python -m sectors score-flow` (`sectors/scoring.py`) — concentration/breadth/persistence/coverage, reported separately, never combined |
| Publish broker-flow results                   | Complete: `python -m sectors publish-flow` → `serve_components` / `serve_flow_series` (`supabase/migrations/0004_flow_results.sql`); 10 + 40 real `MEASURED` rows live |
| Per-company research pipeline                 | Complete: cached, credit-metered server-side Sectors client (`web/lib/sectors/`), projections and metrics (`web/lib/research/`, `web/lib/agent/`), sectioned report (`web/lib/llm/report.ts`) |
| Portfolio-wide summary                        | Complete: a second synthesis pass over the run's per-symbol packages at **zero extra credits** (`web/lib/agent/portfolio.ts`, `web/lib/llm/portfolioReport.ts`), saved to `portfolio_runs` (`supabase/migrations/0007`) and rendered on the dashboard itself — three independent concentration/breadth/persistence standout lists, never a combined score |
| Streaming research log                        | Not built: `runPipeline` yields step events and the UI shows the real post-hoc trace, but events are not streamed live yet |
| Connect application / Run Scan flow           | Partial: Run Analyst reads real scored components when present, falls back to the two-symbol fixture otherwise |

### Current scope

The frozen configuration contains ten symbols with a fixed end date of
2026-09-09 and an initial target of 20 IDX trading days including that date.
The actual date range must be resolved from verified IDX trading dates, not
naive weekdays. No start date or new network fetch is part of this milestone.
The competition credit grant is recorded from the supplied project decision;
the rules and account balance were not independently rechecked here, and the
grant does not establish per-request costs or rate limits.

At this stage, the project answers an important foundational question:

> Given a broker and an observation time, what broker classification was known at that point?

It does **not yet interpret that broker structure as bullish or bearish direction**. Registry composition and cohort structure are metadata inputs; signal direction and production scoring remain separate downstream concerns.

### Next milestone

With the demo universe frozen, the next steps are:

1. Use the accepted BBCA demo qualification policy; obtain matching-scope evidence before claiming external completeness.
2. Confirm endpoint credit consumption, available balance, and practical API rate limits.
3. Resolve the initial lookback from verified IDX trading dates.
4. Review the draft `serve_*` contract and deterministic examples with Harfi.
5. Agree scoring semantics, historical cohort mapping, and publication/freshness behavior before stabilizing the contract.
6. Extend ingestion from daily close to multi-stock, multi-day broker flow.
7. Implement scoring on top of the verified ingestion foundation.



# Sectors portfolio review foundation

Offline-first broker registry capture, validation, registry profiling, and an
observed-history `dim_broker`. The repository was empty at implementation time;
there was no application stack or applicable `AGENTS.md` to reuse. This milestone
uses Python 3.10+, SQLite, and `unittest`. Offline replay requires only the standard
library. Live HTTP transport and its tests use `requests`. Verified here on Python 3.13.

Farhan owns ingestion and deterministic scoring. Harfi's future application will
consume agreed, stable `serve_*` results. The proposed application fields are now
documented for review, independently of raw tables. `signal_state` remains
`NOT_EVALUATED`, and `score`/`severity` remain null with pending reason codes until
their definitions are agreed. No production scoring results are created.

## Offline checks and replay

Run from the repository root in PowerShell (commands also work in other shells):

```powershell
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python -m compileall -q sectors tests
python -m sectors registry --snapshot tests/fixtures/synthetic-initial --db data/demo.sqlite3
python -m sectors registry --snapshot tests/fixtures/synthetic-initial --db data/demo.sqlite3
python -m sectors registry --snapshot tests/fixtures/synthetic-changed --db data/demo.sqlite3
python -m sectors registry --snapshot tests/fixtures/synthetic-initial --profile-only
```

With a new `data/demo.sqlite3`, the first replay inserts five versions, the second
inserts zero, and the changed fixture inserts exactly one version. Re-running
these commands against an already seeded demo database is safe. Fixture timestamps
and broker attributes are entirely synthetic, including the 2040 dates.

Each successful registry command prints snapshot provenance, registry counts and
shares, and refresh results. `--profile-only` does not create or change a database.
Errors exit 1; invalid command syntax exits 2. For example, this fails with
`MALFORMED_JSON` and does not change the dimension:

```powershell
python -m sectors registry --snapshot tests/fixtures/synthetic-malformed --db data/demo.sqlite3
```

## Local import and cache reuse

A replay snapshot directory contains `body.bin` and `metadata.json`. To archive
a local body, supply its known retrieval timestamp and HTTP status. This runnable
example uses the synthetic fixture's metadata, not an invented real observation:

```powershell
python -m sectors import-snapshot --body tests/fixtures/synthetic-initial/body.bin --retrieved-at 2040-01-01T00:00:00Z --http-status 200 --synthetic --cache data/demo-cache
python -m sectors registry --cache data/demo-cache --db data/demo-cache.sqlite3
```

For real imports omit `--synthetic` and use the actual retrieval metadata. Do not
substitute a desired historical classification date. If retrieval time or status
is unknown, resolve that provenance before importing. Import saves bytes and a
manifest before validation, including failed/malformed responses; it never updates
the database. Its output gives the archived snapshot path for explicit replay.

Default acquisition chooses the latest valid, nonempty cached snapshot by UTC
retrieval timestamp (snapshot ID breaks ties). It reports warnings for rejected
cache entries and includes the selected timestamp so staleness is visible. Cache
reuse has no automatic expiration. A cache miss fails offline; it never initiates
a request. For ordered history, explicitly replay snapshots chronologically.
Cache selection alone does not ingest intermediate history. Protect the local
cache: the SHA-256 check detects accidental changes, not malicious manifest edits.

## Explicit live registry fetch

Provision `SECTORS_API_KEY` in the process environment through your normal secret
handling. The application reads it only when a network fetch is actually needed.
No credential is embedded in this repository or these commands.

```powershell
# Allow fetching only when there is no valid cached response:
python -m sectors registry --live --cache data/registry-cache --db data/sectors.sqlite3

# Explicitly request a new registry observation even when cache exists:
python -m sectors registry --live --refresh --cache data/registry-cache --db data/sectors.sqlite3 --timeout 15 --retries 2

# Subsequent offline reuse:
python -m sectors registry --cache data/registry-cache --db data/sectors.sqlite3
```

No live Sectors API requests were made during the initial foundation verification.
Live fetch targets only `GET https://api.sectors.app/v2/brokers/`, without filters.
It uses standard `requests.get` with the environment value directly in
`Authorization` and `Accept: application/json`. The normal requests User-Agent,
proxy handling, TLS verification, and adapters are used without custom overrides.
No body or preflight request is sent. Responses are captured from `response.content`
as bytes before JSON parsing. As with standalone requests, HTTP content encodings
are decoded by the transport. Redirects are refused
to prevent credential forwarding. Headers, environment values, and server error
text are never logged or included in saved request metadata. Real snapshots,
databases, and `.env` files are ignored by Git.

Defaults are a 15-second socket timeout and two retries (three attempts total).
These are local client settings, not claimed provider limits. Allowed overrides
are timeout `(0, 60]` seconds and retries `0..3`. Transport failures and HTTP
408/429/500/502/503/504 receive bounded exponential backoff. `Retry-After` seconds
and HTTP dates are honored; waits above 30 seconds stop the fetch for later manual
retry. Other HTTP statuses and malformed HTTP-200 bodies fail without retry.
Every complete HTTP response is archived before validation, even retryable error
responses. A transport failure without a complete body has no fabricated HTTP
status or response snapshot. Disk failures never trigger another paid request.

## Storage and history contract

See [schema](sectors/schema.sql) and [registry implementation](sectors/registry.py).
The archive stores exact response bytes plus snapshot ID, UTC retrieval timestamp,
endpoint, status, SHA-256, and source (`live`, `local`, or `synthetic`). Each capture
has a fresh UUID; replay retains its ID. The manifest is the completion marker.
Partially written captures and checksum failures cannot be applied. Importing the
same body twice creates two observations, so replay the existing snapshot for exact
idempotence. New observations must have strictly increasing retrieval timestamps.

Validation follows the [official registry shape](https://docs.sectors.app/api-references/v2/indonesia/brokers/broker-registry):
an array of objects containing `code`, `name`, `is_foreign`, `cohort`, and
`license_type`. Cohort and license type may be null. The local validator rejects
duplicates, extra/missing fields, incorrect types, unexpected cohort strings,
non-finite JSON values, duplicate object keys, and empty or padded codes/names.
These strict rejection choices are implementation safeguards; schema drift must
be reviewed explicitly. It does not invent a license-type enumeration.

Raw rows remain unchanged in the archive. Only derived attributes map a null
cohort to `unknown`. The SHA-256 attribute hash covers canonical JSON of
`broker_name`, `is_foreign` (boolean), normalized `cohort`, and `license_type`,
using sorted keys, compact separators, and UTF-8. Code is the natural key rather
than a tracked attribute. Whitespace inside names/license strings is preserved.
Null-to-explicit-unknown does not create a derived version; both raw observations
remain available. Row order and JSON key order do not affect attribute hashes.

`dim_broker` uses `[valid_from, valid_to)` intervals with null `valid_to` for current
versions. The boundary is when a classification was observed, not its provider
effective date. A first observation never backfills earlier days. UTC timestamps
are canonicalized to fixed microsecond precision before lexical ordering.
For an as-of timestamp `t`, use `valid_from <= t AND (valid_to IS NULL OR t < valid_to)`.
Mapping a trade date to an as-of timestamp and handling unavailable historical
classifications are still pending; do not silently join current cohorts to old days.

Refresh validates first, then uses `BEGIN IMMEDIATE` to serialize history updates.
It atomically records the snapshot, closes each changed current version, and inserts
one replacement. Replaying an already applied, identical snapshot is a no-op even
after later observations; reusing its ID with different metadata fails. A new older
or equal-time snapshot is rejected. A newer unchanged snapshot records provenance
and advances the watermark without inserting versions. Absent brokers retain their
current versions and appear in `missing_brokers_retained`; absence is not evidence
of closure. An empty registry can be profiled but cannot refresh the dimension.
Synthetic and real observations cannot share a database.

The SQL partial unique index enforces one current row per broker; checks and
insert/update triggers prevent invalid or overlapping intervals. `source_snapshot_id`
references the observation that began a version; the applied-snapshot ledger also
retains subsequent unchanged observations. Keep the body archives with the database
for auditability. The schema is initialized idempotently; future schema changes will
need explicit migrations rather than editing a live database implicitly.

## Scope and next step

The completed daily qualification milestone is implemented as a separate, fixed-case
`qualify-day` command for **BBCA / 2026-09-09**. See
[daily qualification](docs/daily-qualification.md) for its exact request, calendar
evidence, offline replay, report semantics, and limits. It reads the current real
registry without changing registry history or creating production serving tables.

Read [metric note](docs/metric-note.md), [decision log](docs/decision-log.md), and
[one-stock-day completeness checklist](docs/completeness-checklist.md).
The [verification record](docs/verification.md) lists results and their limits.
No full backfill, production scoring, frontend, LLM narration, peer screening, or
Run Scan network integration is implemented. The one-day BBCA qualification fetched
76 brokers. Offline replay now reports `OPERATIONALLY_COMPLETE`,
`operational_completeness: PASS`, and `safe_for_demo_analysis: true`, and exits 0.

The agreed demo policy accepts null buy/sell averages only when that same side's
value, lots, and frequency are all valid integer zeros. All 25 observed BBCA nulls
meet this rule. Raw nulls remain unchanged; the report records the provider/schema
deviation as `VALID_WITH_KNOWN_PROVIDER_DEVIATION`. Null averages with activity
and malformed data remain invalid; existing net-average checks are unchanged.

The documented active-broker population is accepted as
`ACTIVE_BROKER_CONTRACT_ACCEPTED`: the 12 absent current-registry brokers remain
listed as not observed / presumed inactive, with no invented activity or zero rows.
Current registry membership does not prove historical membership.

Demo eligibility requires HTTP 200, correct symbol/date and expected day group,
nonempty unique/known broker rows, valid numeric/schema data under the exception
above, both documented per-row net identities, and reviewed-calendar / real-registry
prerequisites. Aggregate buy=sell equality is descriptive; an independent control
is not a demo requirement. `external_reconciliation: NOT_EVALUATED`,
`safe_to_call_complete: false`, and `externally_proven_complete: false` distinguish
operational acceptance from market-wide claims that remain unproven.

Replay the existing observation without network access:

```powershell
python -m sectors qualify-day --observation data/daily-cache/6a6d9628-635f-4a9c-a7e3-49cef95bf7f4 --registry-db data/sectors.sqlite3 --report data/qualification/BBCA-2026-09-09.json
```

No new requests, scoring, serving tables, or multi-symbol ingestion are added by
this policy change. Broader ingestion and `serve_*` outputs remain separate work.


## Daily close ingestion and publication

Real closing prices for the frozen ten-symbol universe, used by the application's
portfolio valuation. Ingestion and publication are separate commands so a batch can
be inspected before anything is written to Supabase.

```bash
python -m sectors ingest-prices --live      # 1 API credit per symbol; 10 total
python -m sectors ingest-prices             # replay the cache; no network
python -m sectors publish                   # upsert the results file into Supabase
```

`ingest-prices` requests `https://api.sectors.app/v2/daily/{symbol}/` once per symbol
over a 90-day window ending at the frozen demo date, which is the widest window the
endpoint serves in one call. The whole-market daily-close endpoint is deliberately not
used: it is paginated over the full ~950-ticker universe and costs roughly 32 credits
per day pulled.

Bodies are archived under `--cache` before decoding, with the same
`body.bin` + `metadata.json` provenance the registry and broker-summary paths use, so
a run can be replayed offline and re-verified by checksum. Without `--live` the command
never reaches the network.

A symbol the provider returns nothing for is published `UNAVAILABLE` with
`PRICE_NOT_YET_INGESTED`, never as zero, and a session the provider omits stays absent
from the series rather than being interpolated.

## Broker-flow ingestion and scoring

Real concentration/breadth/persistence/coverage for the frozen ten-symbol universe,
against each symbol's own baseline within the ingested window. Three separate commands
— acquire, score, publish — so each stage can be inspected before the next runs.

```bash
python -m sectors ingest-flow --live        # ~7 chunks/symbol, ~70 credits for all 10
python -m sectors ingest-flow               # replay the cache; no network
python -m sectors score-flow                # compute components/flow-series from the flow report
python -m sectors publish-flow              # upsert into serve_components / serve_flow_series
```

`ingest-flow` requests `https://api.sectors.app/v2/broker-summary/{symbol}/` in <=14-day
chunks (the provider's documented range maximum) per symbol over the same window
`ingest-prices` uses, archiving bodies the same way. `score-flow` reads that report and
`data/sectors.sqlite3`'s current broker registry (for cohort classification), and writes
concentration (CR3 of sell value), breadth (brokers whose net side flipped), persistence
(trailing-window direction match), and coverage (share of sell value from a classifiable
broker) — each reported independently, per `CLAUDE.md`'s founding rule; there is no
combined score anywhere in this path. A block that cannot be computed (too short a
window, no sell value that day) is `UNAVAILABLE`, never a fabricated zero.

Requires a real, non-synthetic `dim_broker` registry (`python -m sectors registry
--live`) before `score-flow` will run — cohort classification with no verified registry
is refused rather than guessed.

### Environment

| Variable | Used by | Notes |
| --- | --- | --- |
| `SECTORS_API_KEY` | `ingest-prices --live`, `ingest-flow --live`, and the web server's research pipeline | Same key the registry and qualification paths use. The web copy lives in `web/.env.local`; it is read server-side only and never reaches the browser. |
| `SUPABASE_URL` | `publish`, `publish-flow` | Project URL, `https://…supabase.co`. |
| `SUPABASE_SERVICE_ROLE_KEY` | `publish`, `publish-flow` | Bypasses row level security. Python batch only — never place it under `web/` or in a `NEXT_PUBLIC_*` variable. |
| `OPENROUTER_API_KEY` | Run Analyst narration (`web/lib/llm/`) | Server-only. |
| `SECTORS_RUN_CREDIT_CEILING` | Research pipeline (`web/lib/sectors/cache.ts`) | Optional, default 25. Hard cap on Sectors credits one Run Analyst pass may spend per symbol; steps past it are marked `skipped`, never silently dropped. |

Both publication variables are read at call time and validated before any request is
made, so a missing key fails without touching the network.

### Research pipeline credits

One Run Analyst pass over a cold cache costs about **11 credits per symbol**: 1 overview,
1 financials, 3 valuation/future/dividend, 1 peers, 3 subsector, 3 nearby context. Every
response is cached in `public.sectors_cache` keyed by `(endpoint, params_hash)`, so a
repeated pass over the same symbol costs **0**, and symbols sharing a subsector (the four
banks in the demo universe) pay for the subsector report once between them.

`web/tests/live.test.ts` checks the request paths against the live API. It is skipped by
default; run it with `SECTORS_LIVE=1 SECTORS_API_KEY=… pnpm test` from `web/` if a report
section starts coming back UNAVAILABLE, since that is what a renamed provider path looks
like from the UI.

The portfolio-wide summary that follows a full run (`web/lib/agent/portfolio.ts`,
`web/lib/llm/portfolioReport.ts`) costs **0 additional credits**: it is a synthesis pass
over the `ResearchPackage`s the per-symbol loop already built and cached, not a new set of
Sectors calls.
