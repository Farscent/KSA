-- Saved output of one portfolio-wide "Run Analyst" pass: a synthesis over the
-- per-symbol agent_runs a run already produced, at zero extra Sectors credits.
--
-- Same rule as agent_runs: the sectioned report is LLM narration over an
-- already-computed package (see web/lib/agent/portfolio.ts), and
-- concentration/breadth/persistence stay reported separately per CLAUDE.md —
-- this table holds no combined portfolio risk score.

create table if not exists public.portfolio_runs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  as_of        date not null,
  symbols      text[] not null,
  sections     jsonb not null,
  package      jsonb not null,
  provenance   jsonb,
  steps        jsonb,
  model        text,
  credits_used integer,
  duration_ms  integer,
  created_at   timestamptz not null default now()
);

create index if not exists portfolio_runs_user_created_idx
  on public.portfolio_runs (user_id, created_at desc);

comment on table public.portfolio_runs is
  'Saved portfolio-wide Run Analyst summaries: a synthesis over that run''s per-symbol agent_runs packages. Decision support only — never an order, never a combined severity score.';

alter table public.portfolio_runs enable row level security;

create policy "portfolio_runs selectable by owner"
  on public.portfolio_runs for select to authenticated using (auth.uid() = user_id);
create policy "portfolio_runs insertable by owner"
  on public.portfolio_runs for insert to authenticated with check (auth.uid() = user_id);
create policy "portfolio_runs updatable by owner"
  on public.portfolio_runs for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "portfolio_runs deletable by owner"
  on public.portfolio_runs for delete to authenticated using (auth.uid() = user_id);
