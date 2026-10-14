"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { optionalMobileNumber } from "@/lib/validation";
import type { StaffActionState } from "@/components/staff/action-form";
import { createEnquiry, loadCatalogue } from "@/lib/enquiry";
import { HEARD_FROM_KEYS } from "@/lib/heard-from";
import { enforceRateLimit, LIMITS } from "@/lib/rate-limit";
import { toSchoolDateString } from "@/lib/format-date";
import { intakeForMonth, monthChoices } from "@/lib/start-month";
import { drainSoon, guarded } from "@/lib/staff/action-helpers";
import { requireStaffAction } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { onEnquiryCreated } from "@/lib/workflow/actions";
import { mayMoveTo, moveDirection, moveTargetLabel } from "@/lib/workflow/stage-move";
import { STATUS_LABELS } from "@/lib/workflow/states";
import { onMovedToStage } from "@/lib/workflow/stage-move-actions";

/**
 * A family at the front desk. The same enquiry the parent's own form makes,
 * typed by a member of staff instead: same RPC, same first transition, same
 * emails to the parent — only `source` ("walk_in") and the actor on the
 * audit trail differ, so a walk-in is never mistaken for a web enquiry in
 * the figures.
 *
 * Staff may set the grade here. The parent's form cannot: at the desk there
 * is a school report to look at and a family to ask.
 *
 * An admissions officer may also move the child straight on (Move to stage,
 * `applications.move_stage`): a family who has paid already, or a child who
 * need not sit. Then the enquiry's own email is held and the parent hears
 * only what the stage they land on says.
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
  // A term, or a month at a campus that takes children in by the month;
  // which one applies is settled below, once the campus is known.
  intakeId: z.guid().optional(),
  startMonth: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
  gradeId: z.union([z.guid(), z.literal("")]).optional(),
  entryRoute: z.enum(["assessment", "visit", "callback"]),
  currentSchool: z.string().trim().max(160).optional().default(""),
  heardFrom: z.union([z.enum(HEARD_FROM_KEYS), z.literal("")]).optional(),
  heardFromDetail: z.string().trim().max(200).optional().default(""),
  whatsappOptIn: z.string().optional(),
  // Move straight on (Move to stage), for whoever holds applications.move_stage.
  target: z.union([z.enum(["decision", "offer", "payment", "registration"]), z.literal("")]).optional(),
  reason: z.string().trim().max(1000).optional().default(""),
  alreadyPaid: z.literal("on").optional(),
});

export async function addApplicant(_: StaffActionState, formData: FormData): Promise<StaffActionState> {
  // `redirect` throws, and `guarded` turns a throw into an error line, so
  // the applicant's id comes back out of the guard and the redirect happens
  // after it.
  const created: { id?: string } = {};

  const state = await guarded(async () => {
    const ctx = await requireStaffAction("applications.write");
    const parsed = schema.parse(Object.fromEntries(formData));
    const target = parsed.target || null;
    if (target && !mayMoveTo(ctx.permissions, target)) throw new Error(`Your account cannot move a child to ${moveTargetLabel(target)}.`);
    if (target && parsed.reason.length < 5) throw new Error("Say why the child is being moved straight on.");

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
    const monthly = catalogue.campuses.find((c) => c.id === parsed.campusId)?.intake_cadence === "month";
    if (monthly) {
      const today = toSchoolDateString(new Date());
      if (!parsed.startMonth || !monthChoices(today).some((m) => m.value === parsed.startMonth)) {
        throw new Error("Choose the month the child starts.");
      }
      if (!intakeForMonth(catalogue.intakes, parsed.startMonth)) {
        throw new Error("No open start term covers that month. Open the next year's terms under Settings → Intakes first.");
      }
    } else if (!parsed.intakeId || !catalogue.intakes.some((i) => i.id === parsed.intakeId)) {
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
      intakeId: parsed.intakeId ?? null,
      startMonth: monthly ? parsed.startMonth : null,
      gradeId: parsed.gradeId || null,
      entryRoute: parsed.entryRoute,
      currentSchool: parsed.currentSchool || null,
      whatsappOptIn: parsed.whatsappOptIn === "1",
      heardFrom: parsed.heardFrom || null,
      heardFromDetail: parsed.heardFromDetail || null,
      source: "walk_in",
      // The desk has the family in front of it: what is typed here corrects
      // the record, as it always has.
      trusted: true,
    });
    created.id = result.applicationId;

    // An existing application for this family is opened, not duplicated;
    // `create_application` returns the one already there. A move asked for
    // is still made on it, where it lies ahead: the officer asked for this
    // child to be moved, and dropping that silently would leave them
    // believing it was.
    const existing = !result.created;
    if (!existing && !target) {
      const { data: app } = await admin
        .from("applications")
        .select("id, reference, status, entry_route, requires_assessment, child_first_name")
        .eq("id", result.applicationId)
        .single();
      if (!app) throw new Error("The applicant was created but could not be read back.");
      if (app.status === "new_enquiry") await onEnquiryCreated(admin, app, `${parsed.parentFirstName} ${parsed.parentLastName}`, ctx.actor);
    }
    if (target) {
      if (!existing) {
        const { data: app } = await admin
          .from("applications")
          .select("id, reference, status, entry_route, requires_assessment, child_first_name")
          .eq("id", result.applicationId)
          .single();
        if (!app) throw new Error("The applicant was created but could not be read back.");
        if (app.status === "new_enquiry") {
          await onEnquiryCreated(admin, app, `${parsed.parentFirstName} ${parsed.parentLastName}`, ctx.actor, { holdForMove: true });
        }
      }
      const { data: now, error } = await admin
        .from("applications")
        .select("id, status, reference, child_first_name, requires_assessment")
        .eq("id", result.applicationId)
        .single();
      if (error || !now) throw new Error("The applicant was added but could not be read back to move them.");
      // Forward only. This form checks the forward permission, and a family
      // at the desk is never a reason to withdraw an existing child's offer:
      // that is done from their own page, which asks for offers.approve.
      if (moveDirection(now.status, target) === "forward") {
        try {
          await onMovedToStage(admin, now, { target, reason: parsed.reason, alreadyPaid: parsed.alreadyPaid === "on" }, ctx.actor);
        } catch (e) {
          // Refused before anything changed (no fee schedule, say): the child
          // is still where the enquiry left them and the held acknowledgement
          // goes. Stopped part way: the timeline shows how far it got, the
          // child rests at a legal stage, and this message is how the officer
          // — who has the family in front of them — finds out. Adding the
          // family again from this form opens the record.
          drainSoon();
          throw new Error(`${parsed.childFirstName} ${existing ? "is on file" : "was added"} (${now.reference}), but could not be moved to ${moveTargetLabel(target)}: ${(e as Error).message}`);
        }
      } else if (existing) {
        throw new Error(`${parsed.childFirstName} is already on file (${now.reference}, ${STATUS_LABELS[now.status]}), and ${moveTargetLabel(target)} is not ahead of them, so nothing was moved.`);
      }
      // A new pre-school child is at Decision from the first moment; asked to
      // go there, they already are.
    }
    drainSoon();
    revalidatePath("/staff/applications");
    revalidatePath("/staff");
  });

  if (state.error || !created.id) return state;
  redirect(`/staff/applications/${created.id}`);
}
