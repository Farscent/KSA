import { describe, expect, it } from "vitest";

import { componentCounts, describeDiff, diffRuns, type RunDigest } from "@/lib/history/diff";

const d = (symbol: string, crossed: RunDigest["crossed"]): RunDigest => ({ symbol, crossed });

describe("componentCounts", () => {
  it("counts each component separately without summing them", () => {
    const counts = componentCounts([d("A", ["concentration", "breadth"]), d("B", ["breadth"]), d("C", [])]);
    expect(counts).toEqual({ concentration: 1, breadth: 2, persistence: 0 });
  });
});

describe("diffRuns", () => {
  it("reports added, removed and changed holdings", () => {
    const diff = diffRuns(
      [d("A", ["breadth"]), d("B", []), d("NEW", [])],
      [d("A", []), d("B", []), d("GONE", ["persistence"])]
    );
    expect(diff.added).toEqual(["NEW"]);
    expect(diff.removed).toEqual(["GONE"]);
    expect(diff.changed).toEqual([{ symbol: "A", from: [], to: ["breadth"] }]);
  });

  it("says plainly when nothing changed", () => {
    const diff = diffRuns([d("A", ["breadth"])], [d("A", ["breadth"])]);
    expect(describeDiff(diff)).toEqual(["No change from the previous run"]);
  });

  it("ignores the order components were listed in", () => {
    const diff = diffRuns([d("A", ["breadth", "concentration"])], [d("A", ["concentration", "breadth"])]);
    expect(diff.changed).toEqual([]);
  });

  it("describes a change in component names", () => {
    const lines = describeDiff(diffRuns([d("A", ["breadth"])], [d("A", [])]));
    expect(lines).toEqual(["A: nothing crossed → Breadth"]);
  });
});
