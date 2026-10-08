import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseSseFrames } from "@/lib/agent/streamClient";

vi.mock("server-only", () => ({}));

const runPipeline = vi.fn();
const finishAnalystRun = vi.fn();
vi.mock("@/lib/agent/pipeline", () => ({ runPipeline: (...a: unknown[]) => runPipeline(...a) }));
vi.mock("@/lib/agent/actions", () => ({ finishAnalystRun: (...a: unknown[]) => finishAnalystRun(...a) }));

const frame = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

describe("parseSseFrames", () => {
  it("keeps a frame split across two chunks until it completes", () => {
    const whole = frame({ type: "step", id: "a", label: "A", status: "running" });
    const first = parseSseFrames(whole.slice(0, 20));
    expect(first.events).toEqual([]);
    const second = parseSseFrames(first.rest + whole.slice(20));
    expect(second.events).toHaveLength(1);
    expect(second.rest).toBe("");
  });

  it("returns several frames from one chunk and keeps the trailing partial", () => {
    const buf = frame({ type: "step", id: "a" }) + frame({ type: "step", id: "b" }) + "data: {\"ty";
    const { events, rest } = parseSseFrames(buf);
    expect(events.map((e) => (e as { id: string }).id)).toEqual(["a", "b"]);
    expect(rest).toBe('data: {"ty');
  });

  it("ignores non-data lines", () => {
    expect(parseSseFrames(": keepalive\n\n").events).toEqual([]);
  });

  it("throws on malformed JSON so the caller can report it", () => {
    expect(() => parseSseFrames("data: {nope\n\n")).toThrow();
  });
});

describe("streamAnalystRun", () => {
  beforeEach(() => {
    runPipeline.mockReset();
    finishAnalystRun.mockReset();
  });

  async function collect(gen: AsyncGenerator<unknown>) {
    const out: Array<Record<string, unknown>> = [];
    for await (const e of gen) out.push(e as Record<string, unknown>);
    return out;
  }

  it("emits steps, then a narrate step pair, then the result", async () => {
    const pkg = { symbol: "BBCA" };
    runPipeline.mockImplementation(async function* () {
      yield { type: "step", id: "s1", label: "S1", status: "done" };
      yield { type: "done", package: pkg };
    });
    finishAnalystRun.mockResolvedValue({ ok: true, report: {} });

    const { streamAnalystRun } = await import("@/lib/agent/stream");
    const events = await collect(streamAnalystRun("BBCA", null));

    expect(events.map((e) => [e.type, e.id ?? "", e.status ?? ""])).toEqual([
      ["step", "s1", "done"],
      ["done", "", ""],
      ["step", "narrate", "running"],
      ["step", "narrate", "done"],
      ["result", "", ""],
    ]);
    expect(finishAnalystRun).toHaveBeenCalledWith(pkg, expect.any(Number), null);
  });

  it("marks narrate failed when the finish-up fails", async () => {
    runPipeline.mockImplementation(async function* () {
      yield { type: "done", package: { symbol: "BBCA" } };
    });
    finishAnalystRun.mockResolvedValue({ ok: false, error: "boom" });

    const { streamAnalystRun } = await import("@/lib/agent/stream");
    const events = await collect(streamAnalystRun("BBCA"));
    expect(events.find((e) => e.id === "narrate" && e.status === "failed")).toBeTruthy();
  });

  it("returns an error result when the pipeline never produces a package", async () => {
    runPipeline.mockImplementation(async function* () {
      yield { type: "step", id: "s1", label: "S1", status: "failed" };
    });

    const { streamAnalystRun } = await import("@/lib/agent/stream");
    const events = await collect(streamAnalystRun("BBCA"));
    const last = events[events.length - 1];
    expect(last).toEqual({ type: "result", result: { ok: false, error: "pipeline produced no package" } });
    expect(finishAnalystRun).not.toHaveBeenCalled();
  });
});
