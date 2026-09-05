"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { enterCode, type CodeState } from "@/app/(kiosk)/sit/actions";

export function CodeEntry() {
  const [state, formAction, pending] = useActionState<CodeState, FormData>(enterCode, {});
  return (
    <form action={formAction} className="mt-6 space-y-4">
      <input
        name="code"
        autoFocus
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={8}
        inputMode="text"
        aria-label="Code"
        className="h-20 w-full rounded-2xl border-2 border-input bg-background text-center font-mono text-4xl tracking-[0.4em] uppercase outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        placeholder="ABC123"
      />
      {state.error ? <p className="text-center text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" size="parent" disabled={pending}>
        {pending ? "Opening…" : "Start"}
      </Button>
    </form>
  );
}
