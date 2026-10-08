import type { NextRequest } from "next/server";

import { streamAnalystRun, type RunStreamEvent } from "@/lib/agent/stream";

/**
 * Streams one Run Analyst pass as Server-Sent Events: a `step` event per
 * research stage as it actually completes, then one final `result` event.
 *
 * POST, not GET: a run spends Sectors credits and writes rows, so it must not
 * be triggerable by a link or prefetch.
 *
 * Auth is unchanged from any other route here: `proxy.ts`'s matcher covers
 * `/api/*`, so the session cookie is refreshed the same way, and
 * `finishAnalystRun`'s `createClient()` reads that same cookie.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TICKER = /^[A-Z]{4}$/;

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { symbol?: unknown; runId?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("invalid body", { status: 400 });
  }

  const symbol = typeof body.symbol === "string" ? body.symbol.toUpperCase() : "";
  if (!TICKER.test(symbol)) return new Response("invalid symbol", { status: 400 });

  const runId = body.runId ?? null;
  if (runId !== null && (typeof runId !== "string" || !UUID.test(runId))) {
    return new Response("invalid runId", { status: 400 });
  }

  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: RunStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        for await (const event of streamAnalystRun(symbol, runId)) send(event);
      } catch (err) {
        send({
          type: "result",
          result: { ok: false, error: err instanceof Error ? err.message : "stream failed" },
        });
      } finally {
        if (!closed) controller.close();
      }
    },
    // The tab went away. Deliberately not aborting the run: the credits are
    // already spent, so it finishes and saves its report.
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
