# Runbook

Step-by-step operation of the Python engine: offline replay, cache reuse, live fetches, the
storage contract, and what each command costs in Sectors credits. For what the project is,
start with [`README.md`](README.md). For rules and API billing, see [`AGENTS.md`](AGENTS.md).

Python 3.10+, SQLite and `unittest`. Offline replay needs only the standard library; live
HTTP transport and its tests use `requests`.

| Command | Network | Credits |
| --- | --- | --- |
| `python -m sectors registry` | only with `--live` | one `/v2/brokers/` call per fetch |
| `python -m sectors import-snapshot` | never | 0 |
| `python -m sectors qualify-day` | never (replay) | 0 |
| `python -m sectors ingest-prices` | only with `--live` | 1 per symbol, 10 total |
| `python -m sectors ingest-flow` | only with `--live` | about 7 per symbol, 70 total |
| `python -m sectors score-flow` | never | 0 |
| `python -m sectors publish`, `publish-flow` | Supabase only | 0 |

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

## BBCA one-day qualification

`qualify-day` is a fixed case for **BBCA / 2026-09-09**. It reads the current real registry
without changing registry history. Replay the existing observation without network access:

```powershell
python -m sectors qualify-day --observation data/daily-cache/6a6d9628-635f-4a9c-a7e3-49cef95bf7f4 --registry-db data/sectors.sqlite3 --report data/qualification/BBCA-2026-09-09.json
```

It reports `OPERATIONALLY_COMPLETE` and exits 0. That is operational acceptance for the demo,
not proof of market-wide completeness: `externally_proven_complete` stays `false`. The exact
request, calendar evidence, report semantics and limits are in
[daily qualification](docs/daily-qualification.md).

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
