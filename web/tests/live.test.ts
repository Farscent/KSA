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
} from "@/lib/research/project";
import { peerMetrics, valuationMetrics } from "@/lib/agent/metrics";

/**
 * Live contract check against the real Sectors API.
 *
 * Skipped unless SECTORS_LIVE=1, because it spends credits and needs a key:
 *
 *   SECTORS_LIVE=1 SECTORS_API_KEY=... pnpm test
 *
 * It exists to catch the failure mode the offline fixtures cannot: the
 * provider changing a URL or a field name, which would otherwise surface as a
 * silently UNAVAILABLE section in a live demo. It calls the same paths
 * lib/sectors/endpoints.ts builds, without the Supabase cache layer (which
 * needs a request context).
 */

const LIVE = process.env.SECTORS_LIVE === "1" && !!process.env.SECTORS_API_KEY;
const BASE = "https://api.sectors.app/v2";

async function get(path: string): Promise<unknown> {
  const response = await fetch(`${BASE}/${path}`, {
    headers: { Authorization: process.env.SECTORS_API_KEY as string, Accept: "application/json" },
    redirect: "manual",
  });
  if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);
  return response.json();
}

describe.skipIf(!LIVE)("live Sectors contract", () => {
  it("company/report sections still project cleanly", async () => {
    const report = await get("company/report/BBRI/?sections=overview,valuation,financials,future,dividend,peers");

    const identity = projectIdentity(report);
    expect(identity.value_status).toBe("AVAILABLE");
    expect(identity.data?.sub_sector_slug).toBeTruthy();

    for (const block of [
      projectValuation(report),
      projectFinancials(report),
      projectFuture(report),
      projectDividend(report),
      projectPeers(report),
    ]) {
      expect(block.value_status).toBe("AVAILABLE");
    }

    const peers = projectPeers(report);
    const subsector = projectSubsector(await get(`subsector/report/${identity.data!.sub_sector_slug}/?sections=statistics,valuation,growth`));
    expect(subsector.value_status).toBe("AVAILABLE");

    const m = peerMetrics(peers, subsector);
    expect(m.eligible.value).toBeGreaterThan(0);
    expect(m.peer_median_pe.value_status).toBe("AVAILABLE");

    expect(valuationMetrics(projectValuation(report)).last_close.value_status).toBe("AVAILABLE");
  }, 60_000);

  it("news, filings and corporate-actions paths are still correct", async () => {
    const [news, filings, actions] = await Promise.all([
      get("news/?extension=idx&symbols=BBRI&limit=5"),
      get("filings/?symbol=BBRI&limit=5"),
      get("company/corporate-actions/BBRI/"),
    ]);
    const block = projectNearbyContext(news, filings, actions);
    expect(block.value_status).toBe("AVAILABLE");
    expect(block.data!.news.length).toBeGreaterThan(0);
  }, 60_000);
});
