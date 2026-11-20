"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaffAction } from "@/lib/staff/session";
import { CONDITIONS } from "@/lib/stores/rules";
import { rpcResult, recorded, storesGuarded, type StoresActionState } from "@/lib/stores/server";
import { drawingProblem, parseDrawing } from "@/lib/stores/signature";

const input = z.object({
  requestId: z.guid(),
  checkoutId: z.guid(),
  lines: z
    .array(
      z.object({
        line_id: z.guid(),
        quantity: z.number().int().min(0).max(100000),
        condition: z.enum(CONDITIONS as unknown as [string, ...string[]]),
        note: z.string().max(500).optional(),
      })
    )
    .min(1)
    .max(50),
  drawing: z.string().max(300_000),
  acknowledgement: z.string().max(2000),
  notes: z.string().max(1000).optional(),
});

/**
 * A return, whole or part, signed for. Good items go back on the shelf;
 * anything damaged, missing parts or needing maintenance is held back until
 * it is repaired or written off. The checkout closes itself when nothing is
 * left outstanding.
 */
export async function checkInEquipment(payload: z.input<typeof input>): Promise<StoresActionState & { completed?: boolean }> {
  return storesGuarded(async () => {
    const ctx = await requireStaffAction("stores.write");
    const parsed = input.safeParse(payload);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the return and try again.");
    const p = parsed.data;
    const lines = p.lines.filter((l) => l.quantity > 0);
    if (!lines.length) throw new Error("Enter how many of at least one item are being returned.");
    const drawing = parseDrawing(p.drawing);
    if (!drawing.ok) throw new Error(drawingProblem(drawing.reason));
    const data = await rpcResult(
      ctx.supabase.rpc("stores_check_in", {
        p_request_id: p.requestId,
        p_checkout_id: p.checkoutId,
        p_lines: lines.map((l) => ({ line_id: l.line_id, quantity: l.quantity, condition: l.condition, note: l.note?.trim() || null })),
        p_signature: drawing.drawing,
        p_acknowledgement: p.acknowledgement,
        p_notes: p.notes?.trim() || null,
      })
    );
    const r = recorded(data);
    revalidatePath("/staff/stores", "layout");
    return { ...r, message: `Returned as ${r.reference}.` };
  });
}
