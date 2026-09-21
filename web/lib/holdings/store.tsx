"use client";

import { createContext, useCallback, useContext, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import * as actions from "@/lib/holdings/actions";

export const HOLDINGS_CAP = 15;
export const SHARES_PER_LOT = 100;

export interface Holding {
  sym: string;
  lots: number;
  /** Average cost per share, whole IDR. Stored as `holdings.avg_price`. */
  avg: number;
}

export type IntentAction = "Hold" | "Watch" | "Plan swap";

export interface Intent {
  action: IntentAction;
  date: string;
}

interface HoldingsContextValue {
  holdings: Holding[];
  addHolding: (h: Holding) => Promise<actions.ActionResult>;
  updateHolding: (symbol: string, h: Holding) => Promise<actions.ActionResult>;
  deleteHolding: (symbol: string) => Promise<actions.ActionResult>;
  atCap: boolean;
  pending: boolean;
  intents: Record<string, Intent>;
  recordIntent: (symbol: string, action: IntentAction) => Promise<actions.ActionResult>;
}

const HoldingsContext = createContext<HoldingsContextValue | null>(null);

/**
 * Holdings live in Supabase, scoped to the signed-in user by row level
 * security. The server layout reads them and seeds this provider, so the first
 * paint already shows the real portfolio — there is no browser-storage copy and
 * no demo portfolio to fall back to.
 *
 * Mutations go through server actions, which revalidate the layout. Local state
 * is updated optimistically so the table responds immediately; a rejected write
 * rolls that back and returns the reason for the caller to surface.
 */
export function HoldingsProvider({
  initialHoldings,
  initialIntents,
  children,
}: {
  initialHoldings: Holding[];
  initialIntents: Record<string, Intent>;
  children: React.ReactNode;
}) {
  const [holdings, setHoldings] = useState<Holding[]>(initialHoldings);
  const [intents, setIntents] = useState<Record<string, Intent>>(initialIntents);
  const [serverState, setServerState] = useState({ initialHoldings, initialIntents });
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // When a refresh brings fresh server data, adopt it as the new truth. This is
  // React's documented adjust-state-during-render pattern rather than an
  // effect: without it, useState would keep the first render's rows forever and
  // a change made in another tab would never appear.
  if (serverState.initialHoldings !== initialHoldings || serverState.initialIntents !== initialIntents) {
    setServerState({ initialHoldings, initialIntents });
    setHoldings(initialHoldings);
    setIntents(initialIntents);
  }

  const commit = useCallback(
    async (optimistic: () => void, rollback: () => void, write: () => Promise<actions.ActionResult>) => {
      optimistic();
      const result = await write();
      if (!result.ok) {
        rollback();
        return result;
      }
      startTransition(() => router.refresh());
      return result;
    },
    [router]
  );

  const addHolding = useCallback(
    (h: Holding) => {
      const previous = holdings;
      return commit(
        () => setHoldings((prev) => [...prev, h]),
        () => setHoldings(previous),
        () => actions.addHolding(h)
      );
    },
    [commit, holdings]
  );

  const updateHolding = useCallback(
    (symbol: string, h: Holding) => {
      const previous = holdings;
      return commit(
        () => setHoldings((prev) => prev.map((row) => (row.sym === symbol ? h : row))),
        () => setHoldings(previous),
        () => actions.updateHolding(symbol, h)
      );
    },
    [commit, holdings]
  );

  const deleteHolding = useCallback(
    (symbol: string) => {
      const previous = holdings;
      return commit(
        () => setHoldings((prev) => prev.filter((row) => row.sym !== symbol)),
        () => setHoldings(previous),
        () => actions.deleteHolding(symbol)
      );
    },
    [commit, holdings]
  );

  const recordIntent = useCallback(
    (symbol: string, action: IntentAction) => {
      const previous = intents;
      const date = new Date().toISOString().slice(0, 10);
      return commit(
        () => setIntents((prev) => ({ ...prev, [symbol]: { action, date } })),
        () => setIntents(previous),
        () => actions.recordIntent(symbol, action)
      );
    },
    [commit, intents]
  );

  const value = useMemo<HoldingsContextValue>(
    () => ({
      holdings,
      addHolding,
      updateHolding,
      deleteHolding,
      atCap: holdings.length >= HOLDINGS_CAP,
      pending,
      intents,
      recordIntent,
    }),
    [holdings, addHolding, updateHolding, deleteHolding, pending, intents, recordIntent]
  );

  return <HoldingsContext.Provider value={value}>{children}</HoldingsContext.Provider>;
}

export function useHoldings(): HoldingsContextValue {
  const ctx = useContext(HoldingsContext);
  if (!ctx) throw new Error("useHoldings must be used within a HoldingsProvider");
  return ctx;
}
