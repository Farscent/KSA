import "server-only";

/**
 * One model call that turns a finished fact table into a headline and a few
 * bullets, then checks the text in code before accepting it.
 *
 * Shared by the per-symbol report (lib/llm/report.ts) and the portfolio
 * summary (lib/llm/portfolioReport.ts) so both enforce the same contract:
 * the model sees formatted rows only, copies figures verbatim, and any number
 * or phrase that fails lib/llm/grounding.ts rejects the text. Two attempts,
 * the second told exactly what was wrong; after that the caller keeps the
 * table and withholds the prose.
 */

import { getLlmClient, LLM_MODEL } from "@/lib/llm/client";
import { allowedTokens, checkProse } from "@/lib/llm/grounding";
import type { FactRow } from "@/lib/agent/display";

export interface Reading {
  headline: string;
  bullets: string[];
}

function parseReading(content: string): Reading {
  const parsed: unknown = JSON.parse(content);
  if (!parsed || typeof parsed !== "object") throw new Error("malformed reading shape");
  const { headline, bullets } = parsed as { headline?: unknown; bullets?: unknown };
  if (typeof headline !== "string" || !headline.trim()) throw new Error("headline must be a nonempty string");
  const list = Array.isArray(bullets) ? bullets : [];
  if (list.some((b) => typeof b !== "string" || !b.trim())) throw new Error("bullets must be nonempty strings");
  return { headline: headline.trim(), bullets: (list as string[]).map((b) => b.trim()).slice(0, 3) };
}

export interface ReadingRequest {
  /** The system prompt (rules). */
  rules: string;
  /** Section title and any identifying context, passed through to the model as-is. */
  meta: Record<string, string>;
  rows: FactRow[];
  guidance: string;
  /** Strings whose numbers the model may also quote (e.g. the review date). */
  extraAllowed?: string[];
}

export async function writeReading({ rules, meta, rows, guidance, extraAllowed = [] }: ReadingRequest): Promise<Reading> {
  const shown = rows.map(({ label, value, compare, status, period }) => ({ label, value, compare, status, period }));
  const allowed = allowedTokens([
    ...extraAllowed,
    ...Object.values(meta),
    ...shown.flatMap((r) => [r.label, r.value, r.compare, r.status, r.period]),
  ]);

  const client = getLlmClient();
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const user = JSON.stringify({
      ...meta,
      ROWS: shown,
      instructions:
        `${guidance} ` +
        'Reply with JSON: {"headline": string, "bullets": string[]}. The headline is one sentence of at ' +
        "most 30 words; each bullet is at most 30 words." +
        (problems.length > 0
          ? ` Your previous answer was rejected: ${problems.join("; ")}. Rewrite it using only figures copied exactly from ROWS.`
          : ""),
    });

    const response = await client.chat.completions.create({
      model: LLM_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { role: "system", content: rules },
        { role: "user", content: user },
      ],
    });
    const content = response.choices[0]?.message?.content;
    if (!content) {
      problems = ["empty response"];
      continue;
    }

    let reading: Reading;
    try {
      reading = parseReading(content);
    } catch (err) {
      problems = [err instanceof Error ? err.message : "malformed answer"];
      continue;
    }

    const check = checkProse([reading.headline, ...reading.bullets], allowed);
    if (check.ok) return reading;
    problems = check.problems;
  }
  throw new Error(problems.join("; ") || "no usable reading");
}
