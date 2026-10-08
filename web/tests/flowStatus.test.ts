import { describe, expect, it } from "vitest";

import { flowSignals, holdingStatus, crossedSignals, type SavedRunLike } from "@/lib/flowStatus";
import { computeVerdict } from "@/lib/verdict";
import { components } from "./fixturePackage";
import type { ServeComponentsRecord } from "@/lib/contract/types";

function withBlocks(patch: Partial<ServeComponentsRecord>): ServeComponentsRecord {
  return { ...components, ...patch } as ServeComponentsRecord;
}

const calm = withBlocks({
  concentration: { ...components.concentration, value_status: "AVAILABLE", band: 2, band_count: 5, share: 0.4, baseline_share: 0.4 },
  breadth: { ...components.breadth, value_status: "AVAILABLE", share: 0.2, baseline_share: 0.2 },
  persistence: { ...components.persistence, value_status: "AVAILABLE", same_direction: 3, of_sessions: 10 },
  coverage: { ...components.coverage, completeness: "FULL" },
});

describe("flowSignals", () => {
  it("reports nothing crossed on a calm record", () => {
    expect(flowSignals(calm)).toEqual({ concentration: false, breadth: false, persistence: false });
  });

  it("crosses each component on its own, independently", () => {
    const c = withBlocks({
      ...calm,
      concentration: { ...calm.concentration, band: 4 },
      breadth: { ...calm.breadth, share: 0.3 },
      persistence: { ...calm.persistence, same_direction: 7 },
    });
    expect(flowSignals(c)).toEqual({ concentration: true, breadth: true, persistence: true });
    expect(crossedSignals(flowSignals(withBlocks({ ...calm, breadth: { ...calm.breadth, share: 0.3 } })))).toEqual(["breadth"]);
  });

  it("treats an unavailable block as not measurable, never as not crossed", () => {
    const c = withBlocks({ ...calm, breadth: { ...calm.breadth, value_status: "UNAVAILABLE" } });
    expect(flowSignals(c).breadth).toBeNull();
    expect(flowSignals(undefined)).toEqual({ concentration: null, breadth: null, persistence: null });
  });

  it("ignores breadth moves inside the share tolerance", () => {
    const c = withBlocks({ ...calm, breadth: { ...calm.breadth, share: 0.205 } });
    expect(flowSignals(c).breadth).toBe(false);
  });
});

describe("holdingStatus", () => {
  const run: SavedRunLike = { trade_date: calm.trade_date, flow_components: calm, lots: 10 };

  it("is not_reviewed without a saved run", () => {
    expect(holdingStatus({ run: undefined, currentTradeDate: calm.trade_date, currentLots: 10 }).kind).toBe("not_reviewed");
  });

  it("is reviewed when data and position match the run", () => {
    const s = holdingStatus({ run, currentTradeDate: calm.trade_date, currentLots: 10 });
    expect(s.kind).toBe("reviewed");
    if (s.kind === "reviewed") expect(s.crossed).toEqual([]);
  });

  it("is outdated when the data date moved", () => {
    expect(holdingStatus({ run, currentTradeDate: "2099-01-01", currentLots: 10 }).kind).toBe("outdated");
  });

  it("is outdated when the held lots changed", () => {
    expect(holdingStatus({ run, currentTradeDate: calm.trade_date, currentLots: 12 }).kind).toBe("outdated");
  });

  it("does not guess when the run predates saved lots", () => {
    expect(holdingStatus({ run: { ...run, lots: null }, currentTradeDate: calm.trade_date, currentLots: 12 }).kind).toBe("reviewed");
  });
});

describe("computeVerdict", () => {
  it("is Healthy when nothing crossed or nothing is scored", () => {
    expect(computeVerdict(calm)).toBe("Healthy");
    expect(computeVerdict(undefined)).toBe("Healthy");
  });

  it("is Watch when breadth alone crossed", () => {
    expect(computeVerdict(withBlocks({ ...calm, breadth: { ...calm.breadth, share: 0.3 } }))).toBe("Watch");
  });

  it("is Rebalance only for concentration on fully matched data", () => {
    const hot = withBlocks({ ...calm, concentration: { ...calm.concentration, band: 5 } });
    expect(computeVerdict(hot)).toBe("Rebalance");
    expect(computeVerdict({ ...hot, coverage: { ...hot.coverage, completeness: "PARTIAL" } })).toBe("Watch");
  });
});
