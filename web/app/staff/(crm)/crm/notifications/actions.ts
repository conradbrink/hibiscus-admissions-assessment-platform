"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";

/** Your own notices only; the policy refuses anybody else's. */
export async function markRead(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.read");
    const { id } = z.object({ id: z.guid() }).parse(Object.fromEntries(formData));
    const { error } = await ctx.supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/crm/notifications");
    revalidatePath("/staff/crm", "layout");
  });
}

export async function markAllRead(): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.read");
    const { error } = await ctx.supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    if (error) throw new Error(error.message);
    revalidatePath("/staff/crm/notifications");
    revalidatePath("/staff/crm", "layout");
  });
}
