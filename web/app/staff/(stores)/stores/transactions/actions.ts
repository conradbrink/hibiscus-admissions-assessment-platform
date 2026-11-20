"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaffAction } from "@/lib/staff/session";
import { CONDITIONS, type Condition } from "@/lib/stores/rules";
import { rpcResult, recorded, requestIdFrom, storesGuarded, text, wholeNumber, type StoresActionState } from "@/lib/stores/server";

const KINDS = ["receipt", "checkout", "return", "issue", "assignment"] as const;

/**
 * A documented undo, by a Stores administrator, with a reason. The original
 * stays as it was recorded, marked as reversed; the reversal is its own
 * reference and its own lines in the ledger.
 */
export async function reverseTransaction(_: StoresActionState, formData: FormData): Promise<StoresActionState> {
  return storesGuarded(async () => {
    const ctx = await requireStaffAction("stores.admin");
    const kind = z.enum(KINDS).parse(formData.get("kind"));
    const id = z.guid().parse(formData.get("id"));
    const reason = text(formData.get("reason"), 500);
    if (!reason || reason.length < 3) throw new Error("Say why this is being reversed.");
    const data = await rpcResult(ctx.supabase.rpc("stores_reverse", { p_request_id: requestIdFrom(formData), p_kind: kind, p_id: id, p_reason: reason }));
    const r = recorded(data);
    revalidatePath("/staff/stores", "layout");
    return { ...r, message: `Reversed as ${r.reference}.` };
  });
}

/** An assigned item brought back to the storeroom: on the shelf if it is in good order, held back otherwise. */
export async function returnAsset(_: StoresActionState, formData: FormData): Promise<StoresActionState> {
  return storesGuarded(async () => {
    const ctx = await requireStaffAction("stores.write");
    const assignmentId = z.guid().parse(formData.get("assignmentId"));
    const quantity = wholeNumber(formData.get("quantity"));
    if (quantity === null || quantity < 1) throw new Error("Enter how many are coming back.");
    const condition = String(formData.get("condition") ?? "good") as Condition;
    if (!CONDITIONS.includes(condition)) throw new Error("Choose the condition.");
    const data = await rpcResult(
      ctx.supabase.rpc("stores_return_asset", {
        p_request_id: requestIdFrom(formData),
        p_assignment_id: assignmentId,
        p_quantity: quantity,
        p_condition: condition,
        p_notes: text(formData.get("notes")),
      })
    );
    const r = recorded(data);
    revalidatePath("/staff/stores", "layout");
    return { ...r, message: `Returned to the storeroom as ${r.reference}.` };
  });
}
