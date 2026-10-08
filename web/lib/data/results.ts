/**
 * Server-only reads of the Supabase results tables.
 *
 * This is the other half of the seam `lib/data/source.ts` describes: outputs
 * the Python batch actually produces are read from here, and the ones it does
 * not produce yet stay on fixtures there. Rows come back validated by the same
 * contract guards the fixtures are held to, so a batch that writes something
 * the contract forbids fails here rather than rendering a wrong number.
 *
 * Per AGENTS.md this module is reads-only, and never calls the Sectors API —
 * every external request happens in the scheduled Python batch.
 *
 * Server-only: `lib/supabase/server.ts` reads `next/headers`, which cannot
 * resolve in a client component, so importing this from one fails at build.
 */
import { createClient } from "@/lib/supabase/server";
import { assertComponents, assertFlowSeries, assertPosition, assertPriceHistory, ContractViolation } from "@/lib/contract/guards";
import type {
  Cohort,
  ComponentsScoringStatus,
  Completeness,
  ComponentBasis,
  FlowPoint,
  PricePoint,
  ServeComponentsRecord,
  ServeFlowSeriesRecord,
  ServePositionRecord,
  ServePriceHistoryRecord,
  ServeRunRecord,
  ValueStatus,
} from "@/lib/contract/types";

/** A row of serve_price_history as stored: one symbol-date, not a nested series. */
interface PriceHistoryRow {
  symbol: string;
  trade_date: string;
  close: number;
  volume: number | null;
}

/**
 * serve_run as stored. The contract's nested `window` object is flattened into
 * three columns (see docs/results-schema.md) because Postgres has no natural
 * nested-object column and `window` is a reserved word.
 */
interface RunRow {
  data_date: string;
  trade_date: string;
  window_sessions: number;
  window_start: string;
  window_end: string;
  symbols_requested: number;
  symbols_matched: number;
  cohorts_unavailable: number;
}

export async function fetchPositions(): Promise<ServePositionRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("serve_position")
    .select("symbol, name, sector, close, close_date, currency, value_status, reason_codes")
    .order("symbol");

  if (error) throw new Error(`serve_position read failed: ${error.message}`);

  const records = (data ?? []) as ServePositionRecord[];
  records.forEach(assertPosition);
  return records;
}

/**
 * Groups the stored symbol-date rows back into the contract's nested shape.
 *
 * A symbol with no rows at all is returned UNAVAILABLE rather than omitted, so
 * callers can tell "no price history" apart from "symbol not in the universe" —
 * the same distinction serve_position draws with PRICE_NOT_YET_INGESTED.
 */
export async function fetchPriceHistory(symbols: string[]): Promise<ServePriceHistoryRecord[]> {
  if (symbols.length === 0) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("serve_price_history")
    .select("symbol, trade_date, close, volume")
    .in("symbol", symbols)
    .order("trade_date");

  if (error) throw new Error(`serve_price_history read failed: ${error.message}`);

  const bySymbol = new Map<string, PricePoint[]>(symbols.map((symbol) => [symbol, []]));
  for (const row of (data ?? []) as PriceHistoryRow[]) {
    bySymbol.get(row.symbol)?.push({
      trade_date: row.trade_date,
      close: row.close,
      volume: row.volume,
    });
  }

  const records = Array.from(bySymbol.entries()).map(([symbol, points]) => ({
    symbol,
    points,
    currency: "IDR" as const,
    value_status: points.length > 0 ? ("AVAILABLE" as const) : ("UNAVAILABLE" as const),
    reason_codes: points.length > 0 ? [] : ["PRICE_NOT_YET_INGESTED"],
  }));
  records.forEach(assertPriceHistory);
  return records;
}

/**
 * The most recent batch run, or null before the first one has landed. Every
 * screen showing computed data must display this provenance, so a null here is
 * rendered as an explicit "no run yet" rather than silently omitted.
 */
export async function fetchRun(): Promise<ServeRunRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("serve_run")
    .select(
      "data_date, trade_date, window_sessions, window_start, window_end, " +
        "symbols_requested, symbols_matched, cohorts_unavailable"
    )
    .order("data_date", { ascending: false })
    .limit(1)
    .returns<RunRow[]>();

  if (error) throw new Error(`serve_run read failed: ${error.message}`);

  const row = data?.[0];
  if (!row) return null;
  if (row.window_sessions <= 0) {
    throw new ContractViolation("serve_run window_sessions must be positive");
  }
  if (row.symbols_matched > row.symbols_requested) {
    throw new ContractViolation("serve_run symbols_matched cannot exceed symbols_requested");
  }
  return {
    data_date: row.data_date,
    trade_date: row.trade_date,
    window: {
      sessions: row.window_sessions,
      start: row.window_start,
      end: row.window_end,
    },
    symbols_requested: row.symbols_requested,
    symbols_matched: row.symbols_matched,
    cohorts_unavailable: row.cohorts_unavailable,
  };
}

/** serve_components as stored: each block's fields flattened with a prefix. */
interface ComponentsRow {
  symbol: string;
  trade_date: string;
  scoring_status: ComponentsScoringStatus;
  concentration_basis: ComponentBasis;
  concentration_value_status: ValueStatus;
  concentration_reason_codes: string[];
  concentration_top_n: number | null;
  concentration_share: number | null;
  concentration_baseline_share: number | null;
  concentration_band: number | null;
  concentration_band_count: number | null;
  breadth_basis: ComponentBasis;
  breadth_value_status: ValueStatus;
  breadth_reason_codes: string[];
  breadth_changed: number | null;
  breadth_active: number | null;
  breadth_share: number | null;
  breadth_baseline_share: number | null;
  persistence_basis: ComponentBasis;
  persistence_value_status: ValueStatus;
  persistence_reason_codes: string[];
  persistence_same_direction: number | null;
  persistence_of_sessions: number | null;
  persistence_longest_run: number | null;
  persistence_session_flags: boolean[] | null;
  coverage_basis: ComponentBasis;
  coverage_value_status: ValueStatus;
  coverage_reason_codes: string[];
  coverage_matched_share: number | null;
  coverage_cohorts_available: number | null;
  coverage_cohorts_total: number | null;
  coverage_completeness: Completeness | null;
}

const COMPONENTS_COLUMNS =
  "symbol, trade_date, scoring_status, " +
  "concentration_basis, concentration_value_status, concentration_reason_codes, " +
  "concentration_top_n, concentration_share, concentration_baseline_share, " +
  "concentration_band, concentration_band_count, " +
  "breadth_basis, breadth_value_status, breadth_reason_codes, " +
  "breadth_changed, breadth_active, breadth_share, breadth_baseline_share, " +
  "persistence_basis, persistence_value_status, persistence_reason_codes, " +
  "persistence_same_direction, persistence_of_sessions, persistence_longest_run, persistence_session_flags, " +
  "coverage_basis, coverage_value_status, coverage_reason_codes, " +
  "coverage_matched_share, coverage_cohorts_available, coverage_cohorts_total, coverage_completeness";

function nestComponentsRow(row: ComponentsRow): ServeComponentsRecord {
  return {
    symbol: row.symbol,
    trade_date: row.trade_date,
    scoring_status: row.scoring_status,
    concentration: {
      basis: row.concentration_basis,
      value_status: row.concentration_value_status,
      reason_codes: row.concentration_reason_codes,
      top_n: row.concentration_top_n,
      share: row.concentration_share,
      baseline_share: row.concentration_baseline_share,
      band: row.concentration_band,
      band_count: row.concentration_band_count,
    },
    breadth: {
      basis: row.breadth_basis,
      value_status: row.breadth_value_status,
      reason_codes: row.breadth_reason_codes,
      changed: row.breadth_changed,
      active: row.breadth_active,
      share: row.breadth_share,
      baseline_share: row.breadth_baseline_share,
    },
    persistence: {
      basis: row.persistence_basis,
      value_status: row.persistence_value_status,
      reason_codes: row.persistence_reason_codes,
      same_direction: row.persistence_same_direction,
      of_sessions: row.persistence_of_sessions,
      longest_run: row.persistence_longest_run,
      session_flags: row.persistence_session_flags,
    },
    coverage: {
      basis: row.coverage_basis,
      value_status: row.coverage_value_status,
      reason_codes: row.coverage_reason_codes,
      matched_share: row.coverage_matched_share,
      cohorts_available: row.coverage_cohorts_available,
      cohorts_total: row.coverage_cohorts_total,
      completeness: row.coverage_completeness,
    },
  };
}

/**
 * Real scored components, one row per symbol that `sectors/scoring.py` has
 * actually measured. A symbol with no row is simply absent from the result —
 * callers (currently `lib/data/source.ts` fixture fallback, per-symbol) decide
 * what "not yet scored" means, this function never invents a placeholder row.
 */
export async function fetchComponents(symbols: string[]): Promise<ServeComponentsRecord[]> {
  if (symbols.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("serve_components")
    .select(COMPONENTS_COLUMNS)
    .in("symbol", symbols)
    .returns<ComponentsRow[]>();

  if (error) throw new Error(`serve_components read failed: ${error.message}`);

  const records = (data ?? []).map(nestComponentsRow);
  records.forEach(assertComponents);
  return records;
}

/** serve_flow_series as stored: points is jsonb, everything else is flat. */
interface FlowSeriesRow {
  symbol: string;
  cohort: Cohort;
  points: FlowPoint[];
  currency: "IDR";
  value_status: ValueStatus;
  reason_codes: string[];
}

export async function fetchFlowSeries(symbols: string[]): Promise<ServeFlowSeriesRecord[]> {
  if (symbols.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("serve_flow_series")
    .select("symbol, cohort, points, currency, value_status, reason_codes")
    .in("symbol", symbols)
    .returns<FlowSeriesRow[]>();

  if (error) throw new Error(`serve_flow_series read failed: ${error.message}`);

  const records = (data ?? []) as ServeFlowSeriesRecord[];
  records.forEach(assertFlowSeries);
  return records;
}
