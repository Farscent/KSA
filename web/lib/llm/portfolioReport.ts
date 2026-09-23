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

import { getLlmClient, LLM_MODEL } from "@/lib/llm/client";
import { allowedPortfolioPaths, type PortfolioPackage } from "@/lib/agent/portfolio";

const RULES = `You are writing one section of a portfolio-wide review report covering multiple
stock positions. You will be given DATA: a JSON package of already-computed numbers, plus
ALLOWED_PATHS: the exact list of field paths you are permitted to cite.

Hard rules:
- State only numbers that appear in DATA. Never estimate, infer, or recall a figure from
  outside DATA, even if you believe you know it.
- When writing a whole number with four or more digits in prose, format it with thousands
  separators (e.g. 6,400,000 not 6400000). Decimals and percentages keep their existing
  precision.
- Every number you state must correspond to one of ALLOWED_PATHS. If a figure is not in
  ALLOWED_PATHS, do not mention it, and do not say it is "zero" or "none" — omit it entirely.
- Concentration, breadth and persistence are three SEPARATE findings, per holding and across
  holdings. Never combine them into one score, one "risk level", or one ranked list of
  "riskiest holdings" — report which component moved for which holding, and state coverage
  alongside. If a holding's standouts data is empty for a component, do not imply it scored
  well on that component — say it was not among the largest movers this run, or, if the
  component is in not_measured for that symbol, say it could not be measured.
- Never state or imply a cause ("because of news", "due to earnings") — DATA has no causal
  information.
- Never give trading advice, a price target, or a buy/sell recommendation. Valuation figures
  are third-party figures published by Sectors: report them as "Sectors reports X", never as
  your own estimate or target.
- Never call any broker cohort "institutions" — a brokerage labeled institutional also serves
  retail clients. Use "distribution pressure" or the cohort names given instead.
- The verdict counts are triage labels (Healthy / Watch / Rebalance) describing how much
  broker-flow structure moved against each holding's own baseline — state them as observations,
  never instructions.`;

type BlockKey = keyof PortfolioPackage;

export interface SectionSpec {
  id: string;
  title: string;
  blocks: BlockKey[];
  words: number;
  guidance: string;
}

export const SECTIONS: SectionSpec[] = [
  {
    id: "overview",
    title: "Portfolio overview",
    blocks: ["totals", "verdict_counts", "as_of", "window_sessions"],
    words: 120,
    guidance:
      "Summarise the portfolio as reviewed: how many holdings, cost basis, market value and " +
      "unrealised P&L where available, and how the verdict counts split across Healthy/Watch/" +
      "Rebalance. State the as-of date.",
  },
  {
    id: "flow_across_holdings",
    title: "What changed underneath",
    blocks: ["standouts", "holdings"],
    words: 220,
    guidance:
      "This is the most important section. Report concentration, breadth and persistence as " +
      "three SEPARATE findings across the reviewed holdings, each against its own baseline. " +
      "Name which holdings' concentration/breadth/persistence stood out this run — using only " +
      "the standouts lists — without implying an overall severity. Never rank holdings by a " +
      "combined level.",
  },
  {
    id: "exposure",
    title: "Exposure",
    blocks: ["exposure", "holdings"],
    words: 150,
    guidance:
      "Describe how the portfolio's cost basis is distributed across subsectors, the largest " +
      "single position by portfolio weight, and how much of the portfolio's cost sits in " +
      "holdings whose market value could not be computed this run. This is capital allocation, " +
      "not a risk score.",
  },
  {
    id: "watch",
    title: "What to watch",
    blocks: ["standouts", "not_measured", "totals"],
    words: 150,
    guidance:
      "Name what a reviewer should keep an eye on, built strictly from measured figures already " +
      "in DATA — including which holdings and which components could NOT be measured this run, " +
      "from not_measured. Do not invent watch items no figure supports.",
  },
];

export interface ReportSection {
  id: string;
  title: string;
  paragraphs: string[];
  grounded_in: string[];
  value_status: "AVAILABLE" | "UNAVAILABLE";
  reason_codes: string[];
}

function projectForSection(pkg: PortfolioPackage, spec: SectionSpec): Record<string, unknown> {
  const subset: Record<string, unknown> = {};
  for (const key of spec.blocks) subset[key] = pkg[key];
  return subset;
}

function pathsForSection(all: Set<string>, spec: SectionSpec): string[] {
  const prefixes = spec.blocks.map(String);
  return [...all].filter((path) => prefixes.includes(path.split(".")[0]));
}

interface SectionResult {
  paragraphs: string[];
  grounded_in: string[];
}

function validateSection(result: unknown, allowed: Set<string>): SectionResult {
  if (!result || typeof result !== "object") throw new Error("malformed section shape");
  const { paragraphs, grounded_in } = result as SectionResult;
  if (!Array.isArray(paragraphs) || !Array.isArray(grounded_in)) throw new Error("malformed section shape");
  if (paragraphs.length === 0 || paragraphs.some((p) => typeof p !== "string" || !p.trim())) {
    throw new Error("section paragraphs must be nonempty strings");
  }
  for (const path of grounded_in) {
    if (!allowed.has(path)) throw new Error(`section cited an ungrounded path: ${path}`);
  }
  return { paragraphs, grounded_in };
}

async function generateSection(
  pkg: PortfolioPackage,
  spec: SectionSpec,
  allowed: Set<string>
): Promise<ReportSection> {
  const sectionPaths = pathsForSection(allowed, spec);

  if (sectionPaths.length === 0) {
    return {
      id: spec.id,
      title: spec.title,
      paragraphs: [],
      grounded_in: [],
      value_status: "UNAVAILABLE",
      reason_codes: ["NO_AVAILABLE_FIGURES"],
    };
  }

  const allowedSet = new Set(sectionPaths);
  const user = JSON.stringify({
    DATA: projectForSection(pkg, spec),
    ALLOWED_PATHS: sectionPaths,
    section: spec.title,
    instructions:
      `${spec.guidance} Write at most ${spec.words} words. ` +
      'Reply with JSON: {"paragraphs": string[], "grounded_in": string[]}. ' +
      "grounded_in must be a subset of ALLOWED_PATHS, listing only the paths you actually cited.",
  });

  const client = getLlmClient();
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: LLM_MODEL,
        response_format: { type: "json_object" },
        temperature: 0.2,
        messages: [
          { role: "system", content: RULES },
          { role: "user", content: user },
        ],
      });
      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("empty response from model");
      const parsed = validateSection(JSON.parse(content), allowedSet);
      return {
        id: spec.id,
        title: spec.title,
        paragraphs: parsed.paragraphs,
        grounded_in: parsed.grounded_in,
        value_status: "AVAILABLE",
        reason_codes: [],
      };
    } catch (err) {
      lastError = err;
    }
  }

  return {
    id: spec.id,
    title: spec.title,
    paragraphs: [],
    grounded_in: [],
    value_status: "UNAVAILABLE",
    reason_codes: ["NARRATION_FAILED", lastError instanceof Error ? lastError.message : "unknown"],
  };
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
