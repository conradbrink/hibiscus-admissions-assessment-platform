"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaffAction } from "@/lib/staff/session";
import { mergeLines } from "@/lib/stores/rules";
import { rpcResult, recorded, storesGuarded, type StoresActionState } from "@/lib/stores/server";

const issueInput = z.object({
  requestId: z.guid(),
  employeeId: z.guid("Choose the employee who is receiving the goods."),
  lines: z.array(z.object({ item_id: z.guid(), quantity: z.number().int().min(1).max(100000) })).min(1, "Add at least one item.").max(50),
  notes: z.string().max(1000).optional(),
});

/** Consumables handed out and used up: deducted, with who received them and for which department. No return, no signature. */
export async function issueConsumables(payload: z.input<typeof issueInput>): Promise<StoresActionState> {
  return storesGuarded(async () => {
    const ctx = await requireStaffAction("stores.write");
    const parsed = issueInput.safeParse(payload);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the issue and try again.");
    const p = parsed.data;
    const data = await rpcResult(
      ctx.supabase.rpc("stores_issue", { p_request_id: p.requestId, p_employee_id: p.employeeId, p_lines: mergeLines(p.lines), p_notes: p.notes?.trim() || null })
    );
    const r = recorded(data);
    revalidatePath("/staff/stores", "layout");
    return { ...r, message: `Issued as ${r.reference}.` };
  });
}

const assignInput = z.object({
  requestId: z.guid(),
  itemId: z.guid("Choose the item being assigned."),
  quantity: z.number().int().min(1).max(100000),
  departmentId: z.guid().nullable(),
  employeeId: z.guid().nullable(),
  locationNote: z.string().max(160).optional(),
  notes: z.string().max(1000).optional(),
});

/** An item placed with a department for good. It stays on the school's asset register, assigned rather than in stock. */
export async function assignAsset(payload: z.input<typeof assignInput>): Promise<StoresActionState> {
  return storesGuarded(async () => {
    const ctx = await requireStaffAction("stores.write");
    const parsed = assignInput.safeParse(payload);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the assignment and try again.");
    const p = parsed.data;
    if (!p.departmentId && !p.employeeId) throw new Error("Choose the department, or the person responsible, the item is assigned to.");
    const data = await rpcResult(
      ctx.supabase.rpc("stores_assign", {
        p_request_id: p.requestId,
        p_item_id: p.itemId,
        p_quantity: p.quantity,
        p_department_id: p.departmentId,
        p_employee_id: p.employeeId,
        p_location_note: p.locationNote?.trim() || null,
        p_notes: p.notes?.trim() || null,
      })
    );
    const r = recorded(data);
    revalidatePath("/staff/stores", "layout");
    return { ...r, message: `Assigned as ${r.reference}.` };
  });
}
