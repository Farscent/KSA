"use client";

/**
 * Reads the `/api/analyst` SSE stream. Plain `fetch` + a manual reader rather
 * than `EventSource`: `EventSource` auto-reconnects when the server closes
 * the stream normally, which would silently re-run the whole pipeline — a
 * plain reader lets the loop end cleanly on the `result` event instead.
 */
import type { RunStreamEvent } from "@/lib/agent/stream";
import type { RunAnalystResult } from "@/lib/agent/actions";

/**
 * Splits a buffer of SSE text into complete `data:` events plus the unfinished
 * remainder. Pure so frame splitting across network chunks can be tested.
 * A frame that is not valid JSON throws; the caller turns that into an error result.
 */
export function parseSseFrames(buffer: string): { events: RunStreamEvent[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: RunStreamEvent[] = [];
  for (const part of parts) {
    if (!part.startsWith("data: ")) continue;
    events.push(JSON.parse(part.slice(6)) as RunStreamEvent);
  }
  return { events, rest };
}

export async function runAnalystStream(
  symbol: string,
  onEvent: (event: RunStreamEvent) => void,
  /** Ties this report to the portfolio run it is part of; omit for a single-symbol run. */
  runId?: string
): Promise<RunAnalystResult> {
  try {
    const res = await fetch("/api/analyst", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, runId }),
    });

    // The auth proxy redirects a signed-out request to /login (an HTML page).
    const type = res.headers.get("content-type") ?? "";
    if (res.redirected || (res.ok && !type.includes("text/event-stream"))) {
      return { ok: false, error: "Session expired — sign in again." };
    }

    const reader = res.body?.getReader();
    if (!res.ok || !reader) return { ok: false, error: `Request failed (${res.status})` };

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const { events, rest } = parseSseFrames(buffer);
      buffer = rest;
      for (const event of events) {
        onEvent(event);
        if (event.type === "result") return event.result;
      }
    }

    return { ok: false, error: "Stream ended without a result." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Connection lost." };
  }
}
