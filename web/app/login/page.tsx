"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DisclaimerFooter } from "@/components/DisclaimerFooter";

export default function LoginPage() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setPending(false);
    }
  }

  return (
    <div
      className="w-full overflow-hidden rounded-[10px] border"
      style={{
        maxWidth: 420,
        background: "var(--color-surface)",
        borderColor: "var(--color-line)",
        boxShadow: "0 1px 3px rgba(0,0,0,.05)",
      }}
    >
      <div className="flex flex-col items-center gap-2 px-8 py-9 text-center">
        <span className="font-serif text-lg font-medium">Sectors Review</span>
        <span
          className="font-mono text-[10.5px] uppercase"
          style={{ color: "var(--color-muted, #6b7280)", letterSpacing: "0.08em" }}
        >
          Portfolio review engine
        </span>
        <p className="mt-3 text-sm" style={{ color: "var(--color-muted, #4b5563)" }}>
          Sign in to review evidence of structural anomalies underneath your holdings.
        </p>
        <button
          type="button"
          onClick={signInWithGoogle}
          disabled={pending}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition disabled:opacity-60"
          style={{ borderColor: "var(--color-line)" }}
        >
          {pending ? "Redirecting…" : "Continue with Google"}
        </button>
        {error && (
          <p className="mt-3 text-xs" style={{ color: "#b91c1c" }}>
            {error}
          </p>
        )}
      </div>
      <DisclaimerFooter />
    </div>
  );
}
