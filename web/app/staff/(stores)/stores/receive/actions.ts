"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseMoneyToMinor } from "@/lib/money";
import { requireStaffAction } from "@/lib/staff/session";
import { rpcResult, recorded, requestIdFrom, storesGuarded, text, wholeNumber, type StoresActionState } from "@/lib/stores/server";

/** Stock bought or delivered: the quantity goes on the shelf and the receipt into the ledger. */
export async function receiveStock(_: StoresActionState, formData: FormData): Promise<StoresActionState> {
  return storesGuarded(async () => {
    const ctx = await requireStaffAction("stores.write");
    const itemId = String(formData.get("itemId") ?? "");
    if (!z.guid().safeParse(itemId).success) throw new Error("Choose the item that was received.");
    const quantity = wholeNumber(formData.get("quantity"));
    if (quantity === null || quantity < 1) throw new Error("Enter how many were received.");
    const receivedOn = String(formData.get("receivedOn") ?? "").trim() || null;
    if (receivedOn && !/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) throw new Error("Enter the date it was received.");
    const priceRaw = String(formData.get("price") ?? "").trim();
    const price = priceRaw ? parseMoneyToMinor(priceRaw) : null;
    if (priceRaw && (price === null || price < 0)) throw new Error("The price must be an amount, for example 45 or 1,250.50.");
    const data = await rpcResult(
      ctx.supabase.rpc("stores_receive", {
        p_request_id: requestIdFrom(formData),
        p_item_id: itemId,
        p_quantity: quantity,
        p_received_on: receivedOn,
        p_supplier: text(formData.get("supplier"), 160),
        p_unit_price_minor: price,
        p_invoice_ref: text(formData.get("invoiceRef"), 80),
        p_notes: text(formData.get("notes")),
      })
    );
    const r = recorded(data);
    revalidatePath("/staff/stores", "layout");
    return { ...r, message: `Recorded as ${r.reference}.` };
  });
}
