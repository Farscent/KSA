import { getRun } from "@/lib/data/source";
import { signedIdr } from "@/lib/format";
import type { Totals } from "@/lib/portfolio";

/**
 * Keyword matching over figures already rendered on the current screen — not
 * an LLM call. Per docs/serve-contract-1.1.md's serve_narrative and
 * CLAUDE.md's "LLM never sees raw data and never does math" rule, this is a
 * placeholder that will be replaced by real narration without changing the
 * rule it enforces: an answer here must never state a number that isn't
 * already visible on this page.
 */
export function answerFor(question: string, totals: Totals, flaggedSymbols: string[]): string {
  const q = question.toLowerCase();
  const run = getRun();

  if (q.includes("flag")) {
    if (flaggedSymbols.length === 0) {
      return "No holdings are flagged this run. A flag means broker-flow structure moved outside that symbol's own baseline window — it is not a buy or sell signal.";
    }
    return `${flaggedSymbols.length === 1 ? "One holding is" : `${flaggedSymbols.length} holdings are`} flagged this run: ${flaggedSymbols.join(", ")}. A flag means broker-flow structure moved outside that symbol's own ${run.window.sessions}-session baseline window — it is not a buy or sell signal.`;
  }
  if (q.includes("cover")) {
    return `Coverage measures the share of traded value the engine could match to a broker cohort (institutional, retail, or mixed). The remaining share falls in the unknown cohort and is shown as unavailable, never zero. This run has ${run.cohorts_unavailable} cohort record(s) unavailable.`;
  }
  if (q.includes("p&l") || q.includes("pnl") || q.includes("loss") || q.includes("gain")) {
    if (totals.pl === null) {
      return "Unrealized P&L is unavailable this run because at least one holding's current close price hasn't been ingested yet — it is never shown as zero in that case.";
    }
    return `Unrealized P&L is ${signedIdr(totals.pl)} — market value minus cost basis across your ${totals.totalCount} holdings. It is a paper figure only; nothing has been sold.`;
  }
  return 'This result only reports on observed broker-flow structure for your current holdings. Ask about "flagged", "coverage", or "P&L" and I\'ll point to the exact figures behind them.';
}
