# KSA Sectors: web app

The Next.js app for the portfolio review engine. It reads finished results from Supabase and
runs the per-company research and narration pass ("Run Analyst") on the server. For what the
project is, see the [root README](../README.md).

## Run

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm test     # vitest
pnpm lint
```

`pnpm dev` and `pnpm build` first run `sync:fixtures`, which copies the contract fixtures from
`../tests/fixtures` into `fixtures/`.

Environment goes in `web/.env.local`. The variable table is in the
[root README](../README.md#setup). `SUPABASE_SERVICE_ROLE_KEY` never belongs here.

## Routes

| Route | What it shows |
| --- | --- |
| `/` | Portfolio overview, run status per holding, portfolio-wide summary |
| `/holdings` | Enter and edit holdings |
| `/[symbol]` | One-screen summary: finding, three flow components, price chart, key stats |
| `/[symbol]/details` | Full report sections, evidence coverage, past runs |
| `/[symbol]/peers` | Peer screen with every exclusion and its reason |
| `/history`, `/history/[runId]`, `/history/[runId]/[symbol]` | Read-only past runs |
| `POST /api/analyst` | Run Analyst, streamed as Server-Sent Events |

## Layout

| Path | Role |
| --- | --- |
| `lib/sectors/` | Server-side Sectors client, cache-first and credit-metered |
| `lib/research/`, `lib/agent/` | Projections, deterministic metrics, fact tables, pipeline |
| `lib/llm/` | Narration over finished rows, with grounding checks |
| `lib/data/` | Supabase reads for results and saved runs |
| `lib/flowStatus.ts`, `lib/verdict.ts` | Status chip and triage label from scored components |
| `components/` | UI |
| `tests/` | Vitest suites. `live.test.ts` is skipped unless `SECTORS_LIVE=1` |

This app runs on a Next.js version with breaking changes. Read [`AGENTS.md`](AGENTS.md)
before writing code here.
