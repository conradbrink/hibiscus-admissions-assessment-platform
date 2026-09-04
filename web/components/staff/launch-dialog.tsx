"use client";

import { useActionState, useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { LaunchState } from "@/app/staff/(console)/assessments/actions";

/**
 * Launch. Picks the time allowance, opens the attempt, and shows the code
 * and QR the lab computer needs. The code is shown once; closing the dialog
 * loses it, and a fresh one can be issued while the attempt is still
 * waiting to start.
 */
export function LaunchDialog({
  applicationId,
  childName,
  action,
  reissue,
  attemptId,
}: {
  applicationId: string;
  childName: string;
  action: (state: LaunchState, formData: FormData) => Promise<LaunchState>;
  /** When set, the dialog re-issues a code for this waiting attempt instead of launching. */
  reissue?: (state: LaunchState, formData: FormData) => Promise<LaunchState>;
  attemptId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(attemptId && reissue ? reissue : action, {});

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant={attemptId ? "outline" : "default"} />}>
        <Play data-icon="inline-start" /> {attemptId ? "New code" : "Launch"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state.code ? `${childName} — code ready` : `Launch ${childName}'s assessment`}</DialogTitle>
          <DialogDescription>
            {state.code
              ? "Type this code on the assessment computer, or scan the QR code. It works once."
              : "The template for the child's grade is chosen automatically. Add extra time only where an accommodation has been agreed."}
          </DialogDescription>
        </DialogHeader>
        {state.code ? (
          <div className="space-y-3 text-center">
            <p className="font-mono text-5xl font-bold tracking-[0.3em] select-all">{state.code}</p>
            {state.qr ? (
              // eslint-disable-next-line @next/next/no-img-element -- a data URL generated on the server, not an optimisable asset
              <img src={state.qr} alt="QR code for the assessment computer" className="mx-auto size-48 rounded-lg border border-border bg-white p-1" />
            ) : null}
            <p className="text-xs text-muted-foreground">
              Code valid until {state.expiresAt ? new Date(state.expiresAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"} · {state.timeLimitMinutes} minutes once started
            </p>
            <p className="rounded-md bg-muted p-2 font-mono text-[11px] break-all select-all">{state.url}</p>
          </div>
        ) : (
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="applicationId" value={applicationId} />
            {attemptId ? <input type="hidden" name="attemptId" value={attemptId} /> : null}
            {!attemptId ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="timeMultiplier">Time allowance</Label>
                  <NativeSelect id="timeMultiplier" name="timeMultiplier" defaultValue="1">
                    <option value="1">Standard time</option>
                    <option value="1.25">25% extra time</option>
                    <option value="1.5">50% extra time</option>
                    <option value="2">Double time</option>
                  </NativeSelect>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="accommodationNote">Accommodation note (optional)</Label>
                  <Input id="accommodationNote" name="accommodationNote" placeholder="e.g. reader provided for instructions" />
                </div>
              </>
            ) : null}
            {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Opening…" : attemptId ? "Issue a new code" : "Open the assessment"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
