import "server-only";

/**
 * Wraps `runPipeline` (an AsyncGenerator that already yields a real event per
 * research step) with the narration-and-save finish-up, so the streaming route
 * can forward every step event to the browser as it happens instead of only
 * returning once the whole run — pipeline plus LLM narration plus the
 * Supabase save — is done.
 */

import { runPipeline, type PipelineEvent } from "@/lib/agent/pipeline";
import { finishAnalystRun, type RunAnalystResult } from "@/lib/agent/actions";
import type { ResearchPackage } from "@/lib/agent/package";

export type RunStreamEvent = PipelineEvent | { type: "result"; result: RunAnalystResult };

const NARRATE_ID = "narrate";
const NARRATE_LABEL = "Writing report";

export async function* streamAnalystRun(symbol: string, runId: string | null = null): AsyncGenerator<RunStreamEvent> {
  const started = Date.now();
  let pkg: ResearchPackage | null = null;

  for await (const event of runPipeline(symbol)) {
    yield event;
    if (event.type === "done") pkg = event.package;
  }

  if (!pkg) {
    yield { type: "result", result: { ok: false, error: "pipeline produced no package" } };
    return;
  }

  // Narration and the save are the longest silent stretch. Stream-only: this is
  // not pushed into `pkg.steps`, so the saved trace is unchanged.
  yield { type: "step", id: NARRATE_ID, label: NARRATE_LABEL, status: "running" };
  const narrateStarted = Date.now();
  const result = await finishAnalystRun(pkg, started, runId);
  yield {
    type: "step",
    id: NARRATE_ID,
    label: NARRATE_LABEL,
    status: result.ok ? "done" : "failed",
    duration_ms: Date.now() - narrateStarted,
  };
  yield { type: "result", result };
}
