import { describe, expect, it } from "vitest";

import { buildPortfolioPackage, allowedPortfolioPaths } from "@/lib/agent/portfolio";
import { exposureRows, overviewRows, standoutRows, watchRows } from "@/lib/agent/portfolioDisplay";

import { buildPackage } from "./fixturePackage";

const RAW_FLOAT = /\d\.\d{5,}|\d{12,}|e[+-]\d/;

describe("portfolio fact tables", () => {
  const pkg = buildPortfolioPackage([buildPackage()], 61, 0);

  it("format every figure and keep the three components as separate rows", () => {
    for (const row of [...overviewRows(pkg), ...standoutRows(pkg), ...exposureRows(pkg)]) {
      for (const text of [row.value, row.compare, row.status, row.period]) {
        expect(text ?? "", row.label).not.toMatch(RAW_FLOAT);
      }
    }
    const labels = standoutRows(pkg).map((r) => r.label);
    expect(labels.filter((l) => /concentration|changing side|persistence/i.test(l))).toHaveLength(3);
  });

  it("never merges the components into one ranked or combined row", () => {
    for (const row of standoutRows(pkg)) {
      expect(row.label).not.toMatch(/riskiest|overall|combined|score/i);
    }
  });

  it("cites only allowed portfolio paths", () => {
    const allowed = allowedPortfolioPaths(pkg);
    for (const row of [...overviewRows(pkg), ...standoutRows(pkg), ...exposureRows(pkg)]) {
      for (const path of row.paths) expect(allowed.has(path), `${row.label}: ${path}`).toBe(true);
    }
  });

  it("builds the watch section in code with a headline", () => {
    const watch = watchRows(pkg);
    expect(watch.headline).toMatch(/Watch or Rebalance label/);
  });
});
