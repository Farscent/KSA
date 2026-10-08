import { describe, expect, it } from "vitest";

import { projectMacro } from "@/lib/research/project";
import { macroRows } from "@/lib/agent/display";
import { allowedGroundedPaths } from "@/lib/agent/package";
import { evidenceCoverage } from "@/lib/agent/coverage";
import { buildPackage } from "./fixturePackage";

const window = { start: "2026-08-10", end: "2026-09-09" };
const hit = (title: string, url: string, published_date: string | null, score?: number) => ({
  title,
  url,
  published_date,
  ...(score === undefined ? {} : { score }),
  content: "snippet that must never be kept",
});

describe("projectMacro", () => {
  it("keeps only dated, sourced, in-window headlines and drops the snippet", () => {
    const block = projectMacro(
      [
        {
          topic: "policy_rate",
          payload: {
            results: [
              hit("BI holds rate", "https://www.example.com/a", "2026-09-01T03:00:00Z"),
              hit("RFC date", "https://example.com/e", "Wed, 12 Aug 2026 07:35:00 GMT"),
              hit("No date", "https://example.com/b", null),
              hit("No url", "", "2026-10-02"),
              hit("Bad scheme", "javascript:alert(1)", "2026-10-02"),
              hit("Too old", "https://example.com/c", "2026-07-01"),
              hit("After review date", "https://example.com/d", "2026-10-20"),
              hit("Off topic", "https://example.com/f", "2026-09-02", 0.16),
            ],
          },
        },
      ],
      window
    );
    expect(block.value_status).toBe("AVAILABLE");
    expect(block.data?.items).toEqual([
      { topic: "policy_rate", title: "BI holds rate", publisher: "example.com", published_date: "2026-09-01", source_url: "https://www.example.com/a" },
      { topic: "policy_rate", title: "RFC date", publisher: "example.com", published_date: "2026-08-12", source_url: "https://example.com/e" },
    ]);
    expect(JSON.stringify(block)).not.toContain("snippet");
  });

  it("dedupes across topics, caps per topic and sorts newest first", () => {
    const many = ["01", "02", "03", "04", "05"].map((d) => hit(`h${d}`, `https://e.com/${d}`, `2026-09-${d}`));
    const block = projectMacro(
      [
        { topic: "inflation", payload: { results: many } },
        { topic: "rupiah", payload: { results: [hit("dup", "https://e.com/05", "2026-10-05")] } },
      ],
      window
    );
    const items = block.data!.items;
    expect(items.filter((i) => i.topic === "inflation")).toHaveLength(3);
    expect(items.some((i) => i.topic === "rupiah")).toBe(false);
    expect(items.map((i) => i.published_date)).toEqual([...items.map((i) => i.published_date)].sort().reverse());
  });

  it("is unavailable, never an empty list, when nothing qualifies", () => {
    const block = projectMacro([{ topic: "rupiah", payload: { results: [] } }], window);
    expect(block).toMatchObject({ value_status: "UNAVAILABLE", reason_codes: ["NO_MACRO_RESULTS"], data: null });
  });
});

describe("macro in the report", () => {
  const withMacro = () => {
    const pkg = buildPackage();
    pkg.macro = projectMacro(
      [{ topic: "rupiah", payload: { results: [hit("Rupiah firms", "https://news.example.com/r", "2026-09-03")] } }],
      window
    );
    return pkg;
  };

  it("builds linked rows, and none when unavailable", () => {
    const rows = macroRows(withMacro());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "Rupiah exchange rate", compare: "news.example.com", period: "2026-09-03", href: "https://news.example.com/r" });
    expect(macroRows(buildPackage())).toEqual([]);
  });

  it("only allows the macro path when available", () => {
    expect(allowedGroundedPaths(withMacro()).has("macro.items")).toBe(true);
    expect(allowedGroundedPaths(buildPackage()).has("macro.items")).toBe(false);
  });

  it("reports coverage for both states", () => {
    expect(evidenceCoverage(withMacro()).confirmed.join(" ")).toContain("macro and policy headlines");
    expect(evidenceCoverage(buildPackage()).next_checks.join(" ")).toContain("macro and policy news");
  });
});

describe("macroRows", () => {
  it("shows every headline, grouped by topic, even when older topics sort last by date", () => {
    const pkg = buildPackage();
    pkg.macro = projectMacro(
      [
        { topic: "policy_rate", payload: { results: ["05", "06", "07"].map((d) => hit(`p${d}`, `https://e.com/p${d}`, `2026-09-${d}`)) } },
        { topic: "regulation", payload: { results: ["11", "12", "13"].map((d) => hit(`r${d}`, `https://e.com/r${d}`, `2026-08-${d}`)) } },
      ],
      window
    );
    const rows = macroRows(pkg);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.label)).toEqual([...Array(3).fill("Interest rate policy"), ...Array(3).fill("Fiscal and market regulation")]);
  });
});

describe("captured Tavily responses", () => {
  it("project to dated, sourced, in-window headlines for every topic", async () => {
    const captured = (await import("@/fixtures/research/tavily_macro.json")).default as Record<string, unknown>;
    const block = projectMacro(
      Object.entries(captured).map(([topic, payload]) => ({ topic, payload })),
      window
    );
    expect(block.value_status).toBe("AVAILABLE");
    for (const item of block.data!.items) {
      expect(item.source_url).toMatch(/^https?:\/\//);
      expect(item.published_date >= window.start && item.published_date <= window.end).toBe(true);
    }
    expect(new Set(block.data!.items.map((i) => i.topic)).size).toBeGreaterThan(1);
  });
});
