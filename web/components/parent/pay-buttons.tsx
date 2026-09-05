"use client";

import { useActionState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PayState } from "@/app/(parent)/pay/actions";

type Action = () => Promise<PayState>;

/** One big button that hands over to the gateway. */
export function PayOnlineButton({ action, label }: { action: Action; label: string }) {
  const [state, formAction, pending] = useActionState(async () => action(), {});
  return (
    <form action={formAction}>
      {state.error ? <p role="alert" className="mb-2 text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" size="parent" disabled={pending}>
        {pending ? "Taking you to the payment page…" : label}
        {!pending ? <ArrowRight data-icon="inline-end" /> : null}
      </Button>
    </form>
  );
}

export function CheckPaymentButton({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(async () => action(), {});
  return (
    <form action={formAction}>
      {state.error ? <p role="alert" className="mb-2 text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" size="parent" variant="outline" disabled={pending}>
        <RefreshCw data-icon="inline-start" className={pending ? "animate-spin" : undefined} />
        {pending ? "Checking…" : "Check again"}
      </Button>
    </form>
  );
}
