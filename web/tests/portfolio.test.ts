import { describe, expect, it } from "vitest";

import { measured, notMeasured, type Measure } from "@/lib/agent/metrics";
import { digestOf, computeStandouts, computeExposure, computeTotals, computeVerdictCounts } from "@/lib/agent/portfolioMetrics";
import { buildPortfolioPackage, allowedPortfolioPaths } from "@/lib/agent/portfolio";
import { unavailable, available } from "@/lib/research/types";
import type { ResearchPackage } from "@/lib/agent/package";
import type { ServeComponentsRecord } from "@/lib/contract/types";

/**
 * digestOf/computeStandouts/allowedPortfolioPaths are where the "no combined
 * severity score" rule gets tested directly: an UNAVAILABLE component must
 * never surface as a standout, and must instead show up in not_measured.
 */

function componentsFixture(overrides: Partial<{
  concentration_share: number | null;
  concentration_baseline: number | null;
  breadth_changed: number | null;
  breadth_active: number | null;
  persistence_longest_run: number | null;
  persistence_status: "AVAILABLE" | "UNAVAILABLE";
}>): ServeComponentsRecord {
  const status = overrides.persistence_status ?? "AVAILABLE";
  return {
    symbol: "TEST",
    trade_date: "2026-09-09",
    scoring_status: "SCORED",
    concentration: {
      basis: "MEASURED",
      value_status: "AVAILABLE",
      reason_codes: [],
      top_n: 3,
      share: overrides.concentration_share ?? 0.6,
      baseline_share: overrides.concentration_baseline ?? 0.4,
      band: 3,
      band_count: 5,
    },
    breadth: {
      basis: "MEASURED",
      value_status: "AVAILABLE",
      reason_codes: [],
      changed: overrides.breadth_changed ?? 5,
      active: overrides.breadth_active ?? 10,
      share: 0.5,
      baseline_share: 0.3,
    },
    persistence: {
      basis: "MEASURED",
      value_status: status,
      reason_codes: status === "UNAVAILABLE" ? ["PERSISTENCE_NOT_COMPUTED"] : [],
      same_direction: status === "AVAILABLE" ? 6 : null,
      of_sessions: status === "AVAILABLE" ? 10 : null,
      longest_run: status === "AVAILABLE" ? (overrides.persistence_longest_run ?? 4) : null,
      session_flags: null,
    },
    coverage: {
      basis: "MEASURED",
      value_status: "AVAILABLE",
      reason_codes: [],
      matched_share: 0.9,
      cohorts_available: 3,
      cohorts_total: 3,
      completeness: "FULL",
    },
  };
}

function packageFixture(symbol: string, opts: {
  components?: ServeComponentsRecord | null;
  cost?: number;
  marketValue?: number | null;
  weight?: number | null;
}): ResearchPackage {
  const none: Measure = notMeasured("NOT_SET");
  const cost = opts.cost ?? 1_000_000;
  // `??` would treat an explicit `null` (the "no close available" case) the
  // same as "not provided", masking exactly the gap these tests exist to
  // check for — so presence is checked with `in`, not nullish coalescing.
  const marketValue: number | null = "marketValue" in opts ? (opts.marketValue as number | null) : 1_100_000;
  const flowComponents = "components" in opts ? opts.components : componentsFixture({});
  return {
    symbol,
    trade_date: "2026-09-09",
    verdict: "Watch",
    flow: { components: flowComponents ?? null, series: [] },
    position: {
      lots: measured(10),
      shares: measured(1000),
      average_price: measured(1000),
      cost_basis: measured(cost),
      last_close: measured(1100),
      market_value: marketValue === null ? notMeasured("NO_CLOSE") : measured(marketValue),
      unrealised_pl: marketValue === null ? notMeasured("NO_CLOSE") : measured(marketValue - cost),
      unrealised_pl_pct: marketValue === null ? notMeasured("NO_CLOSE") : measured((marketValue - cost) / cost),
      portfolio_weight_pct: opts.weight === null || opts.weight === undefined ? none : measured(opts.weight),
    },
    identity: available({
      company_name: `${symbol} Corp`,
      sector: "Financials",
      sub_sector: "Banks",
      sub_sector_slug: "banks",
      industry: null,
      listing_board: null,
      listing_date: null,
      employee_num: null,
      market_cap: null,
      market_cap_rank: null,
      last_close_price: 1100,
      latest_close_date: "2026-09-09",
    }),
    valuation: unavailable("NOT_SET"),
    valuation_metrics: {
      last_close: measured(1100),
      forward_pe: none,
      sectors_intrinsic_value: none,
      close_vs_intrinsic_pct: none,
      latest_pe: none,
      latest_pe_peer_avg: none,
      latest_valuation_year: none,
    },
    financials: unavailable("NOT_SET"),
    future: unavailable("NOT_SET"),
    dividend: unavailable("NOT_SET"),
    peers: unavailable("NOT_SET"),
    peer_metrics: {
      screened: none, eligible: none, excluded: [], self: null,
      peer_median_pe: none, peer_median_pb: none, self_pe_percentile: none, self_pb_percentile: none,
      pe_vs_peer_median: none, pb_vs_peer_median: none, subsector_median_pe: none,
    },
    subsector: unavailable("NOT_SET"),
    context: unavailable("NOT_SET"),
    macro: unavailable("NO_SEARCH_PROVIDER"),
    provenance: [{ endpoint: "company/report/overview", params: {}, credits: 1, cached: false, fetched_at: "2026-09-21T00:00:00Z" }],
    steps: [{ id: "identity", label: "Fetching company profile", status: "done", detail: "ok", credits: 1, duration_ms: 100 }],
    credits_used: 1,
  };
}

describe("digestOf", () => {
  it("carries value_status through untouched rather than flattening it", () => {
    const pkg = packageFixture("BBRI", { components: componentsFixture({ persistence_status: "UNAVAILABLE" }) });
    const digest = digestOf(pkg);
    expect(digest.flow.concentration_share.value_status).toBe("AVAILABLE");
    expect(digest.flow.persistence_longest_run.value_status).toBe("UNAVAILABLE");
    expect(digest.flow.persistence_longest_run.value).toBeNull();
    expect(digest.unavailable_blocks).toContain("flow.persistence");
    expect(digest.unavailable_blocks).toContain("valuation");
  });

  it("marks the whole flow block unavailable when components never scored", () => {
    const pkg = packageFixture("XXXX", { components: null });
    const digest = digestOf(pkg);
    expect(digest.unavailable_blocks).toContain("flow");
    expect(digest.flow.concentration_share.value_status).toBe("UNAVAILABLE");
  });
});

describe("computeStandouts", () => {
  it("keeps concentration, breadth and persistence as three independent lists", () => {
    const a = digestOf(packageFixture("AAAA", { components: componentsFixture({ concentration_share: 0.9, concentration_baseline: 0.3, persistence_longest_run: 8 }) }));
    const b = digestOf(packageFixture("BBBB", { components: componentsFixture({ concentration_share: 0.35, concentration_baseline: 0.3, persistence_longest_run: 2 }) }));
    const standouts = computeStandouts([a, b]);

    expect(standouts.concentration[0].symbol).toBe("AAAA");
    expect(standouts.persistence[0].symbol).toBe("AAAA");
    // No exported field anywhere combines two components into one score.
    expect(Object.keys(standouts)).toEqual(["concentration", "breadth", "persistence", "not_measured"]);
  });

  it("excludes an UNAVAILABLE component from its standout list and records it in not_measured", () => {
    const withGap = digestOf(packageFixture("CCCC", { components: componentsFixture({ persistence_status: "UNAVAILABLE" }) }));
    const clean = digestOf(packageFixture("DDDD", { components: componentsFixture({}) }));
    const standouts = computeStandouts([withGap, clean]);

    expect(standouts.persistence.find((s) => s.symbol === "CCCC")).toBeUndefined();
    expect(standouts.persistence.find((s) => s.symbol === "DDDD")).toBeDefined();
    expect(standouts.not_measured["CCCC"]).toContain("persistence");
    expect(standouts.not_measured["DDDD"]).toBeUndefined();
  });
});

describe("computeTotals / computeExposure", () => {
  it("marks market value UNAVAILABLE rather than partially summing when a close is missing", () => {
    const a = digestOf(packageFixture("AAAA", { components: componentsFixture({}), marketValue: 1_100_000 }));
    const b = digestOf(packageFixture("BBBB", { components: componentsFixture({}), marketValue: null }));
    const totals = computeTotals([a, b], new Map([["AAAA", "MEASURED"], ["BBBB", "MEASURED"]]));
    expect(totals.market_value.value_status).toBe("UNAVAILABLE");
    expect(totals.cost_basis.value_status).toBe("AVAILABLE");
  });

  it("names the largest position by portfolio weight without ranking by a combined score", () => {
    const a = digestOf(packageFixture("AAAA", { components: componentsFixture({}), weight: 0.7 }));
    const b = digestOf(packageFixture("BBBB", { components: componentsFixture({}), weight: 0.3 }));
    const totals = computeTotals([a, b], new Map([["AAAA", "MEASURED"], ["BBBB", "MEASURED"]]));
    const exposure = computeExposure([a, b], totals);
    expect(exposure.largest_position?.symbol).toBe("AAAA");
    expect(exposure.by_subsector[0].sub_sector).toBe("Banks");
  });
});

describe("computeVerdictCounts", () => {
  it("counts each holding's own verdict without deriving a portfolio-wide one", () => {
    const a = digestOf(packageFixture("AAAA", {}));
    const counts = computeVerdictCounts([a]);
    expect(counts.Watch).toBe(1);
    expect(counts.Healthy).toBe(0);
  });
});

describe("allowedPortfolioPaths", () => {
  it("emits no path for an UNAVAILABLE measure or empty standout list", () => {
    const pkg = buildPortfolioPackage(
      [packageFixture("AAAA", { components: componentsFixture({ persistence_status: "UNAVAILABLE" }) })],
      61,
      1000
    );
    const paths = allowedPortfolioPaths(pkg);
    expect([...paths]).not.toContain("standouts.persistence");
    expect([...paths]).toContain("standouts.concentration");
    expect([...paths]).not.toContain("holdings.AAAA.flow.persistence_longest_run");
    expect([...paths]).toContain("holdings.AAAA.flow.concentration_share");
    expect([...paths]).toContain("not_measured");
  });
});
