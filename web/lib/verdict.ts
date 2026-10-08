import type { ServeAlertRecord, ServeComponentsRecord } from "@/lib/contract/types";

export type Verdict = "Healthy" | "Watch" | "Rebalance";

/**
 * A triage label over the three components, not a combined severity score:
 * per CLAUDE.md, concentration/breadth/persistence are never collapsed into
 * one number. This function only ever picks among three fixed labels — it
 * never blends the components' own numbers into a new one, and every label
 * still leaves the components displayed separately underneath it.
 *
 * "Elevated" for a band-scored block means the band sits in the top 40% of
 * its own band_count (e.g. band 3 of 5) — a fixed, auditable cut, not a
 * model judgment.
 */
function isElevated(band: number | null, bandCount: number | null): boolean {
  if (band === null || bandCount === null || bandCount <= 0) return false;
  return band / bandCount >= 0.6;
}

export function computeVerdict(
  alert: ServeAlertRecord | undefined,
  components: ServeComponentsRecord | undefined
): Verdict {
  if (!alert) return "Healthy";
  if (!components) return "Watch";

  const { concentration, coverage } = components;
  const uncertainCoverage = coverage.completeness === "PARTIAL" || coverage.completeness === "UNKNOWN";
  const elevated = isElevated(concentration.band, concentration.band_count);

  if (elevated && !uncertainCoverage) return "Rebalance";
  return "Watch";
}
