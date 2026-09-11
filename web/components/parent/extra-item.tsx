"use client";

import { useActionState, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancel, choose } from "@/app/(parent)/family/extras/actions";
import type { FamilyActionState } from "@/app/(parent)/family/returning/actions";

/**
 * One thing a family can order for a child.
 *
 * Everything optional is shown, ordered or not, with the price on the row —
 * a parent deciding whether to order a stationery pack needs the number in
 * front of them, not behind a tap. What is already ordered stays visible with
 * a way to change it, for the same reason a finished checklist item does.
 *
 * Nothing here is required and nothing is ever chased, so the wording never
 * implies the family is behind: an unordered extra is an offer, not an
 * omission.
 */
export function ExtraItem({
  studentId,
  itemId,
  label,
  description,
  price,
  options,
  allowQuantity,
  orderByLabel,
  orderable,
  selection,
}: {
  studentId: string;
  itemId: string;
  label: string;
  description: string | null;
  price: string;
  options: string[];
  allowQuantity: boolean;
  orderByLabel: string | null;
  orderable: boolean;
  selection: { id: string; quantity: number; choice: string | null; status: "selected" | "paid" | "cancelled" } | null;
}) {
  const [chooseState, chooseAction, choosing] = useActionState<FamilyActionState, FormData>(choose, {});
  const [cancelState, cancelAction, cancelling] = useActionState<FamilyActionState, FormData>(cancel, {});
  const [open, setOpen] = useState(false);

  const ordered = selection && selection.status !== "cancelled";
  const paid = selection?.status === "paid";
  const error = chooseState.error ?? cancelState.error;

  return (
    <li className={`rounded-xl border p-4 ${ordered ? "border-success/40 bg-success/5" : "border-border"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          {ordered ? <Check className="mr-1 inline size-4 text-success" aria-hidden /> : null}
          {label}
        </p>
        <p className="text-sm font-medium tabular-nums">{price}</p>
      </div>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}

      {ordered ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Ordered{selection.quantity > 1 ? ` ×${selection.quantity}` : ""}
          {selection.choice ? ` · ${selection.choice}` : ""}
          {paid ? " · paid" : ""}
        </p>
      ) : null}

      {!orderable && !ordered ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Ordering has closed{orderByLabel ? ` — it was ${orderByLabel}` : ""}. Call the office and we will see what we can do.
        </p>
      ) : null}

      {orderable && !paid ? (
        <div className="mt-3">
          {open || (!ordered && options.length === 0 && !allowQuantity) ? (
            <form action={chooseAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="studentId" value={studentId} />
              <input type="hidden" name="itemId" value={itemId} />
              {options.length ? (
                <label className="text-sm">
                  <span className="block text-xs text-muted-foreground">Choose one</span>
                  <select name="choice" defaultValue={selection?.choice ?? ""} required className="mt-1 h-9 rounded-md border border-border bg-background px-2">
                    <option value="" disabled>Select…</option>
                    {options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </label>
              ) : null}
              {allowQuantity ? (
                <label className="text-sm">
                  <span className="block text-xs text-muted-foreground">How many</span>
                  <input
                    name="quantity"
                    type="number"
                    min={1}
                    max={20}
                    defaultValue={selection?.quantity ?? 1}
                    className="mt-1 h-9 w-20 rounded-md border border-border bg-background px-2 tabular-nums"
                  />
                </label>
              ) : null}
              <Button type="submit" size="sm" disabled={choosing}>
                {choosing ? "Saving…" : ordered ? "Change" : "Order this"}
              </Button>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant={ordered ? "outline" : "default"} onClick={() => setOpen(true)}>
                {ordered ? "Change" : "Order this"}
              </Button>
              {ordered ? (
                <form action={cancelAction}>
                  <input type="hidden" name="studentId" value={studentId} />
                  <input type="hidden" name="selectionId" value={selection.id} />
                  <Button type="submit" size="sm" variant="ghost" disabled={cancelling}>
                    {cancelling ? "Removing…" : "I do not want this"}
                  </Button>
                </form>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {paid ? <p className="mt-2 text-xs text-muted-foreground">Paid for. Call the office if you need to change it.</p> : null}
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
    </li>
  );
}
