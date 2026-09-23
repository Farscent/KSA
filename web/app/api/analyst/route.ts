import type { NextRequest } from "next/server";

import { streamAnalystRun, type RunStreamEvent } from "@/lib/agent/stream";

/**
 * Streams one Run Analyst pass as Server-Sent Events: a `step` event per
 * research stage as it actually completes, then one final `result` event
 * carrying the same shape `runAnalystForSymbol` used to return in one shot.
 *
 * Auth is unchanged from any other route here: `proxy.ts`'s matcher covers
 * `/api/*`, so the session cookie is refreshed the same way, and
 * `finishAnalystRun`'s `createClient()` reads that same cookie.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol");
  if (!symbol) return new Response("missing symbol", { status: 400 });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: RunStreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        for await (const event of streamAnalystRun(symbol)) send(event);
      } catch (err) {
        send({
          type: "result",
          result: { ok: false, error: err instanceof Error ? err.message : "stream failed" },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
