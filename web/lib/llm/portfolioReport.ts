import "server-only";

/**
 * The portfolio-level sectioned report — mirrors `lib/llm/report.ts`'s shape
 * exactly (same RULES, same per-section allow-listing, same bounded retry),
 * over a `PortfolioPackage` instead of a single symbol's `ResearchPackage`.
 *
 * The one addition to the rules below: concentration/breadth/persistence must
 * stay separate findings even when summarising many holdings at once. This is
 * the section where "rank my holdings by risk" is the most tempting shortcut,
 * and the most direct violation of CLAUDE.md's founding rule.
 */

import { allowedPortfolioPaths, type PortfolioPackage } from "@/lib/agent/portfolio";
import { exposureRows, overviewRows, standoutRows, watchRows } from "@/lib/agent/portfolioDisplay";
import type { FactRow } from "@/lib/agent/display";
import { writeReading } from "@/lib/llm/reading";

const RULES = `You are writing the short reading of one section of a portfolio-wide review report
covering several stock positions. You are given ROWS: a table of already-computed facts. Every
figure in ROWS is already formatted and compared.

Write for an ordinary investor who does not know market jargon.

Hard rules:
- Quote any figure by copying its text EXACTLY as it appears in ROWS (same digits, same
  separators, same unit). Never reformat, round, convert, add, subtract or compare numbers
  yourself. If a figure is not in ROWS, do not state it.
- Do not repeat the whole table. Say what it MEANS: the one or two things that stand out.
- Concentration, breadth and persistence are three SEPARATE findings. Never combine them into
  one score, one "risk level", or one ranked list of "riskiest holdings". A holding missing from
  a list was not among the largest movers this run — do not say it scored well.
- Never state or imply a cause ("because of", "due to", "driven by").
- Never give trading advice, a price target, a prediction, or a buy/sell recommendation.
- Never call any broker cohort "institutions" — say "distribution pressure" or just "brokers".
- The triage labels (Healthy / Watch / Rebalance) describe how much broker-flow structure moved
  against each holding's own baseline: state them as observations, never instructions.
- Never say a missing figure is zero or none. If something is not in ROWS, leave it out.`;


export interface SectionSpec {
  id: string;
  title: string;
  rows: (pkg: PortfolioPackage) => FactRow[];
  guidance: string;
  mode: "model" | "code";
}

export const SECTIONS: SectionSpec[] = [
  {
    id: "overview",
    title: "Portfolio overview",
    rows: overviewRows,
    mode: "model",
    guidance:
      "Summarise the portfolio as reviewed: how many holdings, what it cost and is worth, whether it " +
      "sits above or below cost, and how the triage labels split. State the as-of date. Headline: one " +
      "sentence. At most two bullets.",
  },
  {
    id: "flow_across_holdings",
    title: "What changed underneath",
    rows: standoutRows,
    mode: "model",
    guidance:
      "This is the most important section. Name which holdings stood out on concentration, which on " +
      "breadth and which on persistence, as three separate findings — using only the rows. Say which " +
      "holdings could not be measured. Never imply an overall severity or rank holdings. Headline: one " +
      "sentence. At most three bullets, one per measure.",
  },
  {
    id: "exposure",
    title: "Exposure",
    rows: exposureRows,
    mode: "model",
    guidance:
      "Describe how the portfolio's cost is spread across subsectors, the largest single position, and " +
      "how much sits in holdings that could not be valued. This is capital allocation, not a risk " +
      "score. Headline: one sentence. At most two bullets.",
  },
  {
    id: "watch",
    title: "What to watch",
    rows: () => [],
    mode: "code",
    guidance: "",
  },
];

export interface ReportSection {
  id: string;
  title: string;
  headline: string | null;
  bullets: string[];
  rows?: FactRow[];
  paragraphs: string[];
  grounded_in: string[];
  value_status: "AVAILABLE" | "UNAVAILABLE";
  reason_codes: string[];
}

function sectionOf(
  spec: SectionSpec,
  parts: Partial<Pick<ReportSection, "headline" | "bullets" | "rows" | "grounded_in" | "value_status" | "reason_codes">>
): ReportSection {
  const headline = parts.headline ?? null;
  const bullets = parts.bullets ?? [];
  return {
    id: spec.id,
    title: spec.title,
    headline,
    bullets,
    rows: parts.rows,
    paragraphs: headline ? [headline, ...bullets] : [],
    grounded_in: parts.grounded_in ?? [],
    value_status: parts.value_status ?? "AVAILABLE",
    reason_codes: parts.reason_codes ?? [],
  };
}

function auditTrail(rows: FactRow[], allowed: Set<string>): string[] {
  return [...new Set(rows.flatMap((r) => r.paths))].filter((p) => allowed.has(p));
}

async function generateSection(
  pkg: PortfolioPackage,
  spec: SectionSpec,
  allowed: Set<string>
): Promise<ReportSection> {
  if (spec.mode === "code") {
    const watch = watchRows(pkg);
    if (!watch.headline) return sectionOf(spec, { rows: [], value_status: "UNAVAILABLE", reason_codes: ["NOTHING_TO_WATCH"] });
    return sectionOf(spec, {
      headline: watch.headline,
      bullets: watch.bullets,
      rows: watch.rows,
      grounded_in: auditTrail(watch.rows, allowed),
    });
  }

  const rows = spec.rows(pkg);
  if (rows.length === 0) {
    return sectionOf(spec, { rows: [], value_status: "UNAVAILABLE", reason_codes: ["NO_AVAILABLE_FIGURES"] });
  }

  const grounded_in = auditTrail(rows, allowed);
  try {
    const reading = await writeReading({
      rules: RULES,
      meta: { section: spec.title, as_of: pkg.as_of },
      rows,
      guidance: spec.guidance,
      extraAllowed: [pkg.as_of],
    });
    return sectionOf(spec, { headline: reading.headline, bullets: reading.bullets, rows, grounded_in });
  } catch (err) {
    return sectionOf(spec, {
      rows,
      grounded_in,
      reason_codes: ["SUMMARY_UNAVAILABLE", err instanceof Error ? err.message : "unknown"],
    });
  }
}

export interface GeneratedPortfolioReport {
  sections: ReportSection[];
  sources: { endpoint: string; fetched_at: string; cached: boolean; credits: number }[];
}

export async function generatePortfolioReport(pkg: PortfolioPackage): Promise<GeneratedPortfolioReport> {
  const allowed = allowedPortfolioPaths(pkg);
  const sections = await Promise.all(SECTIONS.map((spec) => generateSection(pkg, spec, allowed)));

  const seen = new Set<string>();
  const sources = pkg.provenance
    .filter((entry) => {
      const key = `${entry.endpoint}|${entry.fetched_at}|${entry.cached}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry) => ({
      endpoint: entry.endpoint,
      fetched_at: entry.fetched_at,
      cached: entry.cached,
      credits: entry.credits,
    }));

  return { sections, sources };
}
