"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getRun } from "@/lib/data/source";

export function HeaderBar() {
  const pathname = usePathname();
  const run = getRun();
  const segments = pathname.split("/").filter(Boolean);
  const symbol = segments[0] && segments[0] !== "holdings" ? segments[0].toUpperCase() : null;
  const isPeers = segments[1] === "peers";

  return (
    <div
      className="flex items-center justify-between px-7 py-3.5"
      style={{ background: "var(--color-header)", color: "var(--color-header-fg)" }}
    >
      <div className="flex items-baseline gap-3.5">
        <span className="font-serif text-sm font-medium">Sectors Review</span>
        {!symbol && (
          <span
            className="font-mono text-[10.5px] uppercase"
            style={{ color: "var(--color-header-muted)", letterSpacing: "0.08em" }}
          >
            Portfolio review engine
          </span>
        )}
        {symbol && !isPeers && (
          <span className="font-mono text-[10.5px]" style={{ color: "var(--color-header-muted)" }}>
            Portfolio /{" "}
            <Link href="/" className="underline" style={{ color: "var(--color-header-muted)" }}>
              back
            </Link>{" "}
            / {symbol} / Evidence report
          </span>
        )}
        {symbol && isPeers && (
          <span className="font-mono text-[10.5px]" style={{ color: "var(--color-header-muted)" }}>
            Portfolio / {symbol} /{" "}
            <Link href={`/${symbol}`} className="underline" style={{ color: "var(--color-header-muted)" }}>
              back
            </Link>{" "}
            / Peer comparison
          </span>
        )}
      </div>
      <div className="flex items-center gap-5 font-mono text-[11.5px]" style={{ color: "var(--color-header-muted)" }}>
        <span>IDX {"·"} IDR</span>
        <span>Data {run.data_date}</span>
        <span style={{ color: "var(--color-header-fg)" }}>Rangga W.</span>
      </div>
    </div>
  );
}
