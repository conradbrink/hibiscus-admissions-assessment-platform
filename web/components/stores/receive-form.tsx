"use client";

import Link from "next/link";
import { useState } from "react";
import { CircleCheck, Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm } from "@/components/stores/item-form";
import { Picker } from "@/components/stores/picker";
import { QuantityStepper } from "@/components/stores/quantity-stepper";
import { useStoresAction } from "@/components/stores/use-stores-action";
import { receiveStock } from "@/app/staff/(stores)/stores/receive/actions";
import { newRequestId } from "@/lib/stores/request-id";
import { ITEM_TYPE_LABELS } from "@/lib/stores/rules";
import type { ItemChoice } from "@/lib/stores/data";
import { cn } from "@/lib/utils";

type Done = { reference: string; itemId: string; line: string };

/**
 * Receive Stock: choose the item (or create it on the spot), how many, and
 * the optional paperwork. Saved, the quantity is on the shelf and the receipt
 * is in the ledger with the storekeeper's name.
 */
export function ReceiveForm({
  items: initialItems,
  categories,
  locations,
  initialItemId,
  today,
}: {
  items: ItemChoice[];
  categories: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  initialItemId: string | null;
  today: string;
}) {
  const [items, setItems] = useState(initialItems);
  const [itemId, setItemId] = useState<string | null>(initialItems.some((i) => i.id === initialItemId) ? initialItemId : null);
  const [creating, setCreating] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [requestId, setRequestId] = useState(newRequestId);
  const [formKey, setFormKey] = useState(0);
  const [done, setDone] = useState<Done | null>(null);
  const { state, pending, onSubmit, reset } = useStoresAction(receiveStock);
  const item = items.find((i) => i.id === itemId) ?? null;

  const received = (result: { reference?: string }) => {
    if (!item) return;
    setDone({ reference: result.reference ?? "", itemId: item.id, line: `${quantity} ${item.unit !== "each" ? `${item.unit} ` : "× "}${item.name}` });
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, qty_available: i.qty_available + quantity } : i)));
  };

  const again = () => {
    reset();
    setDone(null);
    setItemId(null);
    setQuantity(1);
    setRequestId(newRequestId());
    setFormKey((k) => k + 1);
  };

  if (done) {
    return (
      <div className="surface space-y-4 p-5 text-center sm:p-8" role="status">
        <CircleCheck className="mx-auto size-12 text-success" aria-hidden />
        <div>
          <p className="text-lg font-semibold">Stock received</p>
          <p className="mt-1 text-muted-foreground">{done.line}</p>
          <p className="mt-1 text-sm text-muted-foreground">Reference <span className="font-medium text-foreground">{done.reference}</span></p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button type="button" className="h-12 text-base sm:h-10 sm:text-sm" onClick={again}>Receive more stock</Button>
          <Link href={`/staff/stores/inventory/${done.itemId}`} className={cn(buttonVariants({ variant: "outline" }), "h-12 text-base sm:h-10 sm:text-sm")}>View the item</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="surface space-y-3 p-4 sm:p-5">
        <h2 className="text-base font-semibold">1. Item</h2>
        {creating ? (
          <div className="rounded-xl border border-dashed border-input p-3 sm:p-4">
            <p className="mb-3 text-sm font-medium">New item</p>
            <ItemForm
              compact
              categories={categories}
              locations={locations}
              onCancel={() => setCreating(false)}
              onCreated={(created) => {
                setItems((list) => [...list, { id: created.id, name: created.name, unit: created.unit, item_type: created.item_type as ItemChoice["item_type"], qty_available: created.qty_available, qty_unavailable: 0, category_name: "", photo_url: null }].sort((a, b) => a.name.localeCompare(b.name)));
                setItemId(created.id);
                setCreating(false);
              }}
            />
          </div>
        ) : (
          <Picker
            label="Item received"
            placeholder="Search for the item"
            value={itemId}
            onChange={setItemId}
            options={items.map((i) => ({ id: i.id, label: i.name, detail: `${i.qty_available} ${i.unit} on the shelf · ${ITEM_TYPE_LABELS[i.item_type]}`, keywords: i.category_name, image: i.photo_url }))}
            emptyText="No item by that name. Create it below."
            footer={
              <button type="button" onClick={() => setCreating(true)} className="flex min-h-12 w-full items-center gap-2 px-4 text-left text-sm font-medium text-primary hover:bg-muted">
                <Plus className="size-4" aria-hidden /> Create a new item
              </button>
            }
          />
        )}
      </section>

      <form key={formKey} onSubmit={onSubmit(received)} className="space-y-5">
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="itemId" value={itemId ?? ""} />
        <input type="hidden" name="quantity" value={quantity} />
        <section className="surface space-y-4 p-4 sm:p-5">
          <h2 className="text-base font-semibold">2. Quantity received</h2>
          <div className="flex flex-wrap items-center gap-3">
            <QuantityStepper value={quantity} onChange={setQuantity} min={1} label="Quantity received" />
            {item ? <span className="text-sm text-muted-foreground">{item.unit}</span> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="received-on">Date received</Label>
            <Input id="received-on" name="receivedOn" type="date" defaultValue={today} max={today} required />
          </div>
        </section>
        <section className="surface space-y-4 p-4 sm:p-5">
          <h2 className="text-base font-semibold">3. Paperwork <span className="font-normal text-muted-foreground">(optional)</span></h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="receive-supplier">Supplier</Label>
              <Input id="receive-supplier" name="supplier" maxLength={160} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="receive-price">Price each</Label>
              <Input id="receive-price" name="price" inputMode="decimal" placeholder="P 0.00" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="receive-invoice">Invoice or delivery note number</Label>
              <Input id="receive-invoice" name="invoiceRef" maxLength={80} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="receive-notes">Notes</Label>
              <Textarea id="receive-notes" name="notes" rows={2} maxLength={1000} />
            </div>
          </div>
        </section>
        {state.error ? <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{state.error}</p> : null}
        <Button type="submit" className="h-14 w-full text-base font-semibold sm:h-11" disabled={pending || !itemId || creating}>
          {pending ? "Saving…" : item ? `Receive ${quantity} ${item.unit !== "each" ? item.unit : ""} ${item.name}`.replace(/\s+/g, " ") : "Choose an item first"}
        </Button>
      </form>
    </div>
  );
}
