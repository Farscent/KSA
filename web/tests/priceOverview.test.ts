import { describe, expect, it } from "vitest";
import { priceOverview } from "@/lib/price/overview";
import type { PricePoint } from "@/lib/contract/types";

const series = (closes: number[]): PricePoint[] =>
  closes.map((close, i) => ({ trade_date: `2026-08-${String(i + 1).padStart(2, "0")}`, close, volume: null }));

describe("priceOverview", () => {
  it("is null for an empty series", () => {
    expect(priceOverview([])).toBeNull();
  });

  it("computes day change against the previous ingested session", () => {
    const o = priceOverview(series([100, 110]))!;
    expect(o.dayChange?.abs).toBe(10);
    expect(o.dayChange?.fraction).toBeCloseTo(0.1);
  });

  it("has no day change for a single session", () => {
    expect(priceOverview(series([100]))!.dayChange).toBeNull();
  });

  it("reports null, not zero, when there are too few sessions", () => {
    const o = priceOverview(series([100, 102, 104]))!;
    expect(o.performance.find((p) => p.label === "1W")!.change).toBeNull();
    expect(o.performance.find((p) => p.label === "Window")!.change).toBeCloseTo(0.04);
  });

  it("uses 5 and 21 sessions back, and tracks high and low", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const o = priceOverview(series(closes))!;
    expect(o.performance.find((p) => p.label === "1W")!.change).toBeCloseTo(129 / 124 - 1);
    expect(o.performance.find((p) => p.label === "1M")!.change).toBeCloseTo(129 / 108 - 1);
    expect(o.windowHigh).toBe(129);
    expect(o.windowLow).toBe(100);
    expect(o.sessions).toBe(30);
  });
});
