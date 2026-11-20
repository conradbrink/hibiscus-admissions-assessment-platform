"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { adjustStock } from "@/app/staff/(stores)/stores/inventory/actions";
import { useStoresAction } from "@/components/stores/use-stores-action";
import { newRequestId } from "@/lib/stores/request-id";
import { ADJUSTMENT_LABELS, type AdjustmentKind, type ItemType } from "@/lib/stores/rules";

/**
 * A documented correction on one item: damage found on the shelf, a repair,
 * a stock-take count, a write-off. Every one needs a reason and is recorded
 * with the person's name; the kinds that make stock disappear are offered
 * only to a Stores administrator, and the database asks again.
 */
export function AdjustForm({
  itemId,
  itemType,
  available,
  unavailable,
  isAdmin,
  outstanding,
}: {
  itemId: string;
  itemType: ItemType;
  available: number;
  unavailable: number;
  isAdmin: boolean;
  outstanding: Array<{ lineId: string; label: string; quantity: number }>;
}) {
  const [requestId, setRequestId] = useState(newRequestId);
  const [formKey, setFormKey] = useState(0);
  const { state, pending, onSubmit } = useStoresAction(adjustStock);
  const kinds: AdjustmentKind[] = [
    ...(itemType !== "consumable" && available > 0 ? (["mark_damaged"] as const) : []),
    ...(unavailable > 0 ? (["repaired"] as const) : []),
    ...(isAdmin ? (["count_correction"] as const) : []),
    ...(isAdmin && unavailable > 0 ? (["write_off"] as const) : []),
    ...(isAdmin && outstanding.length > 0 ? (["write_off_outstanding"] as const) : []),
  ];
  const [chosen, setChosen] = useState<AdjustmentKind | "">(kinds[0] ?? "");
  // After a save the item's balances change and so do the kinds on offer
  // (the last held-back unit written off, nothing left to repair). The
  // choice is read through this, so the select, its hint and the fields that
  // depend on it always agree on one kind that is actually offered.
  const kind: AdjustmentKind | "" = chosen && kinds.includes(chosen) ? chosen : (kinds[0] ?? "");
  const setKind = setChosen;

  // Once one is recorded, a new request id and empty fields, so the next
  // adjustment is its own and not a replay of this one.
  const recordedOne = () => {
    setRequestId(newRequestId());
    setFormKey((k) => k + 1);
  };

  if (!kinds.length) return <p className="text-sm text-muted-foreground">Nothing to adjust: nothing is held back, and stock counts are corrected by a Stores administrator.</p>;

  return (
    <form key={formKey} onSubmit={onSubmit(recordedOne)} className="space-y-3">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="itemId" value={itemId} />
      <div className="space-y-1.5">
        <Label htmlFor="adjust-kind">What happened</Label>
        <NativeSelect id="adjust-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as AdjustmentKind)}>
          {kinds.map((k) => <option key={k} value={k}>{ADJUSTMENT_LABELS[k]}</option>)}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">
          {kind === "mark_damaged" && "Moves stock from the shelf to held back, until it is repaired or written off."}
          {kind === "repaired" && "Puts stock that was held back on the shelf again."}
          {kind === "count_correction" && "A stock take found more or fewer on the shelf than the register says."}
          {kind === "write_off" && "Held-back stock that is beyond repair leaves the register."}
          {kind === "write_off_outstanding" && "Equipment on loan that will not come back. Closes that quantity on the checkout."}
        </p>
      </div>
      {kind === "count_correction" ? (
        <div className="space-y-1.5">
          <Label htmlFor="adjust-direction">The count found</Label>
          <NativeSelect id="adjust-direction" name="direction" defaultValue="down">
            <option value="down">Fewer than the register</option>
            <option value="up">More than the register</option>
          </NativeSelect>
        </div>
      ) : null}
      {kind === "write_off_outstanding" ? (
        <div className="space-y-1.5">
          <Label htmlFor="adjust-line">Which loan</Label>
          <NativeSelect id="adjust-line" name="checkoutLineId" defaultValue={outstanding[0]?.lineId}>
            {outstanding.map((o) => <option key={o.lineId} value={o.lineId}>{o.label}</option>)}
          </NativeSelect>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="adjust-quantity">How many</Label>
        <Input id="adjust-quantity" name="quantity" type="number" inputMode="numeric" min={1} defaultValue={1} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="adjust-reason">Why</Label>
        <Textarea id="adjust-reason" name="reason" rows={2} maxLength={500} required placeholder="Cracked lens found during the stock take" />
      </div>
      {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
      {state.ok && state.message ? <p className="text-sm text-success" role="status">{state.message}</p> : null}
      <Button type="submit" variant="secondary" className="h-12 w-full text-base md:h-9 md:text-sm" disabled={pending || !kind}>
        {pending ? "Recording…" : "Record adjustment"}
      </Button>
    </form>
  );
}
