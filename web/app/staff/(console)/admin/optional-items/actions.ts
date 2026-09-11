"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { decimalToMinor } from "@/lib/payments/amounts";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

const bound = z.union([z.literal(""), z.coerce.number().int()]).optional().transform((v) => (v === "" || v === undefined ? null : v));
const optionalDate = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional().transform((v) => (v ? v : null));

const schema = z.object({
  id: z.guid().optional(),
  campusId: z.guid("Choose a campus"),
  code: z.string().regex(/^[a-z0-9_]+$/, "Code: lower-case letters, digits and underscores."),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).optional(),
  category: z.enum(["stationery", "transport", "lunch", "aftercare", "uniform", "other"]),
  // Typed as money, stored as minor units. A price is never read off a form as
  // an integer of cents: somebody will eventually type 250 meaning P250.
  amount: z.string().trim().min(1, "Give a price"),
  gradeSortMin: bound,
  gradeSortMax: bound,
  options: z.string().trim().max(600).optional(),
  orderBy: optionalDate,
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
});

export async function saveOptionalItem(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = schema.parse(Object.fromEntries(formData));

    const amountMinor = decimalToMinor(p.amount);
    if (amountMinor === null || amountMinor <= 0) throw new Error("Give a price greater than zero, like 250 or 250.00.");

    // One per line, which is how a person writes a list of routes.
    const options = (p.options ?? "")
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean);

    const { error } = await ctx.supabase.from("optional_items").upsert(
      {
        ...(p.id ? { id: p.id } : {}),
        campus_id: p.campusId,
        code: p.code,
        label: p.label,
        description: p.description || null,
        category: p.category,
        amount_minor: amountMinor,
        // Deliberately absent: a trigger sets it from the campus, the same way
        // `fee_schedules` does, so a form cannot get the currency wrong.
        grade_sort_min: p.gradeSortMin,
        grade_sort_max: p.gradeSortMax,
        options,
        allow_quantity: formData.getAll("allowQuantity").includes("1"),
        order_by: p.orderBy,
        sort_order: p.sortOrder,
        is_active: formData.getAll("isActive").includes("1"),
      },
      { onConflict: "campus_id,code" }
    );
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/optional-items");
  });
}
