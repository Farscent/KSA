-- Results tables: the single integration point between the Python batch and the
-- Next.js app (see AGENTS.md "Two owners, one contract").
--
-- Written ONLY by the scheduled Python batch using the service-role key, which
-- bypasses RLS. The app holds read-only SELECT grants. Column names mirror the
-- serve_* output contract (docs/serve-contract-1.1.md, docs/serve-contract-1.2.md)
-- field-for-field — renaming one here silently breaks the frontend's guards.

-- serve_position -------------------------------------------------------------
-- Grain: (symbol). Latest close per symbol for the frozen ten-symbol demo
-- universe. `close` is whole IDR, never scaled.
create table if not exists public.serve_position (
  symbol           text primary key,
  name             text not null check (length(btrim(name)) > 0),
  sector           text not null check (length(btrim(sector)) > 0),
  close            bigint check (close > 0),
  close_date       date,
  currency         text not null default 'IDR' check (currency = 'IDR'),
  value_status     text not null check (value_status in ('AVAILABLE', 'UNAVAILABLE')),
  reason_codes     text[] not null default '{}',
  contract_version text not null default '1.2.0-draft.1',
  data_kind        text not null check (data_kind in ('SYNTHETIC_EXAMPLE', 'MEASURED')),
  loaded_at        timestamptz not null default now(),

  -- An unavailable price must never arrive as 0, and an available one must
  -- never arrive without its date. Enforced here so a bad batch run fails at
  -- the write, not silently on screen.
  constraint serve_position_availability_consistent
    check ((value_status = 'AVAILABLE') = (close is not null and close_date is not null)),

  -- reason_codes is empty exactly when the price is available.
  constraint serve_position_reason_codes_consistent
    check ((value_status = 'AVAILABLE') = (cardinality(reason_codes) = 0))
);

comment on table public.serve_position is
  'Per-symbol reference data and latest close. Batch-written, app-readable. Contract: docs/serve-contract-1.2.md.';
comment on column public.serve_position.close is
  'Latest close in whole IDR. NULL when value_status is UNAVAILABLE — never render as 0.';

-- serve_price_history --------------------------------------------------------
-- Grain: (symbol, trade_date). The ~60-session daily close window that backs
-- the portfolio value series and the scoring engine's own baseline.
create table if not exists public.serve_price_history (
  symbol           text not null references public.serve_position (symbol) on delete cascade,
  trade_date       date not null,
  close            bigint not null check (close > 0),
  volume           bigint check (volume >= 0),
  currency         text not null default 'IDR' check (currency = 'IDR'),
  contract_version text not null default '1.2.0-draft.1',
  data_kind        text not null check (data_kind in ('SYNTHETIC_EXAMPLE', 'MEASURED')),
  loaded_at        timestamptz not null default now(),
  primary key (symbol, trade_date)
);

create index if not exists serve_price_history_trade_date_idx
  on public.serve_price_history (trade_date);

comment on table public.serve_price_history is
  'Daily close history per symbol over the ingested window. Batch-written, app-readable.';

-- serve_run ------------------------------------------------------------------
-- Grain: (data_date). One row per batch run — the provenance every screen
-- showing computed data must display (CLAUDE.md compliance rules).
-- The contract's nested `window` object is flattened into three columns here.
create table if not exists public.serve_run (
  data_date            date primary key,
  trade_date           date not null,
  window_sessions      integer not null check (window_sessions > 0),
  window_start         date not null,
  window_end           date not null,
  symbols_requested    integer not null check (symbols_requested >= 0),
  symbols_matched      integer not null check (symbols_matched >= 0),
  cohorts_unavailable  integer not null check (cohorts_unavailable >= 0),
  contract_version     text not null default '1.2.0-draft.1',
  loaded_at            timestamptz not null default now(),

  constraint serve_run_window_ordered check (window_start <= window_end),
  constraint serve_run_matched_within_requested check (symbols_matched <= symbols_requested)
);

comment on table public.serve_run is
  'One row per batch run: data date, reporting window, and coverage counts.';

-- Row level security ---------------------------------------------------------
-- Results are not user-scoped: any signed-in user reads the same rows. There is
-- deliberately no INSERT/UPDATE/DELETE policy — the batch writes with the
-- service-role key, so the app can never mutate results.
alter table public.serve_position      enable row level security;
alter table public.serve_price_history enable row level security;
alter table public.serve_run           enable row level security;

create policy "serve_position readable by authenticated"
  on public.serve_position for select to authenticated using (true);

create policy "serve_price_history readable by authenticated"
  on public.serve_price_history for select to authenticated using (true);

create policy "serve_run readable by authenticated"
  on public.serve_run for select to authenticated using (true);
