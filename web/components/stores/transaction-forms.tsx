"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { QuantityStepper } from "@/components/stores/quantity-stepper";
import { useStoresAction } from "@/components/stores/use-stores-action";
import { returnAsset, reverseTransaction } from "@/app/staff/(stores)/stores/transactions/actions";
import { newRequestId } from "@/lib/stores/request-id";
import { CONDITIONS, CONDITION_LABELS } from "@/lib/stores/rules";

/**
 * Reverse, for a Stores administrator: a reason, a confirmation, and the
 * original left exactly as it was recorded beside the reversal.
 */
export function ReverseForm({ kind, id, reference, consequence }: { kind: string; id: string; reference: string; consequence: string }) {
  const router = useRouter();
  const [requestId] = useState(newRequestId);
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useStoresAction(reverseTransaction);
  if (!open) {
    return (
      <Button type="button" variant="destructive" className="h-12 w-full text-base sm:h-9 sm:w-auto sm:text-sm" onClick={() => setOpen(true)}>
        Reverse {reference}
      </Button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        if (!window.confirm(`Reverse ${reference}? ${consequence} This is recorded with your name and cannot be undone except by a new transaction.`)) {
          e.preventDefault();
          return;
        }
        onSubmit(() => router.refresh())(e);
      }}
      className="space-y-3"
    >
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-muted-foreground">{consequence}</p>
      <div className="space-y-1.5">
        <Label htmlFor="reverse-reason">Why it is being reversed</Label>
        <Textarea id="reverse-reason" name="reason" rows={2} maxLength={500} required placeholder="Recorded against the wrong employee" />
      </div>
      {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button type="button" variant="outline" className="h-12 text-base sm:h-9 sm:text-sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button type="submit" variant="destructive" className="h-12 text-base sm:h-9 sm:text-sm" disabled={pending}>{pending ? "Reversing…" : "Reverse with this reason"}</Button>
      </div>
    </form>
  );
}

/** Bring an assigned item back to the storeroom. */
export function ReturnAssetForm({ assignmentId, held, unit }: { assignmentId: string; held: number; unit: string }) {
  const router = useRouter();
  const [requestId, setRequestId] = useState(newRequestId);
  const [quantity, setQuantity] = useState(held);
  const [key, setKey] = useState(0);
  const { state, pending, onSubmit } = useStoresAction(returnAsset);
  return (
    <form
      key={key}
      onSubmit={onSubmit(() => {
        setRequestId(newRequestId());
        setKey((k) => k + 1);
        router.refresh();
      })}
      className="space-y-3"
    >
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <input type="hidden" name="quantity" value={quantity} />
      <div className="flex flex-wrap items-center gap-3">
        <QuantityStepper value={quantity} onChange={setQuantity} min={1} max={held} label="Quantity coming back" />
        <span className="text-sm text-muted-foreground">of {held} {unit !== "each" ? unit : ""}</span>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="asset-condition">Condition</Label>
        <NativeSelect id="asset-condition" name="condition" defaultValue="good">
          {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="asset-notes">Note (optional)</Label>
        <Textarea id="asset-notes" name="notes" rows={2} maxLength={1000} />
      </div>
      {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      {state.ok && state.message ? <p className="text-sm text-success" role="status">{state.message}</p> : null}
      <Button type="submit" className="h-12 w-full text-base sm:h-9 sm:w-auto sm:text-sm" disabled={pending}>{pending ? "Saving…" : "Return to storeroom"}</Button>
    </form>
  );
}
