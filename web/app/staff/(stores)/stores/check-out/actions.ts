"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaffAction } from "@/lib/staff/session";
import { mergeLines } from "@/lib/stores/rules";
import { rpcResult, recorded, storesGuarded, type StoresActionState } from "@/lib/stores/server";
import { drawingProblem, parseDrawing } from "@/lib/stores/signature";

const input = z.object({
  requestId: z.guid(),
  employeeId: z.guid("Choose the employee who is collecting the equipment."),
  expectedReturnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date the equipment is due back."),
  lines: z.array(z.object({ item_id: z.guid(), quantity: z.number().int().min(1).max(100000) })).min(1, "Add at least one item.").max(50),
  drawing: z.string().max(300_000),
  acknowledgement: z.string().max(2000),
  notes: z.string().max(1000).optional(),
});

/**
 * One checkout: an employee, the equipment, the return date and the
 * employee's signature over the handover acknowledgement, all recorded by one
 * database function in one transaction. The signature is checked here and
 * again in the database; the stock is checked there, under a lock.
 */
export async function checkoutEquipment(payload: z.input<typeof input>): Promise<StoresActionState> {
  return storesGuarded(async () => {
    const ctx = await requireStaffAction("stores.write");
    const parsed = input.safeParse(payload);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the checkout and try again.");
    const p = parsed.data;
    const drawing = parseDrawing(p.drawing);
    if (!drawing.ok) throw new Error(drawingProblem(drawing.reason));
    const data = await rpcResult(
      ctx.supabase.rpc("stores_checkout", {
        p_request_id: p.requestId,
        p_employee_id: p.employeeId,
        p_expected_return_date: p.expectedReturnDate,
        p_lines: mergeLines(p.lines),
        p_signature: drawing.drawing,
        p_acknowledgement: p.acknowledgement,
        p_notes: p.notes?.trim() || null,
      })
    );
    const r = recorded(data);
    revalidatePath("/staff/stores", "layout");
    return { ...r, message: `Checked out as ${r.reference}.` };
  });
}
