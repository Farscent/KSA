## Current implementation progress

The current milestone establishes the broker-registry and historical broker-dimension foundation for the KSA project.

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
| Confirm API quota                             | Pending                                     |
| Lock 10 demo stocks and fixed end date        | Pending                                     |
| Pull and cache `/v2/brokers/`                 | Implemented                                 |
| Profile registry cohort coverage              | Implemented                                 |
| Define versioned `dim_broker` SCD2 table      | Implemented and verified                    |
| One-stock-day BBCA qualification              | Implemented; findings still need resolution |
| Freeze `serve_*` schema with Harfi            | Pending                                     |
| Create `serve_alert_evidence.json` fixture    | Pending                                     |
| Build full market-data ingestion              | Pending                                     |
| Add production scoring                        | Pending                                     |
| Connect application / Run Scan flow           | Pending                                     |

### Current scope

At this stage, the project answers an important foundational question:

> Given a broker and an observation time, what broker classification was known at that point?

It does **not yet interpret that broker structure as bullish or bearish direction**. Registry composition and cohort structure are metadata inputs; signal direction and production scoring remain separate downstream concerns.

### Next milestone

Before expanding into the full demo universe, the next steps are:

1. Resolve findings from the BBCA one-stock-day qualification.
2. Confirm the practical Sectors API request quota.
3. Freeze the 10-stock demo universe and end date.
4. Agree on the stable `serve_*` schema with the application side.
5. Create deterministic serving fixtures.
6. Build market-data ingestion and raw persistence.
7. Implement scoring on top of the verified ingestion foundation.



# Sectors portfolio review foundation

Offline-first broker registry capture, validation, registry profiling, and an
observed-history `dim_broker`. The repository was empty at implementation time;
there was no application stack or applicable `AGENTS.md` to reuse. This milestone
uses Python 3.10+, SQLite, and `unittest`. Offline replay requires only the standard
library. Live HTTP transport and its tests use `requests`. Verified here on Python 3.13.

Farhan owns ingestion and deterministic scoring. Harfi's future application will
consume agreed, stable `serve_*` results. This milestone does not create scoring
results or an application contract before their pending definitions are resolved.

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

The next foundation milestone is implemented as a separate, fixed-case
`qualify-day` command for **BBCA / 2026-09-09**. See
[daily qualification](docs/daily-qualification.md) for its exact request, calendar
evidence, offline replay, report semantics, and limits. It reads the current real
registry without changing registry history or creating production serving tables.

Read [metric note](docs/metric-note.md), [decision log](docs/decision-log.md), and
[one-stock-day completeness checklist](docs/completeness-checklist.md).
The [verification record](docs/verification.md) lists results and their limits.
No full backfill, production scoring, frontend, LLM narration, peer screening, or
Run Scan network integration is implemented. The one-day BBCA qualification fetched
76 brokers and identified a published-schema nullability discrepancy plus unresolved
coverage evidence. The next step is to resolve those findings before expanding to
an approved demo universe or defining `serve_*` outputs.
