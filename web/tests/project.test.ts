import { describe, expect, it } from "vitest";

import {
  projectDividend,
  projectFinancials,
  projectFuture,
  projectIdentity,
  projectNearbyContext,
  projectPeers,
  projectSubsector,
  projectValuation,
  subsectorSlug,
} from "@/lib/research/project";

import overview from "@/fixtures/research/bbri_overview.json";
import peersValuation from "@/fixtures/research/bbri_peers_valuation.json";
import ffd from "@/fixtures/research/bbri_financials_future_dividend.json";
import subsector from "@/fixtures/research/banks_subsector.json";
import news from "@/fixtures/research/bbri_news.json";
import filings from "@/fixtures/research/bbri_filings.json";
import corporateActions from "@/fixtures/research/bbri_corporate_actions.json";

/**
 * Every fixture here is a real captured Sectors response (see
 * web/fixtures/research/). If the provider changes a shape, these fail rather
 * than the projection silently emitting nulls that read as zeros on screen.
 */

describe("subsectorSlug", () => {
  it("kebab-cases a subsector name", () => {
    expect(subsectorSlug("Banks")).toBe("banks");
    expect(subsectorSlug("Food & Beverage")).toBe("food-beverage");
    expect(subsectorSlug(null)).toBeNull();
  });
});

describe("projectIdentity", () => {
  it("reads identity and derives the subsector slug", () => {
    const block = projectIdentity(overview);
    expect(block.value_status).toBe("AVAILABLE");
    expect(block.data?.company_name).toContain("Bank Rakyat Indonesia");
    expect(block.data?.sub_sector).toBe("Banks");
    expect(block.data?.sub_sector_slug).toBe("banks");
    expect(block.data?.market_cap).toBeGreaterThan(0);
  });

  it("is UNAVAILABLE, not a shell of nulls, when the section is absent", () => {
    const block = projectIdentity({ symbol: "BBRI.JK" });
    expect(block.value_status).toBe("UNAVAILABLE");
    expect(block.data).toBeNull();
    expect(block.reason_codes).toContain("NO_OVERVIEW_SECTION");
  });
});

describe("projectValuation", () => {
  it("reads Sectors' published figures and sorts history oldest-first", () => {
    const block = projectValuation(peersValuation);
    expect(block.value_status).toBe("AVAILABLE");
    expect(block.data?.forward_pe).toBeGreaterThan(0);
    expect(block.data?.intrinsic_value).not.toBeNull();
    const years = block.data!.historical_valuation.map((r) => r.year);
    expect(years).toEqual([...years].sort((a, b) => a - b));
    expect(block.data!.historical_valuation.at(-1)?.pe_peer_avg).not.toBeNull();
  });
});

describe("projectPeers", () => {
  it("strips the .JK suffix and marks exactly one self row", () => {
    const block = projectPeers(peersValuation);
    expect(block.value_status).toBe("AVAILABLE");
    const companies = block.data!.companies;
    expect(companies.length).toBeGreaterThan(5);
    expect(companies.every((c) => !c.symbol.includes("."))).toBe(true);
    expect(companies.filter((c) => c.is_self)).toHaveLength(1);
    expect(companies.find((c) => c.is_self)?.symbol).toBe("BBRI");
  });

  it("drops the bulky breakdown arrays that never reach the model", () => {
    const block = projectPeers(peersValuation);
    const first = block.data!.companies[0] as unknown as Record<string, unknown>;
    expect(first).not.toHaveProperty("int_income_breakdown");
    expect(first).not.toHaveProperty("operating_expense_breakdown");
    expect(first).not.toHaveProperty("point_summaries");
  });
});

describe("projectFinancials", () => {
  it("reads the latest ratio year and labels which year it is", () => {
    const block = projectFinancials(ffd);
    expect(block.value_status).toBe("AVAILABLE");
    expect(block.data?.roe).not.toBeNull();
    expect(block.data?.ratio_year).toBeTruthy();
    const years = block.data!.historical_financials.map((r) => r.year);
    expect(years).toEqual([...years].sort((a, b) => a - b));
  });
});

describe("projectFuture", () => {
  it("reads the analyst rating breakdown", () => {
    const block = projectFuture(ffd);
    expect(block.value_status).toBe("AVAILABLE");
    expect(block.data?.analyst_rating_breakdown?.n_analyst).toBeGreaterThan(0);
    expect(block.data!.growth_forecasts.length).toBeGreaterThan(0);
  });
});

describe("projectDividend", () => {
  it("reads TTM yield and payout ratio", () => {
    const block = projectDividend(ffd);
    expect(block.value_status).toBe("AVAILABLE");
    expect(block.data?.yield_ttm).toBeGreaterThan(0);
    expect(block.data?.payout_ratio).not.toBeNull();
  });
});

describe("projectSubsector", () => {
  it("picks the most recent valuation year", () => {
    const block = projectSubsector(subsector);
    expect(block.value_status).toBe("AVAILABLE");
    expect(block.data?.median_pe).toBeGreaterThan(0);
    expect(block.data?.latest_year).toBe(2026);
    expect(block.data?.latest_pe).toBeGreaterThan(0);
  });
});

describe("projectNearbyContext", () => {
  it("records how many symbols each item tags", () => {
    const block = projectNearbyContext(news, filings, corporateActions);
    expect(block.value_status).toBe("AVAILABLE");
    // Every news item in this fixture tags several tickers, which is exactly
    // why the report must be able to say an item is not specific to BBRI.
    expect(block.data!.news[0].symbols_mentioned).toBeGreaterThan(1);
    expect(block.data!.news[0].source_url).toContain("http");
  });

  it("keeps only dated corporate actions, newest first", () => {
    const block = projectNearbyContext(news, filings, corporateActions);
    const actions = block.data!.corporate_actions;
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((a) => a.date)).toBe(true);
    const dates = actions.map((a) => a.date!);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("is UNAVAILABLE when nothing came back at all", () => {
    const block = projectNearbyContext(null, null, null);
    expect(block.value_status).toBe("UNAVAILABLE");
    expect(block.reason_codes).toContain("NO_NEARBY_CONTEXT");
  });
});
