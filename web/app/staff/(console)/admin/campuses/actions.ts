"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

const schema = z.object({
  campusId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  descriptor: z.string().trim().max(120).optional(),
  country: z.enum(["BW", "ZA"]),
  currency: z.enum(["BWP", "ZAR"]),
  address: z.string().trim().max(300).optional(),
  isActive: z.string().optional(),
});

export async function saveCampus(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = schema.parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase
      .from("campuses")
      .update({
        name: p.name,
        descriptor: p.descriptor || null,
        country: p.country,
        currency: p.currency,
        address: p.address || null,
        is_active: p.isActive === "1",
      })
      .eq("id", p.campusId);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/campuses");
  });
}

export async function createCampus(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("settings.write");
    const p = z
      .object({ code: z.string().trim().regex(/^[a-z0-9_]+$/), name: z.string().trim().min(1).max(80), descriptor: z.string().trim().max(120).optional() })
      .parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("campuses").insert({ code: p.code, name: p.name, descriptor: p.descriptor || null, sort_order: 900 });
    if (error) throw new Error(error.message);
    revalidatePath("/staff/admin/campuses");
  });
}
