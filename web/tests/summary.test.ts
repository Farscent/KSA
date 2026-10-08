import { describe, expect, it } from "vitest";

import { summarise } from "@/lib/agent/summary";
import { flowRows, watchSummary, type FactRow } from "@/lib/agent/display";
import { buildPackage } from "./fixturePackage";

const row = (label: string, tone: FactRow["tone"]): FactRow => ({
  label, value: "1", compare: null, status: null, period: null, tone, paths: [],
});

describe("summarise", () => {
  it("returns null for reports saved before the table format", () => {
    expect(summarise([{ id: "flow_structure", headline: "x" }])).toBeNull();
  });

  it("uses the flow section for the finding and components", () => {
    const pkg = buildPackage();
    const s = summarise([{ id: "flow_structure", headline: "Finding.", rows: flowRows(pkg) }]);
    expect(s?.finding).toBe("Finding.");
    expect(s?.components).toHaveLength(4);
  });

  it("never repeats a component row among the standouts, keeps report order, caps at three", () => {
    const flow = [row("A", "differs")];
    const risks = [row("A", "differs"), row("B", "differs"), row("C", "neutral"), row("D", "differs"), row("E", "differs"), row("F", "differs")];
    const s = summarise([
      { id: "flow_structure", headline: "h", rows: flow },
      { id: "risks", rows: risks, bullets: ["gap one"] },
    ]);
    expect(s?.standouts.map((r) => r.label)).toEqual(["B", "D", "E"]);
    expect(s?.moreStandouts).toBe(1);
    expect(s?.unmeasured).toBe(1);
  });

  it("works with the real code-built watch rows", () => {
    const pkg = buildPackage();
    const watch = watchSummary(pkg);
    const s = summarise([
      { id: "flow_structure", headline: "h", rows: flowRows(pkg) },
      { id: "risks", rows: watch.rows, bullets: watch.bullets },
    ]);
    expect(s?.standouts.length).toBeLessThanOrEqual(3);
    for (const r of s?.standouts ?? []) expect(s?.components.map((c) => c.label)).not.toContain(r.label);
  });
});
