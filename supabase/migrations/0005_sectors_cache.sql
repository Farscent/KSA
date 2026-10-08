-- Cache of Sectors API responses fetched by the Next server during a Run
-- Analyst pass (web/lib/sectors/cache.ts).
--
-- Why this table exists: CLAUDE.md's architecture rule 1 used to read "the
-- frontend never calls the Sectors API". The research pipeline amends it to
-- "the browser never calls Sectors; the Next server may, through a cached,
-- credit-metered client with a hard per-run ceiling". This table is the
-- "cached" half of that promise — a repeated run over the same symbol costs
-- zero credits, which is what keeps a live demo affordable against a
-- 1,000-credit grant.
--
-- Bulk historical ingestion still belongs to the Python batch. Nothing here
-- replaces sectors/flow.py or sectors/prices.py.

create table if not exists public.sectors_cache (
  id          bigserial primary key,
  endpoint    text not null,
  params_hash text not null,
  params      jsonb not null,
  payload     jsonb not null,
  -- Credits this response actually cost when it was first fetched, from
  -- AGENTS.md's verified per-endpoint table. A cache hit re-serves the same
  -- payload for 0, so this is the "what we already paid" record, not a
  -- running total.
  credits     integer not null default 0 check (credits >= 0),
  fetched_at  timestamptz not null default now(),

  unique (endpoint, params_hash)
);

comment on table public.sectors_cache is
  'Sectors API responses cached by the Next server. Public market data only — never user data. Keyed by (endpoint, params_hash).';
comment on column public.sectors_cache.credits is
  'Credits the original fetch cost, per AGENTS.md''s verified per-endpoint billing table. Cache hits cost 0.';

create index if not exists sectors_cache_fetched_at_idx on public.sectors_cache (fetched_at desc);

-- Row level security -------------------------------------------------------
-- Deliberate divergence from every other table here, which is select-only.
-- The Next server writes this cache using the *caller's* session (the anon
-- key plus their cookie, see web/lib/supabase/server.ts), so a signed-in user
-- must be able to insert and update. The table holds public market data and
-- carries no user_id, so the exposure is cache poisoning by an authenticated
-- user, not disclosure of anyone's holdings.
--
-- The upgrade path, if that ever matters, is a SUPABASE_SERVICE_ROLE_KEY
-- service client for writes and select-only policies here. That is
-- deliberately not done now: it would put a key that bypasses every RLS
-- policy in this database into the web app's environment.
alter table public.sectors_cache enable row level security;

create policy "sectors_cache readable by authenticated"
  on public.sectors_cache for select to authenticated using (true);

create policy "sectors_cache writable by authenticated"
  on public.sectors_cache for insert to authenticated with check (true);

create policy "sectors_cache refreshable by authenticated"
  on public.sectors_cache for update to authenticated using (true) with check (true);
