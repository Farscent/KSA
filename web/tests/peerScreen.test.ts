import { describe, expect, it } from "vitest";

import { buildPeerScreen } from "@/lib/agent/peerScreen";
import { assertPeerScreen } from "@/lib/contract/guards";
import { available, unavailable, type Peers } from "@/lib/research/types";
import { buildPackage } from "./fixturePackage";

const pe = (symbol: string, pe_ttm: number | null, self = false) => ({
  symbol, company_name: symbol, is_self: self, pb_mrq: 1.5, pe_ttm, market_cap: 1e12,
  net_income: 1e11, total_revenue: null, total_equity: null, total_assets: null,
  employee_num: null, yearly_mcap_chg: -0.1,
});

describe("buildPeerScreen", () => {
  it("builds a valid screen from the saved package", () => {
    const pkg = buildPackage();
    const screen = buildPeerScreen("BBRI", pkg)!;
    expect(screen).not.toBeNull();
    expect(() => assertPeerScreen(screen)).not.toThrow();
    expect(screen.shortlist).not.toContain("BBRI");
    expect(screen.screened).toBe(screen.excluded.length + screen.shortlist.length);
  });

  it("keeps exclusions with a reason and leaves null fields unavailable, not zero", () => {
    const peers = available<Peers>({ sub_sector: "Banks", companies: [pe("AAA", 10, true), pe("BBB", 12), pe("CCC", -3)] });
    const pkg = buildPackage();
    const metrics = { ...pkg.peer_metrics, excluded: [{ symbol: "CCC", reason: "non-positive P/E (loss-making)" }] };
    const screen = buildPeerScreen("AAA", { peers, peer_metrics: metrics })!;
    expect(screen.shortlist).toEqual(["BBB"]);
    expect(screen.excluded[0]).toMatchObject({ symbol: "CCC", reason_code: "NON_POSITIVE_PE" });
    const revenue = screen.scorecard.find((r) => r.label === "Revenue")!;
    expect(revenue.cells.every((c) => c.value === null && c.value_status === "UNAVAILABLE")).toBe(true);
    expect(() => assertPeerScreen(screen)).not.toThrow();
  });

  it("returns an empty shortlist and no scorecard when nothing qualifies", () => {
    const peers = available<Peers>({ sub_sector: "Banks", companies: [pe("AAA", 10, true), pe("CCC", -3)] });
    const metrics = { ...buildPackage().peer_metrics, excluded: [{ symbol: "CCC", reason: "non-positive P/E (loss-making)" }] };
    const screen = buildPeerScreen("AAA", { peers, peer_metrics: metrics })!;
    expect(screen.shortlist).toEqual([]);
    expect(screen.scorecard).toEqual([]);
    expect(screen.excluded).toHaveLength(1);
  });

  it("returns null when the run has no peer block", () => {
    expect(buildPeerScreen("AAA", { peers: unavailable("NO_PEERS_SECTION"), peer_metrics: null })).toBeNull();
    expect(buildPeerScreen("AAA", { peers: null, peer_metrics: null })).toBeNull();
  });
});
