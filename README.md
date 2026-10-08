# KSA Sectors

**KSA Sectors** is a portfolio review engine for IDX stocks. You enter your holdings and get
back evidence of what changed underneath each position: three structural measures of broker
selling scored against the stock's own baseline, comparable peers (or an honest "none
qualify"), and a plain-language report grounded only in numbers the system computed.

Broker trading is zero-sum: total buys always equal total sells. So "institutions are selling
while retail is buying" is arithmetic, not a finding. What carries information is the *shape*
of the selling, which is what this project measures.

This is a real, working build on live Sectors data, not a mockup. All ten demo symbols are
scored from `/v2/broker-summary/` over a frozen 61-session window.

Sectors Hackathon 2026, **Track 03: Market Intelligence**.

## Live demo

| | |
| --- | --- |
| **App** | <https://ksa-syuramoons-projects.vercel.app/> |
| **Demo video** | _add before submission_ |
| **Demo universe** | BBCA, BBRI, BMRI, BBNI, TLKM, ASII, ICBP, INDF, ANTM, MDKA, frozen at 2026-09-09 ([`docs/demo-scope.md`](docs/demo-scope.md)) |

## Track qualification

| Requirement | How this repo meets it |
| --- | --- |
| Produces **derived insight**, not the data itself | Concentration, breadth, persistence and coverage are computed from raw broker rows against each symbol's own baseline ([`sectors/scoring.py`](sectors/scoring.py)). None of the four exists in any Sectors response. |
| Anomaly detection | Each component carries its own baseline and band, and a symbol is flagged per component that crosses its own threshold ([`web/lib/flowStatus.ts`](web/lib/flowStatus.ts)). |
| Comparative analysis | Fundamentals, valuation and balance-sheet rows are compared to subsector peers, and the Peers tab lists every excluded candidate with its reason ([`web/lib/agent/peerScreen.ts`](web/lib/agent/peerScreen.ts)). |
| Synthesized research output | Run Analyst writes a sectioned per-symbol report and a portfolio-wide summary from already-computed figures ([`web/lib/llm/report.ts`](web/lib/llm/report.ts), [`web/lib/agent/portfolio.ts`](web/lib/agent/portfolio.ts)). |
| Sectors REST API as a core data source | Broker summary, daily close, company and subsector reports, quarterly financials, news, filings and corporate actions. See [`AGENTS.md`](AGENTS.md) for verified paths and credit costs. |
| No automated trade execution | Hold / Watch / Plan Swap record user intent only. There is no broker connection and no order placement. |

AI is optional on this track. Here the scoring is deterministic and the model only narrates:
it reads finished rows and its text is rejected if it states a number that is not in them
([`web/lib/llm/grounding.ts`](web/lib/llm/grounding.ts)).

## What it measures

| Component | Question it answers | Measure |
| --- | --- | --- |
| **Concentration** | Is selling coming from a few brokers or spread wide? | CR3: top-3 broker share of sell value, against its own baseline share |
| **Breadth** | How many brokers changed side? | Share and count of brokers whose net side flipped |
| **Persistence** | One-day blip or multi-day pattern? | Trailing-window direction match |
| **Coverage** | Can this be measured at all? | Share of sell value from a classifiable broker |

The three components are reported **separately, never collapsed into one score**. A single
number would hide which component moved and invite reading it as a buy/sell signal. Coverage
is always shown alongside them so "not flagged" and "not measurable" stay distinguishable.

## Architecture

```
Sectors API
     |
     |  Python batch (sectors/)
     v
Ingestion --> raw archive (data/, checksummed, replayable offline)
                    |
                    v
     Scoring: concentration / breadth / persistence / coverage
     deterministic, no combined score, no ML
                    |
                    v
     Supabase (Postgres, finished results only)
                    |
                    v
┌───────────────────────────────────────────────────────┐
│  Next.js app (web/)                                    │
│  Overview · /[symbol] · /[symbol]/details · Peers      │
│  /history · /holdings                                  │
│                                                        │
│  Run Analyst  (POST /api/analyst, SSE step log)        │
│    1. per-company research from Sectors                │
│       (server only, cache-first, credit-metered)       │
│    2. deterministic metrics and fact tables in code    │
│    3. LLM narrates finished rows, grounding-checked    │
│    4. portfolio-wide summary, zero extra credits       │
└───────────────────────────────────────────────────────┘
```

Two rules keep this honest:

1. **The browser never calls the Sectors API.** Broker-flow ingestion stays in the Python
   batch. The Next server may call Sectors for per-company research, but only through the
   cache-first, credit-metered wrapper in [`web/lib/sectors/cache.ts`](web/lib/sectors/cache.ts).
2. **The LLM never sees raw data and never does math.** It receives a package of computed
   numbers and writes sentences. A figure that is not in the package cannot be stated.

## Review flow

1. **Enter holdings**: symbol, lots and average price, stored per user in Supabase with RLS.
2. **Read the overview**: each holding shows `Not reviewed`, `Outdated`, the components that
   crossed their own threshold, or `No threshold crossed`.
3. **Run Analyst**: research steps stream live. A cold run costs about 11 Sectors credits
   per symbol and a repeated run costs 0.
4. **Read the symbol page**: the finding, the three components side by side, up to three
   standouts, price chart and key stats. Full sections are on `/[symbol]/details`.
5. **Check peers**: comparable alternatives, or "no comparable alternative qualified" with
   every exclusion and its reason.
6. **Record intent**: Hold, Watch or Plan Swap. Never an order.
7. **Revisit**: past runs are read-only under `/history`, rendered from what each run saved.

## Setup

Python 3.10+ for the batch, Node with pnpm for the app.

```bash
# Engine: tests and offline replay need no network or key
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v

# Live ingestion (needs SECTORS_API_KEY; about 80 credits for the full demo universe)
python -m sectors registry --live --cache data/registry-cache --db data/sectors.sqlite3
python -m sectors ingest-prices --live
python -m sectors ingest-flow --live
python -m sectors score-flow
python -m sectors publish && python -m sectors publish-flow

# App
cd web
pnpm install
pnpm dev          # http://localhost:3000
pnpm test
```

Apply [`supabase/migrations/`](supabase/migrations) to your Supabase project first, then set:

| Variable | Where | Notes |
| --- | --- | --- |
| `SECTORS_API_KEY` | shell, `web/.env.local` | Server-side only |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | shell | Python batch only. Never under `web/` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `web/.env.local` | Browser-safe, RLS applies |
| `OPENROUTER_API_KEY` | `web/.env.local` | Run Analyst narration |
| `TAVILY_API_KEY` | `web/.env.local` | Optional. Macro headlines stay `UNAVAILABLE` without it |
| `SECTORS_RUN_CREDIT_CEILING` | `web/.env.local` | Optional, default 25 credits per symbol per run |

Step-by-step replay, caching and live-fetch instructions are in [`RUNBOOK.md`](RUNBOOK.md).

## What's real vs. fixture

| | Status |
| --- | --- |
| Broker-flow ingestion and scoring | **Real**: 10 symbols x 61 sessions from `/v2/broker-summary/`, `MEASURED` rows in Supabase |
| Daily close, portfolio valuation, price chart | **Real**: end-of-day closes from `/v2/daily/`. Close only, not live |
| Per-company research and analyst report | **Real**: live Sectors data, cached, with a provenance ledger per run |
| Peers tab | **Real**: built from the peers a Run Analyst pass saved. Not yet a batch output |
| Macro and policy headlines | **Real** with a Tavily key: title, publisher, date and link only, shown as timing context, never as a cause |
| `serve_alert` / `serve_alert_evidence` | Fixture only. Nothing in the app reads them for status |
| `serve_narrative` contract output | Fixture only. Run Analyst's report is a separate saved path |
| Baseline | Each symbol's own history **within the ingested window**, not a longer external history |
| External completeness of broker data | Unproven. BBCA / 2026-09-09 is accepted as operationally complete only ([`docs/daily-qualification.md`](docs/daily-qualification.md)) |

Not the product: no price prediction, no trading bot, no causal claims about news or filings.
Decision support only, not financial advice.

## Repo layout

| Path | Role |
| --- | --- |
| [`sectors/`](sectors) | Python engine: registry and SCD2 `dim_broker`, price and broker-flow ingestion, scoring, Supabase publication |
| [`web/`](web) | Next.js app: holdings, overview, symbol pages, Run Analyst, history |
| [`supabase/migrations/`](supabase/migrations) | Results-table schema, the only boundary between engine and app |
| [`tests/`](tests) | Python tests and `serve_*` contract fixtures |
| [`docs/`](docs) | Contracts, decisions, metric definitions, verification records |

## More docs

- [`AGENTS.md`](AGENTS.md): ownership, hard rules, and the Sectors API billing and path tables
- [`RUNBOOK.md`](RUNBOOK.md): offline replay, cache reuse, live fetch, storage contract, credits
- [`docs/status.md`](docs/status.md): milestone checklist
- [`docs/decision-log.md`](docs/decision-log.md): why each design choice was made
- [`docs/metric-note.md`](docs/metric-note.md): metric definitions
- [`docs/serve-contract.md`](docs/serve-contract.md), [`1.1`](docs/serve-contract-1.1.md), [`1.2`](docs/serve-contract-1.2.md): versioned output contracts
- [`docs/results-schema.md`](docs/results-schema.md): Supabase results tables
- [`docs/verification.md`](docs/verification.md), [`docs/daily-qualification.md`](docs/daily-qualification.md), [`docs/completeness-checklist.md`](docs/completeness-checklist.md): what was verified and its limits
- [`docs/third-party-notices.md`](docs/third-party-notices.md): open-source references
