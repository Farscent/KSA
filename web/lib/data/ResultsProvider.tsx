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
  ServePositionRecord,
  ServePriceHistoryRecord,
  ServeRunRecord,
} from "@/lib/contract/types";

interface ResultsContextValue {
  positions: ServePositionRecord[];
  priceHistory: ServePriceHistoryRecord[];
  /** Null before the first batch run has landed — render that, never a guess. */
  run: ServeRunRecord | null;
  positionOf: (symbol: string) => ServePositionRecord | undefined;
  historyOf: (symbol: string) => ServePriceHistoryRecord | undefined;
}

const ResultsContext = createContext<ResultsContextValue | null>(null);

export function ResultsProvider({
  positions,
  priceHistory,
  run,
  children,
}: {
  positions: ServePositionRecord[];
  priceHistory: ServePriceHistoryRecord[];
  run: ServeRunRecord | null;
  children: React.ReactNode;
}) {
  const value = useMemo<ResultsContextValue>(() => {
    const byPosition = new Map(positions.map((p) => [p.symbol, p]));
    const byHistory = new Map(priceHistory.map((h) => [h.symbol, h]));
    return {
      positions,
      priceHistory,
      run,
      positionOf: (symbol) => byPosition.get(symbol),
      historyOf: (symbol) => byHistory.get(symbol),
    };
  }, [positions, priceHistory, run]);

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
