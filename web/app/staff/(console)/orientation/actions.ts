"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { StaffActionState } from "@/components/staff/action-form";
import { completesOrientation, nextChapter, ORIENTATION_SLUGS } from "@/lib/orientation";
import { getStaff } from "@/lib/staff/session";

/**
 * Ticking off a screen.
 *
 * No permission is asked for: the orientation belongs to everybody who can
 * sign in, including a content author who holds nothing else. What the action
 * does need is a real session, because the function behind it writes to the
 * row of whoever is calling.
 */
export async function markChapterRead(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  const ctx = await getStaff();
  if (!ctx) return { error: "Sign in again to save where you are." };

  const parsed = z
    .object({ slug: z.string() })
    .refine((v) => ORIENTATION_SLUGS.includes(v.slug), "That is not one of the orientation screens.")
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "That is not one of the orientation screens." };

  // Whether this is the last one is worked out here, from the list, rather
  // than trusted from the form: the button says "finish" when it is the last,
  // and a form could say so when it is not.
  const complete = completesOrientation(ctx.profile.orientation_read, parsed.data.slug);

  const { error } = await ctx.supabase.rpc("mark_orientation_read", {
    p_slug: parsed.data.slug,
    p_complete: complete,
  });
  if (error) return { error: "Could not save that just now. Try again in a moment." };

  revalidatePath("/staff/orientation", "layout");
  revalidatePath("/staff");

  // Saving and moving on are one press. `redirect` from a server action is
  // what makes the button a way through the orientation rather than a way to
  // tick a box and then hunt for the next screen.
  const after = nextChapter(parsed.data.slug);
  redirect(after ? `/staff/orientation/${after.slug}` : "/staff/orientation");
}

/**
 * Read it again from the start — for somebody who wants the prompts back.
 *
 * The form has to say so in as many words. It is the one action here that
 * throws away what a person has done, and a bare POST to this address should
 * not be able to do that by accident.
 */
export async function restartOrientation(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  if (formData.get("confirm") !== "restart") return { error: "Nothing was changed." };
  const ctx = await getStaff();
  if (!ctx) return { error: "Sign in again." };
  const { error } = await ctx.supabase.rpc("reset_orientation");
  if (error) return { error: "Could not reset that just now." };
  revalidatePath("/staff/orientation", "layout");
  revalidatePath("/staff");
  return { ok: true };
}
