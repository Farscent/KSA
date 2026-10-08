"use client";

/**
 * Reads the `/api/analyst` SSE stream. Plain `fetch` + a manual reader rather
 * than `EventSource`: `EventSource` auto-reconnects when the server closes
 * the stream normally, which would silently re-run the whole pipeline — a
 * plain reader lets the loop end cleanly on the `result` event instead.
 */
import type { RunStreamEvent } from "@/lib/agent/stream";
import type { RunAnalystResult } from "@/lib/agent/actions";

export async function runAnalystStream(
  symbol: string,
  onEvent: (event: RunStreamEvent) => void
): Promise<RunAnalystResult> {
  const res = await fetch(`/api/analyst?symbol=${encodeURIComponent(symbol)}`);
  const reader = res.body?.getReader();
  if (!res.ok || !reader) return { ok: false, error: `Request failed (${res.status})` };

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (!part.startsWith("data: ")) continue;
      const event = JSON.parse(part.slice(6)) as RunStreamEvent;
      onEvent(event);
      if (event.type === "result") return event.result;
    }
  }

  return { ok: false, error: "Stream ended without a result." };
}
