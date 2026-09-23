-- Widen agent_runs from a flat 2-3 paragraph narration to the full sectioned
-- research report (web/lib/llm/report.ts, web/lib/agent/pipeline.ts).
--
-- Every column is nullable and `paragraphs` is retained, so rows written by
-- the previous single-call Run Analyst still render unchanged.
--
-- `package` is what the follow-up chat reads. Before this, askFollowUp rebuilt
-- its own package from fixtures, which meant a follow-up could cite figures
-- the saved report never showed. Storing the exact package the report was
-- written from closes that gap.

alter table public.agent_runs
  add column if not exists sections     jsonb,
  add column if not exists package      jsonb,
  add column if not exists provenance   jsonb,
  add column if not exists steps        jsonb,
  add column if not exists model        text,
  add column if not exists credits_used integer,
  add column if not exists duration_ms  integer;

comment on column public.agent_runs.sections is
  'Sectioned report: [{id, title, paragraphs[], grounded_in[], value_status, reason_codes[]}]. An UNAVAILABLE section carries no paragraphs rather than invented prose.';
comment on column public.agent_runs.package is
  'The exact ResearchPackage the report was written from. The follow-up chat is grounded in this, never in freshly fetched data.';
comment on column public.agent_runs.provenance is
  'Per-fetch ledger entries: [{endpoint, params, credits, cached, fetched_at}]. The report Sources list is rendered from this in code, not by the LLM.';
comment on column public.agent_runs.steps is
  'Step trace: [{id, label, status, detail, credits, duration_ms}]. Backs the visible research log.';
comment on column public.agent_runs.credits_used is
  'Sectors credits this run actually spent. A cached re-run reads 0.';
