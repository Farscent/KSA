type RunState = "notRun" | "running" | "reviewRun";

interface RunReviewBarProps {
  state: RunState;
  onRun: () => void;
  holdingsCount: number;
}

export function RunReviewBar({ state, onRun, holdingsCount }: RunReviewBarProps) {
  if (state === "reviewRun") return null;

  return (
    <div
      className="flex flex-wrap-reverse items-center justify-between gap-5 border-b bg-[var(--color-card)] px-7 py-6.5"
      style={{ borderColor: "var(--color-line)" }}
    >
      {state === "notRun" && (
        <>
          <button
            onClick={onRun}
            className="cursor-pointer rounded-md px-5 py-2.5 font-medium text-[12.5px] text-white"
            style={{ background: "var(--color-accent)" }}
          >
            Run review
          </button>
          <div className="text-[12.5px]" style={{ color: "var(--color-muted)" }}>
            Review not yet run for {holdingsCount} holdings.
          </div>
        </>
      )}
      {state === "running" && (
        <>
          <div
            className="flex items-center gap-2.5 rounded-md px-5 py-2.5 font-medium text-[12.5px] text-white"
            style={{ background: "#c7cdd3" }}
          >
            <span className="animate-spin-fast inline-block h-3.5 w-3.5 rounded-full border-2 border-white/50" style={{ borderTopColor: "#fff" }} />
            Running{"…"}
          </div>
          <div className="text-[12.5px]" style={{ color: "var(--color-muted)" }}>
            Checking broker flow against baseline{"…"}
          </div>
        </>
      )}
    </div>
  );
}
