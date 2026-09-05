"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    // Same response whether or not the address is known.
    await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/staff/reset-password`,
    });
    setBusy(false);
    setDone(true);
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <h1 className="text-lg font-semibold">Reset your password</h1>
      {done ? (
        <p className="mt-3 text-sm text-muted-foreground">
          If that address belongs to a staff account, a reset link is on its way.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            Email me a reset link
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-xs text-muted-foreground">
        <Link href="/staff/login" className="underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
