-- Real broker-flow scoring results: serve_components and serve_flow_series.
-- Written by `sectors/scoring.py` via `sectors/publish.py` (RESULTS_TABLES).
-- Column names mirror docs/serve-contract-1.1.md field-for-field, with each
-- record's four nested blocks (concentration/breadth/persistence/coverage)
-- flattened with a block-name prefix, the same pattern serve_run already uses
-- for its `window` object.
--
-- Per CLAUDE.md: concentration, breadth and persistence are reported
-- separately here — there is no combined-score column, and there must never
-- be one added to this table.

-- serve_components -------------------------------------------------------
-- Grain: (symbol, trade_date).
create table if not exists public.serve_components (
  symbol                     text not null references public.serve_position (symbol) on delete cascade,
  trade_date                 date not null,
  scoring_status             text not null default 'SCORED',

  concentration_basis        text not null check (concentration_basis in ('EXAMPLE_VALUE', 'MEASURED')),
  concentration_value_status text not null check (concentration_value_status in ('AVAILABLE', 'UNAVAILABLE')),
  concentration_reason_codes text[] not null default '{}',
  concentration_top_n        integer,
  concentration_share        double precision,
  concentration_baseline_share double precision,
  concentration_band         integer,
  concentration_band_count   integer,

  breadth_basis               text not null check (breadth_basis in ('EXAMPLE_VALUE', 'MEASURED')),
  breadth_value_status         text not null check (breadth_value_status in ('AVAILABLE', 'UNAVAILABLE')),
  breadth_reason_codes         text[] not null default '{}',
  breadth_changed               integer,
  breadth_active                 integer,
  breadth_share                   double precision,
  breadth_baseline_share           double precision,

  persistence_basis                 text not null check (persistence_basis in ('EXAMPLE_VALUE', 'MEASURED')),
  persistence_value_status           text not null check (persistence_value_status in ('AVAILABLE', 'UNAVAILABLE')),
  persistence_reason_codes           text[] not null default '{}',
  persistence_same_direction          integer,
  persistence_of_sessions              integer,
  persistence_longest_run               integer,
  persistence_session_flags              boolean[],

  coverage_basis                          text not null check (coverage_basis in ('EXAMPLE_VALUE', 'MEASURED')),
  coverage_value_status                    text not null check (coverage_value_status in ('AVAILABLE', 'UNAVAILABLE')),
  coverage_reason_codes                    text[] not null default '{}',
  coverage_matched_share                    double precision,
  coverage_cohorts_available                integer,
  coverage_cohorts_total                     integer,
  coverage_completeness                       text check (coverage_completeness in ('FULL', 'PARTIAL', 'UNKNOWN')),

  contract_version           text not null default '1.1.0-draft.1',
  loaded_at                  timestamptz not null default now(),
  primary key (symbol, trade_date)
);

comment on table public.serve_components is
  'Real concentration/breadth/persistence/coverage scoring, one row per (symbol, trade_date). No combined score column — see CLAUDE.md.';

-- serve_flow_series --------------------------------------------------------
-- Grain: (symbol, cohort). Cumulative net-value series across the window.
create table if not exists public.serve_flow_series (
  symbol           text not null references public.serve_position (symbol) on delete cascade,
  cohort           text not null check (cohort in ('institutional', 'retail', 'mixed', 'unknown')),
  points           jsonb not null default '[]'::jsonb,
  currency         text not null default 'IDR' check (currency = 'IDR'),
  value_status     text not null check (value_status in ('AVAILABLE', 'UNAVAILABLE')),
  reason_codes     text[] not null default '{}',
  contract_version text not null default '1.1.0-draft.1',
  loaded_at        timestamptz not null default now(),
  primary key (symbol, cohort),

  -- An UNAVAILABLE cohort must arrive with an empty points array, never a
  -- fabricated flat-zero line standing in for missing data.
  constraint serve_flow_series_unavailable_is_empty
    check (value_status = 'AVAILABLE' or points = '[]'::jsonb)
);

comment on table public.serve_flow_series is
  'Cumulative net broker-flow value per (symbol, cohort). points is [{trade_date, cumulative_net_value}, ...].';

-- Row level security -------------------------------------------------------
alter table public.serve_components  enable row level security;
alter table public.serve_flow_series enable row level security;

create policy "serve_components readable by authenticated"
  on public.serve_components for select to authenticated using (true);

create policy "serve_flow_series readable by authenticated"
  on public.serve_flow_series for select to authenticated using (true);
