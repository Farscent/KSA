/**
 * Code-level checks on what the model wrote, run after every narrated section.
 *
 * The model is shown fact rows whose values are already formatted strings and
 * is told to copy figures verbatim. That makes "is this number real?" an exact
 * string question rather than a numeric one: any number in the prose that does
 * not appear in the rows it was shown is one the model computed, recalled or
 * invented, and the section is rejected.
 *
 * Method borrowed from ticker-dossier's `_numbers_grounded` /
 * `_redact_ungrounded_numbers` (MIT); reimplemented here against formatted
 * strings instead of raw floats. See docs/third-party-notices.md.
 *
 * No `server-only` import: these are pure functions and are unit-tested.
 */

/** Digits with optional `.`/`,` groups: "6.585.000", "56,9", "2026", "07". */
const NUMBER_TOKEN = /\d+(?:[.,]\d+)*/g;

export function numberTokens(text: string): string[] {
  return text.match(NUMBER_TOKEN) ?? [];
}

/** Whole numbers 0-10 are allowed without a source: "2 of 4", "three measures". */
function isSmallInteger(token: string): boolean {
  return /^\d{1,2}$/.test(token) && Number(token) <= 10;
}

/** Collects every number token appearing in any of the given strings. */
export function allowedTokens(strings: Array<string | null | undefined>): Set<string> {
  const allowed = new Set<string>();
  for (const s of strings) {
    if (!s) continue;
    for (const token of numberTokens(s)) allowed.add(token);
  }
  return allowed;
}

/** Number tokens in `text` that are not in `allowed` (and not a small integer). */
export function ungroundedNumbers(text: string, allowed: Set<string>): string[] {
  const bad: string[] = [];
  for (const token of numberTokens(text)) {
    if (allowed.has(token) || isSmallInteger(token)) continue;
    bad.push(token);
  }
  return [...new Set(bad)];
}

/**
 * Phrases the system prompt already forbids, checked again in code because a
 * prompt is a request and this is a guarantee. Each entry is a rule from
 * CLAUDE.md's compliance section or lib/llm/report.ts's RULES.
 */
const BANNED: { pattern: RegExp; rule: string }[] = [
  { pattern: /\binstitution(s|al)?\b/i, rule: 'never describe a broker cohort as "institutions"' },
  { pattern: /\b(because of|due to|caused by|as a result of|owing to)\b/i, rule: "no causal claims" },
  { pattern: /\b(price target|target price|fair value)\b/i, rule: "no price targets" },
  { pattern: /\b(you|we|investors?)\s+(should|must|ought to)\b/i, rule: "no instructions" },
  { pattern: /\b(should|must)\s+(buy|sell|hold|trim|add|exit|rebalance)\b/i, rule: "no trading advice" },
  // "Sectors reports N buy ratings" is attribution, not advice, so a bare
  // "buy rating" is allowed; only the model issuing the call is not.
  { pattern: /\b(we|i)\s+(recommend|rate|advise|suggest)\b/i, rule: "no trading advice" },
  { pattern: /\b(will|is going to|expected to)\s+(rise|fall|drop|rally|increase|decrease|outperform)\b/i, rule: "no price prediction" },
];

export function proseViolations(text: string): string[] {
  return BANNED.filter(({ pattern }) => pattern.test(text)).map(({ rule }) => rule);
}

export interface ProseCheck {
  ok: boolean;
  problems: string[];
}

/** Runs both checks over every string the model returned for a section. */
export function checkProse(texts: string[], allowed: Set<string>): ProseCheck {
  const problems: string[] = [];
  for (const text of texts) {
    const bad = ungroundedNumbers(text, allowed);
    if (bad.length > 0) problems.push(`numbers not in the fact rows: ${bad.join(", ")}`);
    for (const rule of proseViolations(text)) problems.push(rule);
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}
