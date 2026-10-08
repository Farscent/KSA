import { describe, expect, it } from "vitest";

import {
  balanceSheetRows,
  contextRows,
  earningsQualityRows,
  flowRows,
  fundamentalsRows,
  idrBig,
  mult,
  positionRows,
  unmeasured,
  valuationRows,
  watchSummary,
} from "@/lib/agent/display";
import { allowedGroundedPaths } from "@/lib/agent/package";
import { qualityMetrics } from "@/lib/agent/metrics";
import { projectFinancials, projectIdentity } from "@/lib/research/project";
import { unavailable } from "@/lib/research/types";
import { buildPackage, components } from "./fixturePackage";

import overview from "@/fixtures/research/bbri_overview.json";
import ffd from "@/fixtures/research/bbri_financials_future_dividend.json";

/** Raw floats and exponent forms are exactly what the old report leaked. */
const RAW_FLOAT = /\d\.\d{5,}|\d{12,}|e[+-]\d/;

describe("formatting", () => {
  it("scales Rupiah and formats multiples", () => {
    expect(idrBig(174_020_000_000_000)).toBe("Rp 174,02 trillion");
    expect(idrBig(2_500_000_000)).toBe("Rp 2,50 billion");
    expect(mult(5.41242719491217)).toBe("5,41×");
  });
});

describe("flowRows", () => {
  it("reports each component separately with a baseline comparison", () => {
    const rows = flowRows(buildPackage());
    expect(rows).toHaveLength(4);
    const [con, br, per, cov] = rows;
    expect(con.value).toBe("56,9%");
    expect(con.compare).toBe("51,9% own baseline");
    expect(con.status).toBe("Above baseline (+5,0 pp), band 4 of 5");
    expect(con.tone).toBe("differs");
    expect(br.status).toBe("In line with baseline (−0,6 pp)");
    expect(br.tone).toBe("neutral");
    expect(per.status).toBe("No baseline to compare");
    expect(cov.value).toBe("99,99%");
    expect(cov.status).toBe("Full coverage");
  });

  it("shows nothing for an unmeasured component rather than a zero", () => {
    const pkg = buildPackage();
    pkg.flow.components = {
      ...components,
      breadth: { ...components.breadth, value_status: "UNAVAILABLE", reason_codes: ["NO_BASELINE"], changed: null, active: null, share: null },
    };
    const rows = flowRows(pkg);
    expect(rows.map((r) => r.label)).not.toContain("Brokers that changed side");
    expect(unmeasured(pkg).join(" ")).toContain("Breadth: not measurable");
  });

  it("is empty when the symbol has not been scored", () => {
    const pkg = buildPackage();
    pkg.flow.components = null;
    expect(flowRows(pkg)).toEqual([]);
  });
});

describe("positionRows", () => {
  it("formats the P&L percent as a percent of cost, not a raw fraction", () => {
    const rows = positionRows(buildPackage());
    const pl = rows.find((r) => r.label === "Unrealised profit / loss");
    // 15 lots x 100 x (4390 - 4420) = -45,000 on a 6,630,000 cost basis.
    expect(pl?.value).toBe("−Rp 45.000");
    expect(pl?.compare).toBe("−0,7%");
    expect(pl?.status).toBe("Below cost");
    const mv = rows.find((r) => r.label === "Market value");
    expect(mv?.compare).toBe("32,9% of your portfolio");
  });
});

describe("every section's rows", () => {
  const pkg = buildPackage();
  const builders = {
    position: positionRows,
    flow: flowRows,
    fundamentals: fundamentalsRows,
    quality: earningsQualityRows,
    balance: balanceSheetRows,
    valuation: valuationRows,
    context: contextRows,
  };

  it("contain no raw floats or unformatted large numbers", () => {
    for (const [name, build] of Object.entries(builders)) {
      for (const row of build(pkg)) {
        for (const text of [row.value, row.compare, row.status, row.period]) {
          expect(text ?? "", `${name}: ${row.label}`).not.toMatch(RAW_FLOAT);
        }
      }
    }
  });

  it("cite only paths the grounding allow-list permits", () => {
    const allowed = allowedGroundedPaths(pkg);
    for (const [name, build] of Object.entries(builders)) {
      for (const row of build(pkg)) {
        // A "not applicable" note states no measured figure, so cites nothing.
        if (row.paths.length === 0) continue;
        const missing = row.paths.filter((p) => !allowed.has(p));
        // A row may name a path whose block is UNAVAILABLE only if the row
        // itself was still buildable from the other paths it lists; at least
        // one cited path must be allowed.
        expect(missing.length, `${name}: ${row.label} cites only disallowed paths ${missing.join(", ")}`).toBeLessThan(row.paths.length);
      }
    }
  });
});

describe("contextRows", () => {
  it("lists items newest first and marks multi-symbol stories", () => {
    const rows = contextRows(buildPackage());
    expect(rows.length).toBeGreaterThan(0);
    const dates = rows.map((r) => r.period ?? "");
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(rows.every((r) => r.compare === "About this stock" || r.compare?.startsWith("Tags several"))).toBe(true);
  });
});

describe("watchSummary", () => {
  it("counts differences and gaps, and always lists the macro gap", () => {
    const watch = watchSummary(buildPackage());
    expect(watch.rows.every((r) => r.tone === "differs" || r.tone === "gap")).toBe(true);
    expect(watch.headline).toMatch(/could not be measured/);
    expect(watch.bullets.join(" ")).toContain("Macro and policy context: not available (no web-search provider is configured)");
  });
});

describe("quality metrics and rows", () => {
  it("treats a bank as not applicable for cash-flow measures and reports bank ratios", () => {
    const pkg = buildPackage();
    const q = pkg.quality_metrics!;
    expect(q.is_bank).toBe(true);
    expect(q.fcf_to_net_income_3y).toMatchObject({ value: null, value_status: "UNAVAILABLE", reason_codes: ["NOT_APPLICABLE_BANK"] });
    expect(q.net_debt_to_ebitda.value).toBeNull();
    expect(q.capital_adequacy_ratio.value).toBeGreaterThan(0);

    const quality = earningsQualityRows(pkg);
    expect(quality[0].status).toBe("Not applicable");
    const balance = balanceSheetRows(pkg);
    expect(balance.map((r) => r.label)).toContain("Capital adequacy ratio");
    expect(balance.map((r) => r.label)).not.toContain("Net debt");
  });

  it("computes cash conversion and leverage for a non-bank by hand", () => {
    const base = projectFinancials(ffd);
    const year = (y: number, over: Record<string, number | null>) => ({
      year: y, revenue: 1000, earnings: 100, operating_cash_flow: null, free_cash_flow: 80, total_debt: 600,
      net_debt: 400, cash_and_equivalents: 200, ebit: 150, ebitda: 200, interest_expense: 50, total_equity: 500,
      total_assets: 1500, ...over,
    });
    const financials = {
      ...base,
      data: {
        ...base.data!,
        bank_ratios: null,
        historical_financials: [year(2023, { revenue: 800, earnings: 80, free_cash_flow: 60 }), year(2024, {}), year(2025, { revenue: 1200, earnings: 90, free_cash_flow: 70 })],
      },
    };
    const identity = projectIdentity({ ...overview, overview: { ...(overview as { overview: object }).overview, sub_sector: "Metals" } });
    const q = qualityMetrics(financials, identity);

    expect(q.is_bank).toBe(false);
    // (60 + 80 + 70) / (80 + 100 + 90) = 210 / 270
    expect(q.fcf_to_net_income_3y.value).toBeCloseTo(210 / 270, 10);
    expect(q.fcf_margin.value).toBeCloseTo(70 / 1200, 10);
    expect(q.net_debt_to_ebitda.value).toBe(2);
    expect(q.interest_coverage.value).toBe(3);
    expect(q.debt_to_equity.value).toBeCloseTo(1.2, 10);
    // 2025 revenue 1200 against 2024 revenue 1000.
    expect(q.revenue_growth_yoy.value).toBeCloseTo(0.2, 10);
    expect(q.earnings_growth_yoy.value).toBeCloseTo(-0.1, 10);
    expect(q.capital_adequacy_ratio).toMatchObject({ value: null, reason_codes: ["NOT_A_BANK"] });
  });

  it("never turns a missing input into zero", () => {
    const base = projectFinancials(ffd);
    const sparse = {
      ...base,
      data: { ...base.data!, bank_ratios: null, historical_financials: [{ year: 2025, revenue: 100, earnings: 10, operating_cash_flow: null, free_cash_flow: null, total_debt: null, net_debt: null, cash_and_equivalents: null, ebit: null, ebitda: null, interest_expense: null, total_equity: null, total_assets: null }] },
    };
    const q = qualityMetrics(sparse, unavailable("NOT_RUN"));
    for (const m of [q.fcf_to_net_income_3y, q.net_debt_to_ebitda, q.interest_coverage, q.debt_to_equity, q.revenue_growth_yoy]) {
      expect(m.value).toBeNull();
      expect(m.value_status).toBe("UNAVAILABLE");
    }
  });
});

describe("evidenceCoverage", () => {
  it("separates what was confirmed from what could not be measured", async () => {
    const { evidenceCoverage } = await import("@/lib/agent/coverage");
    const cov = evidenceCoverage(buildPackage());
    expect(cov.confirmed.join(" ")).toContain("Broker-flow concentration, breadth, persistence measured");
    expect(cov.confirmed).toContain("Broker data coverage was full.");
    expect(cov.gaps.join(" ")).toContain("one provider (Sectors)");
    expect(cov.gaps.join(" ")).toContain("Macro and policy context: not available");
    expect(cov.next_checks.join(" ")).toContain("macro and policy news");
  });

  it("flags example-value flow figures as not measured", async () => {
    const { evidenceCoverage } = await import("@/lib/agent/coverage");
    const pkg = buildPackage();
    pkg.flow.components = { ...components, concentration: { ...components.concentration, basis: "EXAMPLE_VALUE" } };
    expect(evidenceCoverage(pkg).gaps.join(" ")).toContain("example values");
  });
});
