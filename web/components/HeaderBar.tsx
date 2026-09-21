"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useResults } from "@/lib/data/ResultsProvider";
import { createClient } from "@/lib/supabase/client";

export function HeaderBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { run } = useResults();
  const [userLabel, setUserLabel] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      setUserLabel((user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? null);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user;
      setUserLabel((user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? null);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }
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
        <span>Data {run ? run.data_date : "not yet ingested"}</span>
        {userLabel && <span style={{ color: "var(--color-header-fg)" }}>{userLabel}</span>}
        <button
          type="button"
          onClick={signOut}
          className="underline"
          style={{ color: "var(--color-header-muted)" }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
