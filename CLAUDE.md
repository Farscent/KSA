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

1. **The frontend never calls the Sectors API directly.** All external API usage happens
   in the scheduled Python batch. This protects the credit budget and keeps the UI fast —
   the in-app "Run Scan" button re-runs scoring against already-downloaded data, no network
   call to Sectors.
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

**Not yet built:**
- Multi-stock, multi-day ingestion (currently single-stock/single-day only)
- The actual anomaly/severity scoring engine (concentration, breadth, persistence) that
  fills `1.1.0-draft.1`'s `serve_components` / `serve_flow_series` with real numbers
- Peer/sector comparison screener and scorecard (`serve_peer_screen`) with real data
- LLM narration layer (`serve_narrative`) — the frontend's Ask panel is currently
  keyword-matched over on-screen figures, not an LLM call
- Supabase results tables (frontend currently reads local fixtures, not Supabase)

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
```

See `README.md` for full offline replay, caching, and live-fetch instructions.
