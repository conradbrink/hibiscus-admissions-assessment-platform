"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/parent/page-header";
import { confirmUnsubscribe, type UnsubscribeState } from "@/app/(parent)/unsubscribe/[token]/actions";

/** One question and one button; nothing changes until it is pressed. */
export function UnsubscribeForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<UnsubscribeState, FormData>(confirmUnsubscribe, {});
  if (state.done) {
    return (
      <PageHeader
        eyebrow="Marketing email"
        title="You will not get marketing email from us."
        description="We will still write to you about your own child: fees, dates, and anything the school has to tell you. If you change your mind, tell anyone at the school and they can switch it back on."
      />
    );
  }
  return (
    <form action={action} className="space-y-4">
      <PageHeader
        eyebrow="Marketing email"
        title="Stop marketing email from Hibiscus?"
        description="Press the button and we will stop. We will still write to you about your own child: fees, dates, and anything the school has to tell you."
      />
      <input type="hidden" name="token" value={token} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "One moment…" : "Stop marketing email"}
      </Button>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}
