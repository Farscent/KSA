import "server-only";

/**
 * The sectioned report.
 *
 * One LLM call per section, fired concurrently, each one seeing only the
 * package blocks its section is allowed to read and only the grounded paths
 * that survive `allowedGroundedPaths`. A section whose blocks are all
 * UNAVAILABLE is not sent to the model at all — it is emitted as an honest
 * "not measurable" rather than invited to be filled with prose.
 *
 * The Sources section is rendered in code from the provenance ledger, never
 * written by the model.
 */

import { getLlmClient, LLM_MODEL } from "@/lib/llm/client";
import { allowedGroundedPaths, type ResearchPackage } from "@/lib/agent/package";

/**
 * Carried over verbatim from the original narration prompt. The price-target
 * prohibition stays: we report Sectors' own published figures with
 * attribution, so nothing here needs relaxing.
 */
const RULES = `You are writing one section of a portfolio review report. You will be given DATA:
a JSON package of already-computed numbers for one stock position, plus ALLOWED_PATHS: the
exact list of field paths you are permitted to cite.

Hard rules:
- State only numbers that appear in DATA. Never estimate, infer, or recall a figure from
  outside DATA, even if you believe you know it.
- When writing a whole number with four or more digits in prose, format it with thousands
  separators (e.g. 6,400,000 not 6400000). Decimals such as 13.06 and percentages keep their
  existing precision.
- Every number you state must correspond to one of ALLOWED_PATHS. If a figure is not in
  ALLOWED_PATHS (for example because its block is UNAVAILABLE), do not mention it, and do not
  say it is "zero" or "none" — omit it entirely.
- Never state or imply a cause ("because of news", "due to earnings") — DATA has no causal
  information.
- Never give trading advice, a price target, or a buy/sell recommendation. Valuation figures
  such as intrinsic value or analyst ratings are third-party figures published by Sectors:
  report them as "Sectors reports X, as of <date>", never as your own estimate or target.
- Never call any broker cohort "institutions" — a brokerage labeled institutional also serves
  retail clients. Use "distribution pressure" or the cohort names given (institutional/retail/
  mixed/unknown) instead.
- The verdict field is a triage label (Healthy / Watch / Rebalance) describing how much
  broker-flow structure moved against baseline — state it as an observation, not instruction.`;

type BlockKey = keyof ResearchPackage;

export interface SectionSpec {
  id: string;
  title: string;
  /** Package keys this section may read. Everything else is withheld. */
  blocks: BlockKey[];
  words: number;
  guidance: string;
}

export const SECTIONS: SectionSpec[] = [
  {
    id: "position",
    title: "Position and identity",
    blocks: ["position", "identity"],
    words: 110,
    guidance:
      "Describe the holding and the issuer: lots, average price, cost basis, market value and " +
      "unrealised P&L where available, plus what the company is and which subsector it sits in.",
  },
  {
    id: "flow_structure",
    title: "What changed underneath",
    blocks: ["flow"],
    words: 200,
    guidance:
      "This is the most important section. Report concentration, breadth and persistence " +
      "SEPARATELY, each against its own baseline, and state the data-coverage figure alongside " +
      "them. Never combine them into one severity score or imply an overall level. Say plainly " +
      "which component moved and which did not.",
  },
  {
    id: "fundamentals",
    title: "Fundamentals versus peers",
    blocks: ["financials", "peers", "peer_metrics", "subsector"],
    words: 180,
    guidance:
      "Compare the holding's ratios against the eligible-peer median and the subsector median, " +
      "keeping those two distinct. State how many peers were screened and how many were excluded; " +
      "if peers were excluded, say why. If no peer qualified, say so plainly rather than comparing " +
      "against an unsuitable set.",
  },
  {
    id: "valuation",
    title: "Valuation",
    blocks: ["valuation", "valuation_metrics", "future", "dividend"],
    words: 170,
    guidance:
      "Report Sectors' published valuation figures with attribution and their as-of date: last " +
      "close, forward P/E, intrinsic value, growth forecasts, dividend yield and the analyst " +
      "rating breakdown. These are third-party figures, not our estimates, and not a target price.",
  },
  {
    id: "context",
    title: "Nearby context",
    blocks: ["context"],
    words: 130,
    guidance:
      "List recent news, filings and corporate actions as context near the review date. State " +
      "explicitly that these are shown for timing context only and are not causes of the flow " +
      "pattern. Where an item tags many symbols, note that it is not specific to this holding.",
  },
  {
    id: "risks",
    title: "What to watch",
    blocks: ["flow", "peer_metrics", "valuation_metrics", "position"],
    words: 140,
    guidance:
      "Name what a holder should keep an eye on, built strictly from measured figures already in " +
      "DATA — including what could NOT be measured and therefore remains unknown. Do not invent " +
      "risks that no figure supports.",
  },
];

export interface ReportSection {
  id: string;
  title: string;
  /** Paragraphs, or empty when the section had nothing measurable to say. */
  paragraphs: string[];
  grounded_in: string[];
  value_status: "AVAILABLE" | "UNAVAILABLE";
  reason_codes: string[];
}

function projectForSection(pkg: ResearchPackage, spec: SectionSpec): Record<string, unknown> {
  const subset: Record<string, unknown> = {
    symbol: pkg.symbol,
    trade_date: pkg.trade_date,
    verdict: pkg.verdict,
  };
  for (const key of spec.blocks) subset[key] = pkg[key];
  return subset;
}

/** Paths from the global whitelist that belong to this section's blocks. */
function pathsForSection(all: Set<string>, spec: SectionSpec): string[] {
  const prefixes = spec.blocks.map(String);
  return [...all].filter((path) => {
    const head = path.split(".")[0];
    // Broker-flow paths keep their contract names (serve_components.*), which
    // do not match the package key "flow".
    if (prefixes.includes("flow") && head.startsWith("serve_")) return true;
    return prefixes.includes(head);
  });
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

async function generateSection(pkg: ResearchPackage, spec: SectionSpec, allowed: Set<string>): Promise<ReportSection> {
  const sectionPaths = pathsForSection(allowed, spec);

  // Nothing measurable in this section's blocks: do not ask the model to write
  // about data we do not have.
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
  // Bounded retry, recipe 03's shape: try twice, then degrade to an honest
  // UNAVAILABLE rather than failing the whole report.
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

export interface GeneratedReport {
  sections: ReportSection[];
  /** Built in code from the ledger — the model never writes this. */
  sources: { endpoint: string; fetched_at: string; cached: boolean; credits: number }[];
}

export async function generateReport(pkg: ResearchPackage): Promise<GeneratedReport> {
  const allowed = allowedGroundedPaths(pkg);
  const sections = await Promise.all(SECTIONS.map((spec) => generateSection(pkg, spec, allowed)));

  return {
    sections,
    sources: pkg.provenance.map((entry) => ({
      endpoint: entry.endpoint,
      fetched_at: entry.fetched_at,
      cached: entry.cached,
      credits: entry.credits,
    })),
  };
}
