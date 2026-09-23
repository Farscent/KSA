-- Saved output of a "Run Analyst" agent run: one row per user/symbol/trade_date.
--
-- The verdict is a triage label computed deterministically in the app from
-- serve_components (see web/lib/verdict.ts) — never a combined severity score,
-- per CLAUDE.md. paragraphs/grounded_in are LLM narration over that same
-- already-computed package; the LLM never sees raw data and never does math.

create table if not exists public.agent_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  symbol      text not null references public.serve_position (symbol) on delete cascade,
  trade_date  date not null,
  verdict     text not null check (verdict in ('Healthy', 'Watch', 'Rebalance')),
  paragraphs  jsonb not null,
  grounded_in jsonb not null,
  created_at  timestamptz not null default now(),
  unique (user_id, symbol, trade_date)
);

create index if not exists agent_runs_user_id_idx on public.agent_runs (user_id);

comment on table public.agent_runs is
  'Saved Run Analyst reports: a deterministic verdict plus LLM narration grounded in that run''s serve_components/serve_alert_evidence/serve_peer_screen package. Decision support only — never an order.';
comment on column public.agent_runs.verdict is
  'Healthy / Watch / Rebalance — a triage label over the separate components, not a combined severity score.';

alter table public.agent_runs enable row level security;

create policy "agent_runs selectable by owner"
  on public.agent_runs for select to authenticated using (auth.uid() = user_id);
create policy "agent_runs insertable by owner"
  on public.agent_runs for insert to authenticated with check (auth.uid() = user_id);
create policy "agent_runs updatable by owner"
  on public.agent_runs for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "agent_runs deletable by owner"
  on public.agent_runs for delete to authenticated using (auth.uid() = user_id);
