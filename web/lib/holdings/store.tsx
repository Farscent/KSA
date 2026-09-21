"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getPositions } from "@/lib/data/source";

export const HOLDINGS_CAP = 15;
export const SHARES_PER_LOT = 100;
const STORAGE_KEY = "sectors-review:holdings:v1";
const INTENTS_KEY = "sectors-review:intents:v1";

export interface Holding {
  sym: string;
  lots: number;
  avg: number;
}

export type IntentAction = "Hold" | "Watch" | "Plan swap";

export interface Intent {
  action: IntentAction;
  date: string;
}

interface HoldingsContextValue {
  holdings: Holding[];
  addHolding: (h: Holding) => void;
  updateHolding: (index: number, h: Holding) => void;
  deleteHolding: (index: number) => void;
  atCap: boolean;
  intents: Record<string, Intent>;
  recordIntent: (symbol: string, action: IntentAction) => void;
}

const HoldingsContext = createContext<HoldingsContextValue | null>(null);

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const DEFAULT_HOLDINGS: Holding[] = [
  { sym: "BBCA", lots: 40, avg: 9150 },
  { sym: "BBRI", lots: 120, avg: 4480 },
  { sym: "BBNI", lots: 80, avg: 5225 },
  { sym: "ANTM", lots: 150, avg: 1780 },
  { sym: "TLKM", lots: 200, avg: 3070 },
  { sym: "ASII", lots: 90, avg: 5075 },
  { sym: "ICBP", lots: 70, avg: 10850 },
  { sym: "INDF", lots: 110, avg: 6250 },
];

interface HydratedState {
  holdings: Holding[];
  intents: Record<string, Intent>;
  hydrated: boolean;
}

export function HoldingsProvider({ children }: { children: React.ReactNode }) {
  const [{ holdings, intents, hydrated }, setState] = useState<HydratedState>({
    holdings: DEFAULT_HOLDINGS,
    intents: {},
    hydrated: false,
  });

  // Reads localStorage once on mount (unavailable during server render), then
  // renders the persisted holdings/intents client-side. This is the standard
  // hydrate-after-mount pattern for browser-only storage — there is no
  // alternative that avoids a server/client render mismatch, so the
  // set-state-in-effect rule is deliberately overridden here, not skipped by
  // oversight.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    setState({
      holdings: loadFromStorage(STORAGE_KEY, DEFAULT_HOLDINGS),
      intents: loadFromStorage(INTENTS_KEY, {}),
      hydrated: true,
    });
  }, []);

  const setHoldings = useCallback((updater: (prev: Holding[]) => Holding[]) => {
    setState((s) => ({ ...s, holdings: updater(s.holdings) }));
  }, []);

  const setIntents = useCallback((updater: (prev: Record<string, Intent>) => Record<string, Intent>) => {
    setState((s) => ({ ...s, intents: updater(s.intents) }));
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings));
  }, [holdings, hydrated]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    window.localStorage.setItem(INTENTS_KEY, JSON.stringify(intents));
  }, [intents, hydrated]);

  const knownSymbols = useMemo(() => new Set(getPositions().map((p) => p.symbol)), []);

  const addHolding = useCallback(
    (h: Holding) => {
      setHoldings((prev) => {
        if (prev.length >= HOLDINGS_CAP) return prev;
        if (prev.some((r) => r.sym === h.sym)) return prev;
        if (!knownSymbols.has(h.sym)) return prev;
        return [...prev, h];
      });
    },
    [knownSymbols, setHoldings]
  );

  const updateHolding = useCallback(
    (index: number, h: Holding) => {
      setHoldings((prev) => {
        const next = [...prev];
        next[index] = h;
        return next;
      });
    },
    [setHoldings]
  );

  const deleteHolding = useCallback(
    (index: number) => {
      setHoldings((prev) => prev.filter((_, i) => i !== index));
    },
    [setHoldings]
  );

  const recordIntent = useCallback(
    (symbol: string, action: IntentAction) => {
      setIntents((prev) => ({
        ...prev,
        [symbol]: { action, date: new Date().toISOString().slice(0, 10) },
      }));
    },
    [setIntents]
  );

  const value = useMemo<HoldingsContextValue>(
    () => ({
      holdings,
      addHolding,
      updateHolding,
      deleteHolding,
      atCap: holdings.length >= HOLDINGS_CAP,
      intents,
      recordIntent,
    }),
    [holdings, addHolding, updateHolding, deleteHolding, intents, recordIntent]
  );

  return <HoldingsContext.Provider value={value}>{children}</HoldingsContext.Provider>;
}

export function useHoldings(): HoldingsContextValue {
  const ctx = useContext(HoldingsContext);
  if (!ctx) throw new Error("useHoldings must be used within a HoldingsProvider");
  return ctx;
}
