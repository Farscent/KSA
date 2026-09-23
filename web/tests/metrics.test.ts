import { describe, expect, it } from "vitest";

import { median, peerMetrics, percentileRank, positionMetrics, valuationMetrics } from "@/lib/agent/metrics";
import { projectPeers, projectSubsector, projectValuation } from "@/lib/research/project";
import { available, unavailable, type Peers, type Subsector } from "@/lib/research/types";

import peersValuation from "@/fixtures/research/bbri_peers_valuation.json";
import subsectorFixture from "@/fixtures/research/banks_subsector.json";

/**
 * These are the numbers the LLM is forbidden from computing, so they are
 * tested by hand against known inputs. The recurring assertion is that a
 * missing input yields UNAVAILABLE and a null value — never a zero.
 */

describe("median", () => {
  it("averages the middle pair on an even count", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
  });
});

describe("percentileRank", () => {
  it("is the share of the population at or below the value", () => {
    expect(percentileRank(3, [1, 2, 3, 4])).toBe(0.75);
    expect(percentileRank(0, [1, 2])).toBe(0);
    expect(percentileRank(5, [])).toBeNull();
  });
});

describe("positionMetrics", () => {
  it("computes cost, market value and P&L on a hand-checked holding", () => {
    // 10 lots x 100 shares = 1,000 shares at 4,000 = 4,000,000 cost.
    // Close 4,400 -> 4,400,000 market value, +400,000, +10%.
    const m = positionMetrics({ lots: 10, avg: 4000 }, 4400, 44_000_000);
    expect(m.shares.value).toBe(1000);
    expect(m.cost_basis.value).toBe(4_000_000);
    expect(m.market_value.value).toBe(4_400_000);
    expect(m.unrealised_pl.value).toBe(400_000);
    expect(m.unrealised_pl_pct.value).toBeCloseTo(0.1, 10);
    expect(m.portfolio_weight_pct.value).toBeCloseTo(0.1, 10);
  });

  it("returns UNAVAILABLE rather than zero when the close is missing", () => {
    const m = positionMetrics({ lots: 10, avg: 4000 }, null, null);
    expect(m.cost_basis.value).toBe(4_000_000); // cost needs no close
    for (const field of [m.market_value, m.unrealised_pl, m.unrealised_pl_pct]) {
      expect(field.value_status).toBe("UNAVAILABLE");
      expect(field.value).toBeNull();
      expect(field.reason_codes).toContain("NO_CLOSE");
    }
  });

  it("marks weight UNAVAILABLE when portfolio value could not be totalled", () => {
    const m = positionMetrics({ lots: 1, avg: 100 }, 100, null);
    expect(m.portfolio_weight_pct.value_status).toBe("UNAVAILABLE");
    expect(m.portfolio_weight_pct.reason_codes).toContain("PORTFOLIO_VALUE_UNAVAILABLE");
  });
});

describe("peerMetrics", () => {
  const peers = projectPeers(peersValuation);
  const subsector = projectSubsector(subsectorFixture);

  it("compares the holding against the eligible peer set", () => {
    const m = peerMetrics(peers, subsector);
    expect(m.self?.symbol).toBe("BBRI");
    expect(m.screened.value).toBeGreaterThan(0);
    expect(m.eligible.value).toBeGreaterThan(0);
    expect(m.peer_median_pe.value_status).toBe("AVAILABLE");
    // The peer-set median and Sectors' subsector median are distinct figures
    // and must never be conflated into one.
    expect(m.subsector_median_pe.value_status).toBe("AVAILABLE");
    expect(m.pe_vs_peer_median.value).toBeCloseTo(
      (m.self!.pe_ttm as number) - (m.peer_median_pe.value as number),
      10
    );
  });

  it("excludes a loss-making peer with a stated reason", () => {
    const withLoser = available<Peers>({
      sub_sector: "Banks",
      companies: [
        { ...blank, symbol: "SELF", is_self: true, pe_ttm: 10, pb_mrq: 1, market_cap: 100 },
        { ...blank, symbol: "GOOD", pe_ttm: 8, pb_mrq: 1, market_cap: 100 },
        { ...blank, symbol: "LOSS", pe_ttm: -4, pb_mrq: 1, market_cap: 100 },
      ],
    });
    const m = peerMetrics(withLoser, subsector);
    expect(m.eligible.value).toBe(1);
    expect(m.excluded).toHaveLength(1);
    expect(m.excluded[0].symbol).toBe("LOSS");
    expect(m.excluded[0].reason).toContain("non-positive P/E");
  });

  it("excludes a peer missing a comparison ratio and names what was missing", () => {
    const withGap = available<Peers>({
      sub_sector: "Banks",
      companies: [
        { ...blank, symbol: "SELF", is_self: true, pe_ttm: 10, pb_mrq: 1, market_cap: 100 },
        { ...blank, symbol: "THIN", pe_ttm: null, pb_mrq: 1, market_cap: 100 },
      ],
    });
    const m = peerMetrics(withGap, subsector);
    expect(m.excluded[0].reason).toContain("P/E");
    // Nothing comparable survived, so every comparison is UNAVAILABLE rather
    // than a best-of-a-bad-set — AGENTS.md's "no suitable alternative" path.
    expect(m.eligible.value).toBe(0);
    expect(m.peer_median_pe.value_status).toBe("UNAVAILABLE");
    expect(m.pe_vs_peer_median.value).toBeNull();
  });

  it("is UNAVAILABLE throughout when there is no peer data at all", () => {
    const m = peerMetrics(unavailable<Peers>("NO_PEERS_SECTION"), unavailable<Subsector>("NO_SUBSECTOR_REPORT"));
    expect(m.peer_median_pe.value).toBeNull();
    expect(m.subsector_median_pe.value).toBeNull();
    expect(m.excluded).toEqual([]);
  });
});

describe("valuationMetrics", () => {
  it("reports Sectors' intrinsic value and the gap to last close", () => {
    const m = valuationMetrics(projectValuation(peersValuation));
    expect(m.sectors_intrinsic_value.value_status).toBe("AVAILABLE");
    expect(m.close_vs_intrinsic_pct.value).toBeCloseTo(
      ((m.last_close.value as number) - (m.sectors_intrinsic_value.value as number)) /
        (m.sectors_intrinsic_value.value as number),
      10
    );
  });

  it("is UNAVAILABLE when there is no valuation section", () => {
    const m = valuationMetrics(unavailable("NO_VALUATION_SECTION"));
    expect(m.close_vs_intrinsic_pct.value).toBeNull();
    expect(m.forward_pe.value_status).toBe("UNAVAILABLE");
  });
});

const blank = {
  symbol: "",
  company_name: null,
  is_self: false,
  pb_mrq: null,
  pe_ttm: null,
  market_cap: null,
  net_income: null,
  total_revenue: null,
  total_equity: null,
  total_assets: null,
  employee_num: null,
  yearly_mcap_chg: null,
};
