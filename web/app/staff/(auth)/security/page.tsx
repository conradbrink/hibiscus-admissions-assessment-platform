"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

/**
 * Setting up an authenticator app, and taking one off.
 *
 * It sits in the (auth) group rather than the console because it has to work
 * while the console is closed: somebody the school now requires a factor of
 * cannot reach any console page until they have one, so the page that gives
 * them one must not be behind that gate.
 *
 * In the browser for the same reason as the verify screen — enrolling promotes
 * the session to aal2, and the browser client is what writes the new session
 * into cookies.
 *
 * Removing is the half that matters for security, and it is gated twice: this
 * page is unreachable at aal1 for anybody who already has a factor (see
 * lib/staff/mfa.ts, `mfaPathAllowed`), and `unenroll` itself is refused by
 * Supabase unless the session is aal2. A stolen password therefore cannot undo
 * the protection: it can neither open this page nor complete the removal.
 */

type Factor = { id: string; status: string; friendly_name?: string | null };

export default function StaffSecurityPage() {
  const router = useRouter();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [list, aal] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    if (list.error || aal.error) {
      setError("Could not reach the sign-in service. Reload in a moment.");
      return;
    }
    setFactors((list.data?.all ?? []) as Factor[]);
    setLevel(aal.data?.currentLevel ?? null);
  }, []);

  // The first read is written out here rather than calling `load`, because a
  // hook rule (rightly) objects to an effect that sets state straight away:
  // the cancelled flag is what stops a reply arriving after the page has gone.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [list, aal] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);
      if (cancelled) return;
      if (list.error || aal.error) {
        setError("Could not reach the sign-in service. Reload in a moment.");
        setFactors([]);
        return;
      }
      setFactors((list.data?.all ?? []) as Factor[]);
      setLevel(aal.data?.currentLevel ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const verified = (factors ?? []).filter((f) => f.status === "verified");

  const startEnrol = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    const supabase = createClient();
    // An abandoned attempt leaves an unverified factor behind. Clearing them
    // first keeps the account tidy and avoids a pile of half-enrolments that
    // nobody can satisfy.
    for (const stale of (factors ?? []).filter((f) => f.status !== "verified")) {
      await supabase.auth.mfa.unenroll({ factorId: stale.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
    setBusy(false);
    if (error || !data) {
      setError("Could not start setting up an authenticator. Reload and try again.");
      return;
    }
    setEnrolling({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };

  const finishEnrol = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrolling) return;
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId: enrolling.id, code: code.trim() });
    setBusy(false);
    if (error) {
      setError("That code was not right. Codes last about a minute — wait for the next one and try again.");
      setCode("");
      return;
    }
    setEnrolling(null);
    setCode("");
    setNote("Your authenticator is set up. You will be asked for a code each time you sign in.");
    await load();
    router.refresh();
  };

  const remove = async (factorId: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    const { error } = await createClient().auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (error) {
      setError("Could not remove it. Sign out, sign in with your code, and try again.");
      return;
    }
    setNote("Removed. Your password is now the only thing protecting this account.");
    await load();
    router.refresh();
  };

  return (
    <div className="space-y-4 surface p-6">
      <div>
        <h1 className="text-lg font-semibold">My security</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          An authenticator app puts a second lock on your account: a six-digit code, from your phone, that changes every
          minute. Without it, your password is the only thing standing between a stranger and every family&rsquo;s details.
        </p>
      </div>

      {factors === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : enrolling ? (
        <form onSubmit={finishEnrol} className="space-y-4">
          <ol className="space-y-3 text-sm">
            <li>
              <p className="font-medium">1. Open your authenticator app</p>
              <p className="text-muted-foreground">
                Google Authenticator, Microsoft Authenticator, 1Password and Authy all work. Choose &ldquo;scan a QR
                code&rdquo;.
              </p>
            </li>
            <li>
              <p className="font-medium">2. Scan this</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI from the auth server, not a remote image */}
              <img src={enrolling.qr} alt="QR code for your authenticator app" className="mt-2 h-44 w-44 rounded-lg border border-border bg-white p-2" />
              <p className="mt-2 text-xs text-muted-foreground">
                Cannot scan? Type this key in instead:{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{enrolling.secret}</code>
              </p>
            </li>
            <li>
              <p className="font-medium">3. Type the code it shows</p>
            </li>
          </ol>
          <div className="space-y-1.5">
            <Label htmlFor="code">Six-digit code</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
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
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || code.length < 6}>
              {busy ? "Checking…" : "Finish setting up"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setEnrolling(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : verified.length ? (
        <div className="space-y-3">
          <p className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
            An authenticator is set up on this account. You are asked for a code each time you sign in.
          </p>
          {level === "aal2" ? (
            <div className="space-y-2">
              {verified.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <span className="text-sm">{f.friendly_name || "Authenticator app"}</span>
                  <Button type="button" size="xs" variant="outline" onClick={() => remove(f.id)} disabled={busy}>
                    Remove
                  </Button>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Removing it leaves your password as the only lock. Do it only if you are replacing the app or the phone.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              To remove or replace it, sign out and sign in again with your code first.
            </p>
          )}
          {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
          <p className="text-sm">
            <Link href="/staff" className="underline underline-offset-2">
              Go to the console
            </Link>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="button" onClick={startEnrol} disabled={busy}>
            {busy ? "Starting…" : "Set up an authenticator app"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Takes about a minute. You will need your phone.
          </p>
        </div>
      )}
    </div>
  );
}
