# KSA Sectors — Portfolio Review Engine

Sectors Hackathon 2026, Track 03: Market Intelligence.

## What this is

A portfolio review engine, not a portfolio tracker. The user enters their holdings and
gets back evidence of what changed underneath each position: a structural anomaly score
against the stock's own 60-day baseline, comparable peer alternatives (or an honest "none
qualify"), and a plain-language explanation grounded only in numbers the system actually
computed.

**Critical thesis**: broker trading is zero-sum — total buys always equal total sells. So
"institutions are selling while retail is buying" is arithmetic, not a discovery. Direction
tells you nothing on its own. What carries information is the *shape* of the selling:

- **Concentration** (CR3 — top-3 broker share of sell value, against its own baseline
  share) — is selling coming from a few brokers or spread wide?
- **Breadth** (share/count of brokers that changed side) — how many brokers moved
  from net buyer to net seller (or vice versa), not just how many are on one side?
- **Persistence** — one-day blip or multi-day pattern?
- The "mixed"/unclassifiable middle buckets, which break the two-way symmetry.

Direction narrows candidates. Structure is the signal. Any code that flags "institutions
sold" as the finding, without a concentration/breadth/persistence component, is measuring
the wrong thing.

These three components are reported **separately, never collapsed into one combined
severity score** — a single number would hide which component actually moved and
invite reading it as a buy/sell signal. Each component's example values carry their
own baseline and band, and a data-coverage measurement is always shown alongside them
so a viewer can tell "not flagged" from "not measurable" apart.

No machine learning: the rule set already filters hard on ~9 features from the same
underlying data, and there is no honest historical label for "real institutional dumping"
to train against. Deterministic, auditable scoring is the product, not a placeholder for
a future model.

## Not the product

No price prediction. No trading bot. No broker connection or order placement. No causal
claims about news/filings ("this alert happened because of X") — news and filings are
shown as nearby context only, and are mainly used to *suppress* false alarms (e.g. a
scheduled corporate action explaining an apparent anomaly), never to explain "why."

## Build order

**Headline feature: broker-flow anomaly detection first**, then peer/sector comparison.
Concretely: get concentration/breadth/persistence scoring producing real alerts on the
demo universe before starting the peer screener.

## Architecture

Stack is adapted from the original white paper: the ingestion/scoring engine is Python
(this repo already has it), the frontend stays Next.js/TypeScript as planned.

```
Sectors API
     |
     |  scheduled batch (Python; e.g. GitHub Actions)
     v
Ingestion --> raw storage --> DuckDB (via Python bindings, for scoring)
                                    |
                                    v
                    Rule + per-component severity, no combined score (Python)
                                    |
                                    v
                          Written explanation (LLM narration)
                                    |
                                    v
Chat <-- Next.js app (Harfi, TypeScript) <-- Supabase (Postgres, finished results only)
```

Two rules that keep this honest:

1. **The browser never calls the Sectors API.** Bulk historical ingestion — everything that
   feeds scoring — happens in the scheduled Python batch, and the in-app "Run Scan" button
   re-runs scoring against already-downloaded data with no network call to Sectors.

   *Amended when the research pipeline landed*: the Next **server** may call Sectors, but
   only through `web/lib/sectors/client.ts` and only via the cache-first, credit-metered
   wrapper in `web/lib/sectors/cache.ts`, which enforces a hard per-run ceiling
   (`SECTORS_RUN_CREDIT_CEILING`, default 25/symbol) and records every fetch in a provenance
   ledger. A repeated Run Analyst pass over the same symbol costs **0 credits**. This buys
   the per-company research (profile, financials, valuation, peers, nearby context) that the
   batch has no reason to pre-fetch for all of IDX. It does not move broker-flow ingestion
   out of Python, and it must not: see `docs/decision-log.md`.
2. **The LLM never sees raw data and never does math.** It receives a package of
   already-computed numbers (from Supabase) and turns them into sentences. If a figure
   isn't in the package, the LLM cannot state it. The in-app "Ask about this result"
   panel follows the same rule even before real narration exists: its answers are
   assembled only from figures already rendered on the current screen.

Portfolio valuation (cost basis, market value, unrealized P&L, a portfolio-value
sparkline, sector exposure) is in scope alongside the anomaly review. It is descriptive
of the user's own entered holdings against the batch's own daily close data — not a
price prediction — so it doesn't conflict with "Not the product" above.

## Current implementation status

Kept in sync with `README.md` — check there for the authoritative checklist. As of now:

**Done:**
- Broker registry capture/validate/profile/replay (`sectors/registry.py`)
- `dim_broker` SCD2 versioned history (`sectors/schema.sql`)
- BBCA one-day qualification, hardcoded to 2026-09-09 (`sectors/daily.py`, `daily_range.py`)
- Frozen 10-symbol demo universe (`sectors/demo.py`, `sectors/demo-scope.json`)
- Draft `serve_*` output contract `1.0.0-draft.1` with example fixtures (`docs/serve-contract.md`)
- Draft `serve_*` output contract `1.1.0-draft.1` (additive: run/position/components/
  flow-series/peer-screen/narrative outputs) with example fixtures
  (`docs/serve-contract-1.1.md`), written to unblock frontend layout work
- Next.js frontend scaffold in `web/`, built against `1.1.0-draft.1` fixtures
- Committed results-table schema (`supabase/migrations/`, `docs/results-schema.md`) —
  the Python↔frontend boundary the locked decision required
- Contract `1.2.0-draft.1` (`docs/serve-contract-1.2.md`): adds `data_kind: MEASURED`
  and the `serve_price_history` output
- Real daily close ingestion for the frozen ten (`sectors/prices.py`) and publication
  to Supabase (`sectors/publish.py`)
- Supabase-backed holdings and intents, per user with RLS. The demo portfolio and the
  localStorage store are gone; portfolio valuation and the value sparkline now run on
  ingested closes
- "Run Analyst" (`web/components/RunReviewBar.tsx`, `web/lib/agent/actions.ts`): a real
  per-symbol LLM narration pass over the fixture-backed `serve_components` package
  (OpenRouter, `web/lib/llm/`), saved to a new `public.agent_runs` table
  (`supabase/migrations/0003_agent_runs.sql`) with a deterministic `Healthy`/`Watch`/
  `Rebalance` verdict (`web/lib/verdict.ts` — a triage label, not a combined severity
  score) and a per-symbol follow-up chat (`web/components/AnalystChat.tsx`). See
  `docs/decision-log.md`'s "Run Analyst" entry.
- Multi-symbol, multi-day broker-flow ingestion (`sectors/flow.py`, chunked into <=14-day
  `/v2/broker-summary/{symbol}/` calls per the provider's documented range limit) and the
  concentration/breadth/persistence/coverage scoring engine itself (`sectors/scoring.py`),
  against each symbol's own baseline within the ingested window. Reported separately, never
  combined into one score, per this file's founding rule. Publishes real `serve_components`
  / `serve_flow_series` rows to Supabase (`supabase/migrations/0004_flow_results.sql`,
  widened `sectors/publish.py`) via `python -m sectors ingest-flow --live && score-flow &&
  publish-flow`. `web/lib/data/results.ts` reads these first; the two-symbol fixture is now
  only a fallback for whichever symbols haven't been scored yet (`web/app/(review)/layout.tsx`
  merges the two server-side). This is the root-cause fix for Run Analyst's old
  `"No scoring data available for <symbol> yet"` error, which fired for every held symbol
  except BBCA/ANTM because the LLM package was fixture-only before this landed
  (`web/lib/llm/package.ts`).

- **Live broker-flow ingestion has been run.** All ten demo symbols are scored from real
  `/v2/broker-summary/` data over the frozen 61-session window (~70 credits, cached on disk
  in `data/flow-cache/`), and `serve_components` / `serve_flow_series` in Supabase hold 10
  and 40 real `MEASURED` rows. Three provider realities surfaced only under live data and are
  now handled: responses arrive **zstd**-encoded (`sectors/daily.py:decoded_json`); rows carry
  **foreign/domestic split fields** beyond the core schema (`sectors/flow.py`'s
  `OPTIONAL_ROW_FIELDS`); and a few broker-days report the **entire core aggregate as null**,
  which is excluded and counted, never zero-filled.
- **Per-company research pipeline** (`web/lib/sectors/`, `web/lib/research/`,
  `web/lib/agent/pipeline.ts`): a server-side, cache-first, credit-metered client plus
  projections and deterministic metrics, feeding a sectioned report
  (`web/lib/llm/report.ts`) that Run Analyst saves to `agent_runs` with its package,
  provenance and step trace (`supabase/migrations/0005`, `0006`). Valuation figures are
  **reported from Sectors with attribution, never predicted** — the "No price prediction"
  rule is unchanged.
- **Portfolio-wide summary.** Run Analyst used to review every holding but produce nothing
  about the portfolio as a whole — one line of text on the dashboard, with each report
  reachable only by clicking through to a flagged symbol. It now runs a second synthesis
  pass, at **zero extra Sectors credits**, over the per-symbol packages the run already
  built (`web/lib/agent/portfolio.ts`, `web/lib/agent/portfolioMetrics.ts`), narrated
  section by section (`web/lib/llm/portfolioReport.ts`) and saved to `portfolio_runs`
  (`supabase/migrations/0007`). It renders on the dashboard itself
  (`web/components/PortfolioReportView.tsx`), not on a detail page. The founding
  concentration/breadth/persistence rule holds at the portfolio level too: the cross-holding
  section reports **three independent standout lists**, never a ranked "riskiest holdings"
  view or a combined score — see `docs/decision-log.md`. The "Ask about this result" panel
  is now LLM-backed against the saved portfolio package (`askPortfolioFollowUp`), replacing
  the keyword matcher for any run that has a summary; the matcher remains the fallback before
  a first run. Every holding row on the overview is clickable now, not only flagged ones —
  the per-symbol reports it links to were always real, just unreachable.

**Not yet built:**
- Live *streaming* of the research step log. `runPipeline` is an `AsyncGenerator` yielding
  step events, and `RunReviewBar` shows the real post-hoc trace each run returns, but the
  events are not yet streamed to the browser as they happen — that needs the route handler in
  Part 3 of the plan referenced in `docs/decision-log.md`.
- Macro and policy context. The report declares a `macro` block that is permanently
  `UNAVAILABLE` with `NO_SEARCH_PROVIDER`: there is no web-search key, and a macro figure
  without a source URL must never be stated. Declared rather than omitted so the gap is
  visible.
- The `serve_peer_screen` **contract output** with real data. Peer comparison itself now
  runs for real inside the research pipeline (`peerMetrics` in `web/lib/agent/metrics.ts`,
  including the honest "no eligible peer" path with stated exclusion reasons), but it is not
  yet emitted as the contract's own `serve_peer_screen` record or written by the batch.
- The formal `serve_narrative` contract output itself is still fixture-only; Run
  Analyst's report is a separate, `agent_runs`-backed path that follows the same
  "LLM never sees raw data or does math" rule but isn't yet the contract's own field.
- `serve_alert` / `serve_alert_evidence` remain fixture-only, so `isFlagged` and the
  overview's "flagged" count still read the two-symbol fixture even though
  `serve_components` is now real for all ten. Closing that gap means deriving alerts from
  the scored components in the batch. Navigation no longer depends on this flag (every row
  is clickable), but the "N flagged" count on the dashboard still can be misleading until
  it is derived from real scoring.

## Locked decisions

Per the project's own rule: agree once, never change mid-hackathon.

- Results-table schema/column names — write as a committed schema file before either side
  builds against it.
- Demo stocks and fixed end date — already frozen in `sectors/demo-scope.json` /
  `docs/demo-scope.md`. Don't add symbols or move the date without re-freezing that file.
- API credit quota — confirm before designing the batch cadence; changes the whole
  ingestion design if tight.
- Hand-written sample `serve_alert` JSON (`tests/fixtures/serve_alert*.json`) is the
  frontend's contract until real scored output replaces it — keep it in sync with
  `docs/serve-contract.md` if the contract shape changes. `1.0.0-draft.1` itself is
  never edited in place (its fixture test asserts exact key sets); new fields go into
  a new `contract_version` such as `1.1.0-draft.1`, documented and fixtured alongside
  it, per `docs/decision-log.md`.

## Compliance rules

- Decision support only. No automated trading, no order placement, no broker connection.
- Every screen must show: data date, reporting period, alert confidence with its drivers,
  excluded comparison candidates with reasons, and a visible "not financial advice" notice.
- "Hold / Watch / Plan Swap" actions record user intent only — never an order.
- Never describe a broker cohort as "institutions" doing something — a brokerage labeled
  institutional also serves retail clients. Say "distribution pressure" and show coverage
  percentages honestly.

## Commands

```powershell
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python -m sectors registry --snapshot <dir> --db data/demo.sqlite3
python -m sectors qualify-day --observation <dir> --registry-db data/sectors.sqlite3 --report <path>
python -m sectors ingest-prices --live     # 10 API credits: 1 per demo symbol
python -m sectors publish                  # upsert results into Supabase
```

See `README.md` for full offline replay, caching, and live-fetch instructions.
