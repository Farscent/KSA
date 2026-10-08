"use client";

/**
 * Distributes the batch results fetched once on the server to the client
 * components that need them.
 *
 * `lib/data/source.ts`'s accessors are synchronous and are called from client
 * components, so the Supabase-backed outputs cannot simply become async there.
 * Instead the server layout awaits them and hands them down through this
 * context. Components read positions and price history from here; everything
 * still backed by fixtures continues to come from `source.ts` directly.
 */
import { createContext, useContext, useMemo } from "react";
import type {
  ServeComponentsRecord,
  ServeFlowSeriesRecord,
  ServePositionRecord,
  ServePriceHistoryRecord,
  ServeRunRecord,
} from "@/lib/contract/types";
import type { AgentRunRow } from "@/lib/data/agentRuns";
import type { PortfolioRunRow } from "@/lib/data/portfolioRuns";

interface ResultsContextValue {
  positions: ServePositionRecord[];
  priceHistory: ServePriceHistoryRecord[];
  /** Null before the first batch run has landed — render that, never a guess. */
  run: ServeRunRecord | null;
  /** Latest saved Run Analyst report per held symbol; absent means "not run yet". */
  agentRuns: Map<string, AgentRunRow>;
  /** Latest saved portfolio-wide summary, or null if Run Analyst has never
   * produced one. */
  portfolioRun: PortfolioRunRow | null;
  /**
   * Real Supabase-scored components where `sectors/scoring.py` has run, else
   * the fixture-backed example for the two symbols that still have one — the
   * merge already happened server-side in the layout, so this map is the
   * single source components should read.
   */
  components: Map<string, ServeComponentsRecord>;
  flowSeries: Map<string, ServeFlowSeriesRecord[]>;
  positionOf: (symbol: string) => ServePositionRecord | undefined;
  historyOf: (symbol: string) => ServePriceHistoryRecord | undefined;
  agentRunOf: (symbol: string) => AgentRunRow | undefined;
  componentsOf: (symbol: string) => ServeComponentsRecord | undefined;
  flowSeriesOf: (symbol: string) => ServeFlowSeriesRecord[];
}

const ResultsContext = createContext<ResultsContextValue | null>(null);

export function ResultsProvider({
  positions,
  priceHistory,
  run,
  agentRuns,
  portfolioRun,
  components,
  flowSeries,
  children,
}: {
  positions: ServePositionRecord[];
  priceHistory: ServePriceHistoryRecord[];
  run: ServeRunRecord | null;
  agentRuns: Map<string, AgentRunRow>;
  portfolioRun: PortfolioRunRow | null;
  components: Map<string, ServeComponentsRecord>;
  flowSeries: Map<string, ServeFlowSeriesRecord[]>;
  children: React.ReactNode;
}) {
  const value = useMemo<ResultsContextValue>(() => {
    const byPosition = new Map(positions.map((p) => [p.symbol, p]));
    const byHistory = new Map(priceHistory.map((h) => [h.symbol, h]));
    return {
      positions,
      priceHistory,
      run,
      agentRuns,
      portfolioRun,
      components,
      flowSeries,
      positionOf: (symbol) => byPosition.get(symbol),
      historyOf: (symbol) => byHistory.get(symbol),
      agentRunOf: (symbol) => agentRuns.get(symbol),
      componentsOf: (symbol) => components.get(symbol),
      flowSeriesOf: (symbol) => flowSeries.get(symbol) ?? [],
    };
  }, [positions, priceHistory, run, agentRuns, portfolioRun, components, flowSeries]);

  return <ResultsContext.Provider value={value}>{children}</ResultsContext.Provider>;
}

export function useResults(): ResultsContextValue {
  const ctx = useContext(ResultsContext);
  if (!ctx) throw new Error("useResults must be used within a ResultsProvider");
  return ctx;
}

export function usePositions(): ServePositionRecord[] {
  return useResults().positions;
}

export function usePosition(symbol: string): ServePositionRecord | undefined {
  return useResults().positionOf(symbol);
}

export function useAgentRun(symbol: string): AgentRunRow | undefined {
  return useResults().agentRunOf(symbol);
}

export function usePortfolioRun(): PortfolioRunRow | null {
  return useResults().portfolioRun;
}

export function useComponents(symbol: string): ServeComponentsRecord | undefined {
  return useResults().componentsOf(symbol);
}

export function useFlowSeries(symbol: string): ServeFlowSeriesRecord[] {
  return useResults().flowSeriesOf(symbol);
}
