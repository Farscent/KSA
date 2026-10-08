import { describe, expect, it } from "vitest";

import { allowedTokens, checkProse, numberTokens, proseViolations, ungroundedNumbers } from "@/lib/llm/grounding";

/**
 * The model is shown pre-formatted rows and told to copy figures verbatim, so
 * "is this number real?" is an exact string question. These tests pin that.
 */

const rows = allowedTokens(["Top-3 brokers' share of selling", "56,9%", "51,9% own baseline", "Above baseline (+5,0 pp), band 4 of 5", "2026-10-07", "Rp 6.585.000"]);

describe("numberTokens", () => {
  it("keeps id-ID separators together", () => {
    expect(numberTokens("Rp 6.585.000 and 56,9%")).toEqual(["6.585.000", "56,9"]);
  });
});

describe("ungroundedNumbers", () => {
  it("accepts figures copied exactly from the rows", () => {
    expect(ungroundedNumbers("Selling share was 56,9% against 51,9%, worth Rp 6.585.000.", rows)).toEqual([]);
  });

  it("catches a figure the model computed or reformatted", () => {
    expect(ungroundedNumbers("That is about 5 points higher, near 57%.", rows)).toEqual(["57"]);
    expect(ungroundedNumbers("Value was 6,585,000.", rows)).toEqual(["6,585,000"]);
    expect(ungroundedNumbers("Share was 56.9%.", rows)).toEqual(["56.9"]);
  });

  it("lets small whole numbers through but not larger invented ones", () => {
    expect(ungroundedNumbers("Two of three measures moved.", rows)).toEqual([]);
    expect(ungroundedNumbers("Twelve brokers, 12 in total.", rows)).toEqual(["12"]);
  });
});

describe("proseViolations", () => {
  it("flags causal claims, advice, targets and the institutions label", () => {
    expect(proseViolations("Selling rose because of weak earnings.")).toContain("no causal claims");
    expect(proseViolations("Investors should sell now.")).toContain("no instructions");
    expect(proseViolations("The price target is high.")).toContain("no price targets");
    expect(proseViolations("Institutions were selling.")).toContain('never describe a broker cohort as "institutions"');
    expect(proseViolations("The stock will rally next month.")).toContain("no price prediction");
  });

  it("leaves ordinary observations alone", () => {
    expect(proseViolations("Selling was more concentrated than the stock's own baseline.")).toEqual([]);
    expect(proseViolations("Sectors reports a buy rating from most analysts.")).toEqual([]);
  });
});

describe("checkProse", () => {
  it("reports every problem once", () => {
    const result = checkProse(["Share hit 61,2% because of news.", "Another 61,2% here."], rows);
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(2);
  });

  it("passes clean text", () => {
    expect(checkProse(["Selling was above its baseline at 56,9%."], rows)).toEqual({ ok: true, problems: [] });
  });
});
