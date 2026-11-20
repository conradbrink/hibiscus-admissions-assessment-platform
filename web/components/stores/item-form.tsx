"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ItemPhotoField } from "@/components/stores/item-photo-field";
import { QuantityStepper } from "@/components/stores/quantity-stepper";
import { useStoresAction } from "@/components/stores/use-stores-action";
import { createItem, updateItem } from "@/app/staff/(stores)/stores/inventory/actions";
import { newRequestId } from "@/lib/stores/request-id";
import { ITEM_TYPES, ITEM_TYPE_HINTS, ITEM_TYPE_LABELS, type ItemType } from "@/lib/stores/rules";
import type { StoresActionState } from "@/lib/stores/server";
import { cn } from "@/lib/utils";

export type ItemFormValues = {
  id?: string;
  name: string;
  description: string;
  categoryId: string;
  itemType: ItemType;
  unit: string;
  minStock: number;
  locationId: string;
  price: string;
  supplier: string;
  isActive: boolean;
  /** The current photo's address, when editing an item that has one. */
  photoUrl?: string | null;
};

const UNITS = ["each", "litres", "rolls", "packs", "boxes", "bottles", "reams", "pairs", "sets", "bags", "kg", "metres"];

/**
 * Adding an item, or changing one. `compact` is the version inside Receive
 * Stock: only what is needed to put the item on the register, and the new
 * item handed back to the picker instead of opening its page.
 */
export function ItemForm({
  initial,
  categories,
  locations,
  compact = false,
  typeLocked = false,
  onCreated,
  onCancel,
}: {
  initial?: Partial<ItemFormValues>;
  categories: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  compact?: boolean;
  /**
   * The item holds stock and the signed-in person is not a Stores
   * administrator: its type is shown but cannot be changed (the database
   * refuses it too, so the form does not offer what will fail).
   */
  typeLocked?: boolean;
  onCreated?: (item: NonNullable<StoresActionState["item"]>) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const editing = Boolean(initial?.id);
  const { state, pending, onSubmit } = useStoresAction(editing ? updateItem : createItem);
  const [requestId] = useState(newRequestId);
  const [type, setType] = useState<ItemType>(initial?.itemType ?? "reusable");
  const [opening, setOpening] = useState(0);

  const saved = (result: StoresActionState) => {
    if (!result.id) return;
    if (compact && result.item && onCreated) {
      if (result.photoFailed) window.alert(result.message ?? "The item was added, but its photo was not saved. Add it from Edit.");
      onCreated(result.item);
    } else router.push(`/staff/stores/inventory/${result.id}${editing ? "" : result.photoFailed ? "?added=1&photo=failed" : "?added=1"}`);
  };

  const field = "space-y-1.5";
  return (
    <form onSubmit={onSubmit(saved)} className="space-y-5" noValidate>
      <input type="hidden" name="requestId" value={requestId} />
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      <div className={field}>
        <Label htmlFor="item-name">Item name</Label>
        <Input id="item-name" name="name" required maxLength={120} defaultValue={initial?.name ?? ""} placeholder="Portable Speaker" autoFocus={!editing} />
      </div>

      <div className={field}>
        <p className="text-sm font-medium">Photo <span className="font-normal text-muted-foreground">(optional)</span></p>
        <ItemPhotoField currentUrl={initial?.photoUrl ?? null} />
        {!compact ? <p className="text-xs text-muted-foreground">Shown beside the item&apos;s name everywhere in Stores, so the right one is picked off the shelf.</p> : null}
      </div>

      <fieldset className={field}>
        <legend className="mb-1.5 text-sm font-medium">What kind of item is it?</legend>
        {typeLocked ? (
          <>
            <input type="hidden" name="itemType" value={type} />
            <p className="mb-2 text-xs text-muted-foreground">This item has stock, so only a Stores administrator can change its type.</p>
          </>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-3">
          {ITEM_TYPES.map((t) => (
            <label
              key={t}
              className={cn(
                "flex min-h-12 flex-col gap-0.5 rounded-xl border px-3 py-2.5 transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/30",
                typeLocked ? "cursor-not-allowed" : "cursor-pointer",
                type === t ? "border-primary bg-accent" : cn("border-input bg-card", typeLocked ? "opacity-50" : "hover:bg-muted")
              )}
            >
              <input type="radio" name={typeLocked ? undefined : "itemType"} value={t} checked={type === t} onChange={() => setType(t)} disabled={typeLocked} className="sr-only" />
              <span className="text-sm font-semibold">{ITEM_TYPE_LABELS[t]}</span>
              {!compact ? <span className="text-xs text-muted-foreground">{ITEM_TYPE_HINTS[t]}</span> : null}
            </label>
          ))}
        </div>
        {compact ? <p className="text-xs text-muted-foreground">{ITEM_TYPE_HINTS[type]}</p> : null}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className={field}>
          <Label htmlFor="item-category">Category</Label>
          <NativeSelect id="item-category" name="categoryId" defaultValue={initial?.categoryId ?? ""} required>
            <option value="" disabled>Choose a category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </div>
        <div className={field}>
          <Label htmlFor="item-unit">Counted in</Label>
          <Input id="item-unit" name="unit" list="stores-units" defaultValue={initial?.unit ?? "each"} maxLength={30} />
          <datalist id="stores-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
        </div>
      </div>

      {!compact ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className={field}>
              <Label htmlFor="item-min">Reorder level</Label>
              <Input id="item-min" name="minStock" type="number" inputMode="numeric" min={0} defaultValue={initial?.minStock ?? 0} />
              <p className="text-xs text-muted-foreground">Warn when this many or fewer are on the shelf. Zero means never.</p>
            </div>
            <div className={field}>
              <Label htmlFor="item-location">Storage location</Label>
              <NativeSelect id="item-location" name="locationId" defaultValue={initial?.locationId ?? locations[0]?.id ?? ""}>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </NativeSelect>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className={field}>
              <Label htmlFor="item-price">Purchase price, each (optional)</Label>
              <Input id="item-price" name="price" inputMode="decimal" placeholder="P 0.00" defaultValue={initial?.price ?? ""} />
            </div>
            <div className={field}>
              <Label htmlFor="item-supplier">Supplier (optional)</Label>
              <Input id="item-supplier" name="supplier" maxLength={160} defaultValue={initial?.supplier ?? ""} />
            </div>
          </div>
          <div className={field}>
            <Label htmlFor="item-description">Description (optional)</Label>
            <Textarea id="item-description" name="description" rows={2} maxLength={1000} defaultValue={initial?.description ?? ""} />
          </div>
        </>
      ) : (
        // Left to the database, which files it in the first storage place in
        // use: the same rule as everywhere else, not whatever this list held.
        <input type="hidden" name="locationId" value="" />
      )}

      {!editing && !compact ? (
        <div className={field}>
          <Label>Quantity in the storeroom now</Label>
          <input type="hidden" name="openingQuantity" value={opening} />
          <QuantityStepper value={opening} onChange={setOpening} label="Opening quantity" />
          <p className="text-xs text-muted-foreground">Recorded as the item&apos;s opening stock, with your name. Later deliveries go through Receive Stock.</p>
        </div>
      ) : null}

      {editing ? (
        <label className="flex min-h-12 items-start gap-3 rounded-xl border border-input bg-card px-3 py-3">
          <input type="checkbox" name="isActive" defaultChecked={initial?.isActive ?? true} className="mt-0.5 size-5 accent-[var(--primary)]" />
          <span>
            <span className="block text-sm font-medium">In use</span>
            <span className="block text-xs text-muted-foreground">Switch off an item the school no longer stocks. Its history stays; it cannot go out again until it is switched back on.</span>
          </span>
        </label>
      ) : null}

      {state.error ? <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{state.error}</p> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button type="button" variant="outline" className="h-12 text-base sm:h-10 sm:text-sm" onClick={onCancel}>Cancel</Button>
        ) : null}
        <Button type="submit" className="h-12 text-base sm:h-10 sm:text-sm" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : compact ? "Create item" : "Add to the register"}
        </Button>
      </div>
    </form>
  );
}
