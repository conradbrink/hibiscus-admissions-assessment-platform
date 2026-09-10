"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { optionalMobileNumber } from "@/lib/validation";
import type { StaffActionState } from "@/components/staff/action-form";
import { createEnquiry, loadCatalogue } from "@/lib/enquiry";
import { HEARD_FROM_KEYS } from "@/lib/heard-from";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { drainSoon, guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { onEnquiryCreated } from "@/lib/workflow/actions";

/**
 * A family at the front desk. The same enquiry the parent's own form makes,
 * typed by a member of staff instead: same RPC, same first transition, same
 * emails to the parent — only `source` ("walk_in") and the actor on the
 * audit trail differ, so a walk-in is never mistaken for a web enquiry in
 * the figures.
 *
 * Staff may set the grade here. The parent's form cannot: at the desk there
 * is a school report to look at and a family to ask.
 */

const schema = z.object({
  parentFirstName: z.string().trim().min(1, "Please give the parent's first name").max(80),
  parentLastName: z.string().trim().min(1, "Please give the parent's last name").max(80),
  email: z.email("That email address does not look right").max(160),
  // Optional at the desk — a family without a mobile still gets a record —
  // but a number that is given is checked, because it is the one the school
  // will message.
  mobile: optionalMobileNumber,
  childFirstName: z.string().trim().min(1, "Please give the child's first name").max(80),
  childLastName: z.string().trim().min(1, "Please give the child's last name").max(80),
  childDateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Please give the child's date of birth"),
  campusId: z.guid("Please choose a campus"),
  intakeId: z.guid("Please choose a start term"),
  gradeId: z.union([z.guid(), z.literal("")]).optional(),
  entryRoute: z.enum(["assessment", "visit", "callback"]),
  currentSchool: z.string().trim().max(160).optional().default(""),
  heardFrom: z.union([z.enum(HEARD_FROM_KEYS), z.literal("")]).optional(),
  heardFromDetail: z.string().trim().max(200).optional().default(""),
  whatsappOptIn: z.string().optional(),
});

export async function addApplicant(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  // `redirect` throws, and `guarded` turns a throw into an error line, so
  // the applicant's id comes back out of the guard and the redirect happens
  // after it.
  const created: { id?: string } = {};

  const state = await guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = schema.parse(Object.fromEntries(formData));

    const admin = createAdminClient();
    const verdict = await enforceRateLimit(admin, LIMITS.staffApplicant, ctx.userId);
    if (!verdict.ok) throw new Error("That is a lot of applicants in a short time. Please try again shortly.");

    // Through the caller's own client, so a campus administrator cannot add
    // a family to a campus they may not see.
    const { data: allowed } = await ctx.supabase
      .from("v_accessible_campuses")
      .select("id")
      .eq("id", parsed.campusId)
      .maybeSingle();
    if (!allowed) throw new Error("You do not have access to that campus.");

    const catalogue = await loadCatalogue(admin);
    if (!catalogue.intakes.some((i) => i.id === parsed.intakeId)) {
      throw new Error("That start term is no longer open. Choose another.");
    }
    if (parsed.gradeId && !(catalogue.offered[parsed.campusId] ?? []).includes(parsed.gradeId)) {
      throw new Error("That campus does not offer that grade.");
    }

    const result = await createEnquiry(admin, catalogue, {
      parentFirstName: parsed.parentFirstName,
      parentLastName: parsed.parentLastName,
      email: parsed.email,
      mobile: parsed.mobile ?? "",
      childFirstName: parsed.childFirstName,
      childLastName: parsed.childLastName,
      childDateOfBirth: parsed.childDateOfBirth,
      campusId: parsed.campusId,
      intakeId: parsed.intakeId,
      gradeId: parsed.gradeId || null,
      entryRoute: parsed.entryRoute,
      currentSchool: parsed.currentSchool || null,
      whatsappOptIn: parsed.whatsappOptIn === "1",
      heardFrom: parsed.heardFrom || null,
      heardFromDetail: parsed.heardFromDetail || null,
      source: "walk_in",
    });
    created.id = result.applicationId;

    // An existing application for this family is opened, not duplicated;
    // `create_application` returns the one already there.
    if (!result.created) return;

    const { data: app } = await admin
      .from("applications")
      .select("id, reference, status, entry_route, requires_assessment, child_first_name")
      .eq("id", result.applicationId)
      .single();
    if (!app) throw new Error("The applicant was created but could not be read back.");
    if (app.status === "new_enquiry") {
      await onEnquiryCreated(admin, app, `${parsed.parentFirstName} ${parsed.parentLastName}`, ctx.actor);
    }
    drainSoon();
    revalidatePath("/staff/applications");
    revalidatePath("/staff");
  });

  if (state.error || !created.id) return state;
  redirect(`/staff/applications/${created.id}`);
}
