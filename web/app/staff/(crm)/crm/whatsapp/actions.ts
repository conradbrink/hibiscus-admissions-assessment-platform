"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * "I have seen these." Reads the contact's replies through the caller's
 * client first, so a person marks read only what they may see, then stamps
 * them under the service role: `messages` has no staff update policy, on
 * purpose, and this is the one column a person is allowed to change.
 */
export async function markConversationRead(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  return guarded(async () => {
    const ctx = await requireStaffAction("crm.read");
    const { contactId } = z.object({ contactId: z.guid() }).parse(Object.fromEntries(formData));
    const { data: unread } = await ctx.supabase.from("messages").select("id").eq("contact_id", contactId).eq("direction", "in").is("crm_read_at", null);
    if (unread?.length) {
      const { error } = await createAdminClient()
        .from("messages")
        .update({ crm_read_at: new Date().toISOString(), crm_read_by: ctx.userId })
        .in("id", unread.map((m) => m.id));
      if (error) throw new Error(error.message);
    }
    revalidatePath("/staff/crm/whatsapp");
    revalidatePath("/staff/crm/inbox");
    revalidatePath("/staff/crm");
  });
}
