"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

/**
 * The six digits, after the password.
 *
 * Verification happens in the browser on purpose: `challengeAndVerify` returns
 * a new, stronger session, and the Supabase browser client is what writes that
 * session into the cookies the server then reads. Doing it in a server action
 * would verify the code and leave the browser holding the old, weaker session.
 *
 * The factor is looked up rather than passed in a URL, so there is nothing on
 * this page for somebody to substitute.
 */
export default function StaffVerifyPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await createClient().auth.mfa.listFactors();
      if (cancelled) return;
      setLoading(false);
      if (error) {
        setError("Could not reach the sign-in service. Reload in a moment.");
        return;
      }
      const usable = (data?.all ?? []).find((f) => f.status === "verified");
      // Nobody should arrive here without one, and if they do the answer is a
      // way forward rather than a page that cannot be satisfied.
      if (!usable) {
        router.replace("/staff/security");
        return;
      }
      setFactorId(usable.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (error) {
      setError("That code was not right. Codes last about a minute — wait for the next one and try again.");
      setCode("");
      return;
    }
    router.push("/staff");
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-4 surface p-6">
      <div>
        <h1 className="text-lg font-semibold">Enter your code</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Open the authenticator app on your phone and type the six digits it shows for Hibiscus.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="code">Six-digit code</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="font-mono text-lg tracking-[0.3em]"
          required
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={busy || loading || !factorId || code.length < 6}>
        {busy ? "Checking…" : "Continue"}
      </Button>
      <div className="space-y-1 text-center text-xs text-muted-foreground">
        <p>Lost the phone with your authenticator on it? Ask a super administrator to reset it under Set up → People.</p>
        {/* The way out. Without it this screen is a dead end for exactly the
            person who needs one: somebody whose device is gone, whose session
            still remembers the factor, and who has to start again once an
            administrator has cleared it. */}
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={async () => {
            await createClient().auth.signOut();
            router.push("/staff/login");
            router.refresh();
          }}
        >
          Sign out and start again
        </button>
      </div>
    </form>
  );
}
