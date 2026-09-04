"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { StaffActionState } from "@/components/staff/action-form";

/**
 * Generates a link and shows it once, for reading out to a parent on the
 * phone. It is not stored anywhere readable afterwards.
 */
export function LinkReveal({
  applicationId,
  action,
}: {
  applicationId: string;
  action: (state: StaffActionState, formData: FormData) => Promise<StaffActionState & { url?: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="applicationId" value={applicationId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        Generate link to share
      </Button>
      {state.url ? (
        <p className="rounded-md bg-muted p-2 font-mono text-[11px] break-all select-all">{state.url}</p>
      ) : null}
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}
