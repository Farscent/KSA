# Milestone status

The milestone checklist for the engine and the app. The short "real vs. fixture" view is in
the [README](../README.md#whats-real-vs-fixture); `CLAUDE.md` carries the narrative version.

| Milestone                                     | Status                                      |
| --------------------------------------------- | ------------------------------------------- |
| Align on signal thesis: structure ≠ direction | In progress                                 |
| Broker registry foundation                    | Complete: capture, cache, replay, validation, and profiling |
| `dim_broker` SCD2                             | Complete                                    |
| BBCA one-day qualification                    | Complete and accepted for demo operational policy; external completeness unproven |
| Demo universe and fixed end date              | Frozen; [scope and initial lookback](demo-scope.md) |
| API credit grant                             | 1,000 hackathon team credits according to official competition rules, as supplied in the project decision |
| Endpoint credit consumption and rate limits   | Verified per-endpoint from `docs.sectors.app` (see `AGENTS.md`'s billing table); a live account balance is still unconfirmed |
| `serve_*` contract with Harfi                 | Under review: `1.0.0-draft.1`; not yet stable |
| `serve_alert.json` / `serve_alert_evidence.json` fixtures | Complete: hand-written synthetic contract examples; no actual scored output |
| Results-table schema committed                | Complete: `supabase/migrations/`, documented in [results schema](results-schema.md) |
| Daily close ingestion (10 symbols, 90-day window) | Complete: `python -m sectors ingest-prices`; 1 API credit per symbol |
| Publication to Supabase                       | Complete: `python -m sectors publish`; upserts, re-runnable |
| Multi-stock broker-flow ingestion             | Complete and **run live**: `python -m sectors ingest-flow --live` (`sectors/flow.py`), 70 credits, all 10 symbols x 61 sessions cached in `data/flow-cache/` |
| Scoring                                      | Complete and **run on live data**: `python -m sectors score-flow` (`sectors/scoring.py`) — concentration/breadth/persistence/coverage, reported separately, never combined |
| Publish broker-flow results                   | Complete: `python -m sectors publish-flow` → `serve_components` / `serve_flow_series` (`supabase/migrations/0004_flow_results.sql`); 10 + 40 real `MEASURED` rows live |
| Per-company research pipeline                 | Complete: cached, credit-metered server-side Sectors client (`web/lib/sectors/`), projections and metrics (`web/lib/research/`, `web/lib/agent/`), sectioned report (`web/lib/llm/report.ts`) |
| Readable analyst report                       | Complete: each section is a headline + a code-built fact table + at most three bullets; the model's text is rejected if it states a number not in the table (`web/lib/agent/display.ts`, `web/lib/llm/grounding.ts`). Adds Earnings quality and Balance sheet sections (banks handled separately) and an Evidence coverage card, at zero extra credits. See `docs/third-party-notices.md` |
| Summary-first symbol page                     | Complete: `/[symbol]` is a one-screen summary (finding, the three flow components side by side, up to three standouts) built in code from the saved report's rows; the full sections, coverage card and past-runs picker are on `/[symbol]/details` (`web/lib/agent/summary.ts`, `web/components/SummaryCard.tsx`) |
| Price header, chart and key stats             | Complete: last close, day change, close + volume chart (TradingView's open-source `lightweight-charts`) and a key-stats panel, all from already-ingested closes and the saved report; close only so no candlesticks, end-of-day not live, zero credits (`web/lib/price/overview.ts`, `web/components/PriceChart.tsx`, `web/components/KeyStats.tsx`) |
| Portfolio-wide summary                        | Complete: a second synthesis pass over the run's per-symbol packages at **zero extra credits** (`web/lib/agent/portfolio.ts`, `web/lib/llm/portfolioReport.ts`), saved to `portfolio_runs` (`supabase/migrations/0007`) and rendered on the dashboard itself — three independent concentration/breadth/persistence standout lists, never a combined score |
| Streaming research log                        | Complete: `POST /api/analyst` streams each research step over SSE as it finishes, plus a "Writing report" step; the dashboard log and per-stock button show it live (`web/app/api/analyst/route.ts`, `web/lib/agent/stream.ts`, `web/lib/agent/streamClient.ts`) |
| Connect application / Run Scan flow           | Partial: Run Analyst reads real scored components when present, falls back to the two-symbol fixture otherwise |
