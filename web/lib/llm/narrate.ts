import "server-only";
import { getLlmClient, LLM_MODEL } from "@/lib/llm/client";
import { allowedGroundedPaths, type AnalystPackage } from "@/lib/llm/package";

const RULES = `You are writing for a portfolio review tool. You will be given DATA: a JSON
package of already-computed numbers for one stock position, plus ALLOWED_PATHS: the exact
list of field paths you are permitted to cite.

Hard rules:
- State only numbers that appear in DATA. Never estimate, infer, or recall a figure from
  outside DATA, even if you believe you know it.
- Every number you state must correspond to one of ALLOWED_PATHS. If a figure is not in
  ALLOWED_PATHS (for example because its block is UNAVAILABLE), do not mention it, and do not
  say it is "zero" or "none" — omit it entirely.
- Never state or imply a cause ("because of news", "due to earnings") — DATA has no causal
  information.
- Never give trading advice, a price target, or a buy/sell recommendation. The "verdict" field
  in DATA is a triage label (Healthy / Watch / Rebalance) describing how much broker-flow
  structure moved against baseline — state it as an observation, not instruction.
- Never call any broker cohort "institutions" — a brokerage labeled institutional also serves
  retail clients. Use "distribution pressure" or the cohort names given (institutional/retail/
  mixed/unknown) instead.`;

interface NarrationResult {
  paragraphs: string[];
  grounded_in: string[];
}

function validateNarration(result: unknown, allowed: Set<string>): NarrationResult {
  if (
    !result ||
    typeof result !== "object" ||
    !Array.isArray((result as NarrationResult).paragraphs) ||
    !Array.isArray((result as NarrationResult).grounded_in)
  ) {
    throw new Error("malformed narration shape");
  }
  const { paragraphs, grounded_in } = result as NarrationResult;
  if (paragraphs.length === 0 || paragraphs.some((p) => typeof p !== "string" || !p.trim())) {
    throw new Error("narration paragraphs must be nonempty strings");
  }
  for (const path of grounded_in) {
    if (!allowed.has(path)) {
      throw new Error(`narration cited an ungrounded path: ${path}`);
    }
  }
  return { paragraphs, grounded_in };
}

async function chatJson(system: string, user: string): Promise<unknown> {
  const client = getLlmClient();
  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    response_format: { type: "json_object" },
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("empty response from model");
  return JSON.parse(content);
}

/**
 * Generates serve_narrative-shaped output (paragraphs + grounded_in) for one
 * symbol's already-computed package. Retries once on a malformed or
 * ungrounded response before giving up — a caller must never fall back to
 * showing the raw error text as if it were narration.
 */
export async function generateNarrative(pkg: AnalystPackage): Promise<NarrationResult> {
  const allowed = allowedGroundedPaths(pkg);
  const user = JSON.stringify({
    DATA: pkg,
    ALLOWED_PATHS: Array.from(allowed),
    instructions:
      'Reply with JSON: {"paragraphs": string[], "grounded_in": string[]}. ' +
      "2-3 short paragraphs. grounded_in must be a subset of ALLOWED_PATHS, listing only the " +
      "paths you actually cited.",
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await chatJson(RULES, user);
      return validateNarration(raw, allowed);
    } catch (err) {
      if (attempt === 1) throw err;
    }
  }
  throw new Error("unreachable");
}

/**
 * Answers a follow-up question grounded only in the same saved package the
 * report was built from — never new data, per the Ask panel's existing rule.
 *
 * `pkg` is typed loosely because it is read back out of `agent_runs.package`
 * as JSON: it is whatever package that run actually saved (today a
 * ResearchPackage, previously an AnalystPackage). Both are already-computed
 * figures, which is the only property this function depends on.
 */
export async function answerFollowUp(
  question: string,
  pkg: AnalystPackage | unknown,
  priorThread: { q: string; a: string }[]
): Promise<string> {
  const client = getLlmClient();
  const historyText = priorThread.map((t) => `Q: ${t.q}\nA: ${t.a}`).join("\n\n");
  const user = JSON.stringify({
    DATA: pkg,
    prior_thread: historyText || null,
    question,
    instructions:
      "Answer the question in 1-3 sentences using only DATA. If the answer isn't in DATA, say " +
      "so plainly rather than guessing. Reply with plain text, not JSON.",
  });

  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: RULES },
      { role: "user", content: user },
    ],
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) throw new Error("empty response from model");
  return content;
}
