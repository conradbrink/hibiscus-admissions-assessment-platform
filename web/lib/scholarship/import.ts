import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { normaliseEmail, normaliseMobile } from "@/lib/contacts";
import { recordPromotion } from "@/lib/promotions/load";
import { onEnquiryCreated } from "@/lib/workflow/actions";
import { SYSTEM_ACTOR } from "@/lib/workflow/engine";
import type { RosterRow } from "@/lib/scholarship/roster";

/**
 * Turning a roster row into an application the school can work.
 *
 * Four steps per child, in an order that matters:
 *
 *   1. `create_application` — idempotent on the parent's contact and the
 *      child's first name, so the whole run is safe to repeat after a failure
 *      halfway through.
 *   2. `requires_assessment = false` — it cannot be passed in. A trigger
 *      re-reads it from `grades` on insert, and every Form still says an
 *      assessment is required; the trigger fires only on insert and on a
 *      grade change, so an update straight after is not overwritten.
 *   3. the award, before routing, because the routing branch asks whether the
 *      child holds one and would otherwise send the wrong letter.
 *   4. `onEnquiryCreated` — which queues the invitation.
 *
 * Get 3 and 4 the wrong way round and eighty families receive the ordinary
 * enquiry email instead of a scholarship letter.
 */

export type ImportOutcome =
  | { status: "created"; reference: string; applicationId: string }
  | { status: "existing"; reference: string; applicationId: string }
  | { status: "refused"; why: string };

export type ImportedRow = RosterRow & { outcome: ImportOutcome };

export type ImportOptions = {
  /** Resolved once by the caller: class name → grade id, and the campus it sits at. */
  placement: Map<string, { gradeId: string; campusId: string }>;
  /** Which intake these applications join. */
  intakeId: string;
  /**
   * The date of birth every scholarship application carries until the family
   * gives the real one on the registration form.
   *
   * It no longer has to be a fixed value for the run to be repeatable — since
   * 20260923150000_one_live_application_per_child.sql the match is the parent
   * and the child's first name, and the date of birth is not part of it. It
   * stays fixed anyway, and that migration deliberately refuses to write it
   * back over an application it matched: a real birthday collected later must
   * never be replaced by this placeholder on a second run.
   */
  placeholderDateOfBirth: string;
  /** Write nothing; report what would happen. */
  dryRun?: boolean;
};

export type ImportReport = {
  rows: ImportedRow[];
  created: number;
  existing: number;
  refused: number;
};

export async function importScholarshipRoster(
  admin: AdminClient,
  roster: RosterRow[],
  opts: ImportOptions
): Promise<ImportReport> {
  const promotionIds = await loadPromotionIds(admin);
  const rows: ImportedRow[] = [];

  for (const row of roster) {
    rows.push({ ...row, outcome: await importOne(admin, row, opts, promotionIds) });
  }

  return {
    rows,
    created: rows.filter((r) => r.outcome.status === "created").length,
    existing: rows.filter((r) => r.outcome.status === "existing").length,
    refused: rows.filter((r) => r.outcome.status === "refused").length,
  };
}

async function importOne(
  admin: AdminClient,
  row: RosterRow,
  opts: ImportOptions,
  promotionIds: Map<string, string>
): Promise<ImportOutcome> {
  const place = opts.placement.get(row.className);
  if (!place) return { status: "refused", why: `no grade configured for "${row.className}"` };

  const promotionId = promotionIds.get(row.promotionCode);
  if (!promotionId) return { status: "refused", why: `no promotion ${row.promotionCode}` };

  const email = normaliseEmail(row.email);
  const mobile = normaliseMobile(row.mobile);
  if (!email) return { status: "refused", why: `email "${row.email}" did not normalise` };

  if (opts.dryRun) return { status: "created", reference: "(dry run)", applicationId: "(dry run)" };

  const { data, error } = await admin.rpc("create_application", {
    p_parent_first_name: row.parentFirstName,
    p_parent_last_name: row.parentLastName,
    p_email: row.email,
    p_email_normalised: email,
    p_mobile: row.mobile,
    p_mobile_normalised: mobile,
    p_child_first_name: row.studentFirstName,
    p_child_last_name: row.studentLastName,
    p_child_date_of_birth: opts.placeholderDateOfBirth,
    p_campus_id: place.campusId,
    p_grade_id: place.gradeId,
    p_recommended_grade_id: place.gradeId,
    p_intake_id: opts.intakeId,
    // The interview is a visit, not an assessment. The noun the parent reads
    // comes from the award rather than from here, but the booking kind does
    // not: `nextBookingKind` offers visit sessions on this.
    p_entry_route: "visit",
    // `staff`, not a new `scholarship` source. The column is a closed set and
    // widening it for a label would be the wrong reason to touch a constraint:
    // staff did import these, and what makes them scholarships is the award on
    // the application, which is the thing every other part of the system reads.
    p_source: "staff",
    // The school supplied these names and numbers itself, so a correction in
    // the spreadsheet should reach the contact record rather than be ignored.
    p_trusted: true,
  });
  if (error) return { status: "refused", why: error.message };

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.application_id) return { status: "refused", why: "create_application returned nothing" };
  const applicationId = result.application_id as string;
  const reference = result.reference as string;
  const created = Boolean(result.created);

  // Step 2. See the note at the top: the trigger has just overwritten
  // whatever was intended, and this is where it is put right.
  const { error: flagError } = await admin
    .from("applications")
    .update({ requires_assessment: false })
    .eq("id", applicationId);
  if (flagError) return { status: "refused", why: `could not clear requires_assessment: ${flagError.message}` };

  // Step 3, before routing.
  await recordPromotion(admin, applicationId, promotionId, "staff");

  // The parent gave the school this number on the scholarship application
  // itself, and what goes to it is news about that application. Recorded as a
  // staff-entered opt-in rather than a parent's own tick, because that is what
  // it is, and it stays reversible from the contact record.
  await admin
    .from("contacts")
    .update({ whatsapp_opt_in: true, whatsapp_opt_in_at: new Date().toISOString(), whatsapp_opt_in_source: "staff" })
    .eq("email_normalised", email)
    .is("whatsapp_opt_out_at", null);

  // Step 4. Routed when it has not been routed, which is not the same as
  // "created by this run". If `onEnquiryCreated` failed last time — a dropped
  // connection, a timeout — the application is stored and `create_application`
  // will report `created = false` for ever after, so gating on that left the
  // family permanently invisible: no invitation, no task, no timeline.
  //
  // Asking the timeline instead makes a second run finish what the first
  // started. It cannot double-send: the email job's idempotency key is
  // `email:{id}:scholarship_invitation`, and `commit` is guarded on the
  // expected status.
  const { data: routed, error: routedError } = await admin
    .from("application_events")
    .select("id")
    .eq("application_id", applicationId)
    .eq("type", "enquiry.created")
    .limit(1)
    .maybeSingle();
  if (routedError) return { status: "refused", why: `could not check routing: ${routedError.message}` };

  if (!routed) {
    await onEnquiryCreated(
      admin,
      {
        id: applicationId,
        reference,
        status: "new_enquiry",
        entry_route: "visit",
        requires_assessment: false,
        child_first_name: row.studentFirstName,
      },
      `${row.parentFirstName} ${row.parentLastName}`.trim(),
      SYSTEM_ACTOR
    );
  }

  return { status: created ? "created" : "existing", reference, applicationId };
}

async function loadPromotionIds(admin: AdminClient): Promise<Map<string, string>> {
  const { data, error } = await admin.from("promotions").select("id, code").like("code", "SCHOLARSHIP-%");
  if (error) throw new Error(error.message);
  return new Map((data ?? []).filter((p) => p.code).map((p) => [p.code as string, p.id]));
}

/**
 * Class name to grade and campus.
 *
 * The school's two cohorts sit at two campuses and the spreadsheet does not
 * say which — "Form 1" is Block 7 and a primary stage is Broadhurst, and that
 * is a placement decision rather than anything in the file. Resolved once and
 * passed in, so the import never guesses and a wrong mapping fails every row
 * loudly instead of quietly placing a child at the wrong school.
 */
export async function placementFor(
  admin: AdminClient,
  wanted: Array<{ className: string; campusName: string }>
): Promise<Map<string, { gradeId: string; campusId: string }>> {
  const names = [...new Set(wanted.map((w) => w.className))];
  const campusNames = [...new Set(wanted.map((w) => w.campusName))];
  const [{ data: grades }, { data: campuses }] = await Promise.all([
    admin.from("grades").select("id, name").in("name", names),
    admin.from("campuses").select("id, name").in("name", campusNames),
  ]);
  const gradeBy = new Map((grades ?? []).map((g) => [g.name, g.id]));
  const campusBy = new Map((campuses ?? []).map((c) => [c.name, c.id]));

  const out = new Map<string, { gradeId: string; campusId: string }>();
  for (const w of wanted) {
    const gradeId = gradeBy.get(w.className);
    const campusId = campusBy.get(w.campusName);
    if (gradeId && campusId) out.set(w.className, { gradeId, campusId });
  }
  return out;
}
