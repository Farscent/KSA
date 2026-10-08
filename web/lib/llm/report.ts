import "server-only";

/**
 * The sectioned report.
 *
 * Each section is a fact table plus a short reading of it:
 *
 *   - the TABLE is built in code (lib/agent/display.ts) — every figure
 *     formatted, every comparison and status computed there;
 *   - the HEADLINE and BULLETS are written by the model, one call per section,
 *     fired concurrently, from those finished rows only;
 *   - the model's text is then checked in code (lib/llm/grounding.ts): a number
 *     that is not in the rows, or a phrase the compliance rules forbid, rejects
 *     the text and the section keeps its table with "summary not available".
 *
 * A section with no rows is not sent to the model at all — it is emitted as an
 * honest "not measurable". "What to watch" is built entirely in code from the
 * other sections' rows, so it cannot repeat them in prose.
 *
 * The Sources list is rendered in code from the provenance ledger, never
 * written by the model.
 */

import { allowedGroundedPaths, type ResearchPackage } from "@/lib/agent/package";
import {
  balanceSheetRows,
  contextRows,
  macroRows,
  earningsQualityRows,
  flowRows,
  fundamentalsRows,
  positionRows,
  valuationRows,
  watchSummary,
  type FactRow,
} from "@/lib/agent/display";
import { writeReading } from "@/lib/llm/reading";

const RULES = `You are writing the short reading of one section of a portfolio review report. You are
given ROWS: a table of already-computed facts for one stock position. Every figure in ROWS is
already formatted and already compared against its baseline or peers.

Write for an ordinary investor who does not know market jargon.

Hard rules:
- Quote any figure by copying its text EXACTLY as it appears in ROWS (same digits, same
  separators, same unit). Never reformat, round, convert, add, subtract or compare numbers
  yourself — the status column already did that. If a figure is not in ROWS, do not state it.
- Do not repeat the whole table. Say what it MEANS: the one or two things that stand out, and
  what is unremarkable. A reader will see the table directly under your text.
- Never state or imply a cause ("because of", "due to", "driven by") — ROWS has no causal
  information.
- Never give trading advice, a price target, a prediction, or a buy/sell recommendation.
  Figures marked as published by Sectors are third-party figures: say "Sectors reports", never
  present them as your own estimate.
- Never call any broker cohort "institutions" — a brokerage labeled institutional also serves
  retail clients. Say "distribution pressure" or just "brokers".
- Do not invent a combined score or overall level. Concentration, breadth and persistence are
  separate findings.
- Never say a missing figure is zero or none. If something is not in ROWS, leave it out.`;

export interface SectionSpec {
  id: string;
  title: string;
  /** Builds the fact table. An empty table makes the section UNAVAILABLE. */
  rows: (pkg: ResearchPackage) => FactRow[];
  /** What the model should say about the table. */
  guidance: string;
  /** "code" sections are built entirely without a model call. */
  mode: "model" | "code";
}

export const SECTIONS: SectionSpec[] = [
  {
    id: "position",
    title: "Your position",
    rows: positionRows,
    mode: "model",
    guidance:
      "State plainly what the holding is worth against what was paid, and whether it sits above or " +
      "below cost. One sentence for the headline; at most two bullets.",
  },
  {
    id: "flow_structure",
    title: "What changed underneath",
    rows: flowRows,
    mode: "model",
    guidance:
      "This is the most important section. In plain words: 'top brokers' share of selling' is how much " +
      "of all selling value came from the few biggest sellers; 'brokers that changed side' is how many " +
      "went from net buying to net selling; 'same direction' is how many sessions the flow pointed the " +
      "same way. Say which of the three moved against its own baseline and which did not, keeping them " +
      "SEPARATE — never one overall level. State whether broker data coverage was full. Headline: one " +
      "sentence. At most three bullets, one per component.",
  },
  {
    id: "fundamentals",
    title: "Fundamentals versus peers",
    rows: fundamentalsRows,
    mode: "model",
    guidance:
      "Say how the stock's valuation multiples compare with its peers and its subsector, and how fast " +
      "earnings and revenue are growing. If peers were excluded or none qualified, say so and why. " +
      "'P/E' means price relative to a year of earnings; 'P/B' means price relative to book value. " +
      "Headline: one sentence. At most three bullets.",
  },
  {
    id: "earnings_quality",
    title: "Earnings quality",
    rows: earningsQualityRows,
    mode: "model",
    guidance:
      "Say whether reported profit is backed by cash (free cash flow against net income) and whether " +
      "revenue and earnings grew or shrank over the full year. For a bank, say plainly that cash-flow " +
      "measures are not applicable. Do not give an overall quality verdict. Headline: one sentence. At " +
      "most three bullets.",
  },
  {
    id: "balance_sheet",
    title: "Balance sheet and capital",
    rows: balanceSheetRows,
    mode: "model",
    guidance:
      "For a company: say how heavy its debt is and whether profit comfortably covers interest, using " +
      "the stated bands. For a bank: report capital adequacy, loan-to-deposit, CASA and net interest " +
      "margin as figures Sectors publishes, without judging them good or bad. Headline: one sentence. At " +
      "most three bullets.",
  },
  {
    id: "valuation",
    title: "Valuation",
    rows: valuationRows,
    mode: "model",
    guidance:
      "Report what Sectors publishes — last close, forward P/E, its intrinsic-value figure, dividend " +
      "yield, analyst ratings and consensus estimates — as Sectors' figures with their dates, not as a " +
      "target. Note the gap between close and Sectors' intrinsic value only as a stated difference. " +
      "Headline: one sentence. At most three bullets.",
  },
  {
    id: "context",
    title: "Nearby context",
    rows: contextRows,
    mode: "model",
    guidance:
      "Say what kinds of items appear near the review date (news, filings, corporate actions) and " +
      "that they are shown for timing only and are NOT the cause of the flow pattern. Point out items " +
      "marked as not specific to this stock. Headline: one sentence. At most two bullets.",
  },
  {
    id: "macro",
    title: "Macro and policy backdrop",
    rows: macroRows,
    mode: "model",
    guidance:
      "Say which topics have headlines in the review window (interest rate policy, inflation, rupiah, " +
      "regulation) and the dates covered. State that these are third-party headlines shown for timing " +
      "only and are NOT the cause of the broker-flow pattern. Do not restate or interpret any figure " +
      "a headline might contain. Headline: one sentence. At most two bullets.",
  },
  {
    id: "risks",
    title: "What to watch",
    rows: () => [],
    mode: "code",
    guidance: "",
  },
];

export interface ReportSection {
  id: string;
  title: string;
  /** One-sentence reading of the table; null when the model's text was rejected or none was asked for. */
  headline: string | null;
  bullets: string[];
  /** The fact table, built in code. Absent on reports saved before this format. */
  rows?: FactRow[];
  /** `[headline, ...bullets]` — kept so older readers (overview, saved-run history) still work. */
  paragraphs: string[];
  /** Package paths the table was built from; derived from the rows, not cited by the model. */
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

function unavailableSection(spec: SectionSpec, ...reasons: string[]): ReportSection {
  return sectionOf(spec, { rows: [], value_status: "UNAVAILABLE", reason_codes: reasons });
}

function auditTrail(rows: FactRow[], allowed: Set<string>): string[] {
  return [...new Set(rows.flatMap((r) => r.paths))].filter((p) => allowed.has(p));
}

async function generateSection(pkg: ResearchPackage, spec: SectionSpec, allowed: Set<string>): Promise<ReportSection> {
  if (spec.mode === "code") {
    const watch = watchSummary(pkg);
    if (!watch.headline) return unavailableSection(spec, "NOTHING_TO_WATCH");
    return sectionOf(spec, {
      headline: watch.headline,
      bullets: watch.bullets,
      rows: watch.rows,
      grounded_in: auditTrail(watch.rows, allowed),
    });
  }

  const rows = spec.rows(pkg);
  // Nothing measurable: do not ask the model to write about data we do not have.
  if (rows.length === 0) return unavailableSection(spec, "NO_AVAILABLE_FIGURES");

  const grounded_in = auditTrail(rows, allowed);
  try {
    const reading = await writeReading({
      rules: RULES,
      meta: {
        section: spec.title,
        symbol: pkg.symbol,
        review_date: pkg.trade_date,
        broker_flow_triage_label: pkg.verdict,
      },
      rows,
      guidance: spec.guidance,
      extraAllowed: [pkg.trade_date],
    });
    return sectionOf(spec, { headline: reading.headline, bullets: reading.bullets, rows, grounded_in });
  } catch (err) {
    // The table is still real and still shown; only the prose is withheld.
    return sectionOf(spec, {
      rows,
      grounded_in,
      reason_codes: ["SUMMARY_UNAVAILABLE", err instanceof Error ? err.message : "unknown"],
    });
  }
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
