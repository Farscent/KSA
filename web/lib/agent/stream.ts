import "server-only";

/**
 * Wraps `runPipeline` (an AsyncGenerator that already yields a real event per
 * research step) with the same narration-and-save finish-up
 * `runAnalystForSymbol` uses, so the streaming route below can forward every
 * step event to the browser as it happens instead of only returning once the
 * whole run — pipeline plus LLM narration plus the Supabase save — is done.
 */

import { runPipeline, type PipelineEvent } from "@/lib/agent/pipeline";
import { finishAnalystRun, type RunAnalystResult } from "@/lib/agent/actions";
import type { ResearchPackage } from "@/lib/agent/package";

export type RunStreamEvent = PipelineEvent | { type: "result"; result: RunAnalystResult };

export async function* streamAnalystRun(symbol: string): AsyncGenerator<RunStreamEvent> {
  const started = Date.now();
  let pkg: ResearchPackage | null = null;

  for await (const event of runPipeline(symbol)) {
    yield event;
    if (event.type === "done") pkg = event.package;
  }

  const result = pkg
    ? await finishAnalystRun(pkg, started)
    : ({ ok: false, error: "pipeline produced no package" } as const);
  yield { type: "result", result };
}
