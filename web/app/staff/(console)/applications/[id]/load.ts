import "server-only";
import { bookingNoun } from "@/lib/booking/noun";
import { can, type PermissionSet } from "@/lib/permissions";
import { isScholarshipCode } from "@/lib/promotions/scholarship";
import { registrationCompleteness } from "@/lib/registration/completeness";
import { getSettings } from "@/lib/settings";
import type { StaffContext } from "@/lib/staff/session";
import { loadSummaryInputs, summaryView } from "@/lib/summary/generate";
import { actorName, journeyMilestones, MILESTONE_EVENT_TYPES, nextStep, type ApplicantFacts } from "@/lib/workflow/next-step";
import { createAdminClient } from "@/lib/supabase/admin";
import { backPosition, mayMoveTo, MOVE_EVENT_TYPES } from "@/lib/workflow/stage-move";
import { moneyHeldReason } from "@/lib/workflow/stage-move-actions";

/**
 * Everything the applicant page shows, read once through the staff client
 * so RLS and campus scoping apply. The page used to read half of this itself
 * and hand the other half to a tab component that read again; the next step
 * needs both halves, so they are read together here.
 */

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function loadApplicantWorkspace(supabase: StaffContext["supabase"], permissions: PermissionSet, id: string) {
  const { data: app } = await supabase
    .from("applications")
    .select("*, campuses(name, intake_cadence), grades!applications_grade_id_fkey(name, sort_order), intakes(label), contacts!applications_contact_id_fkey(*), staff_profiles!applications_owner_staff_id_fkey(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!app) return null;

  const canSeeOffers = can(permissions, "offers.read");
  const canSeeFinance = can(permissions, "finance.read");
  const canSeePayments = canSeeOffers || canSeeFinance;
  const registrationOpen = ["paid", "registration_incomplete", "registration_complete", "enrolled"].includes(app.status);

  const [
    { data: campusGradeRows },
    { data: recommendedGrade },
    { data: otherCampuses },
    { data: allCampusGrades },
    { data: events },
    { data: booking },
    { data: lastBooking },
    { data: tasks },
    { data: notes },
    { data: emails },
    { data: audit },
    { data: staff },
    { data: upcoming },
    { data: tokens },
    { data: callbackRequest },
    { data: trials },
    summaryInputs,
    { data: storedSummary },
    settings,
    { data: award },
    { data: bands },
    { data: attempts },
    { data: profile },
    { data: decisions },
    { data: offers },
    { data: subjects },
    { data: competencies },
    { data: paymentRequest },
    { data: payments },
    { data: messages },
    { data: messageTemplates },
    { data: gradeRows },
  ] = await Promise.all([
    // The stages this campus teaches, for changing one by hand, and what the
    // date of birth suggested, so the two can be compared.
    supabase.from("campus_grades").select("grade_id, grades!inner(id, name, sort_order, is_active)").eq("campus_id", app.campus_id).eq("is_active", true),
    app.recommended_grade_id ? supabase.from("grades").select("id, name").eq("id", app.recommended_grade_id).maybeSingle() : Promise.resolve({ data: null }),
    // Only the campuses this person can see: a campus administrator moves a
    // family between their own campuses and nowhere else.
    supabase.from("v_accessible_campuses").select("id, name, is_active").eq("is_active", true).order("sort_order"),
    supabase.from("campus_grades").select("campus_id, grade_id, grades!inner(name, sort_order, is_active)").eq("is_active", true),
    supabase.from("application_events").select("*").eq("application_id", id).order("id", { ascending: false }).limit(100),
    supabase
      .from("bookings")
      .select("*, sessions(starts_at, ends_at, location, campuses(name))")
      .eq("application_id", id)
      .in("status", ["booked", "checked_in", "in_progress"])
      .maybeSingle(),
    // The newest booking whatever became of it, so a missed or finished one
    // can still be shown as what it was.
    supabase
      .from("bookings")
      .select("*, sessions(starts_at, ends_at, location, campuses(name))")
      .eq("application_id", id)
      .neq("status", "rescheduled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("tasks").select("*, staff_profiles!tasks_assignee_staff_id_fkey(full_name)").eq("application_id", id).order("status").order("due_at", { ascending: true, nullsFirst: false }),
    supabase.from("notes").select("*, staff_profiles(full_name)").eq("application_id", id).order("is_pinned", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("email_messages").select("id, subject, template_key, status, error, sent_at, opened_at, clicked_at, created_at").eq("application_id", id).order("created_at", { ascending: false }),
    can(permissions, "audit.read")
      ? supabase.from("audit_log").select("*").eq("application_id", id).order("id", { ascending: false }).limit(50)
      : Promise.resolve({ data: null }),
    supabase.from("staff_profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase
      .from("sessions")
      .select("id, kind, starts_at, location, capacity, min_grade_sort, max_grade_sort")
      .eq("campus_id", app.campus_id)
      // Only the kind this child needs, and the whole horizon, as
      // loadAvailableSlots does for the parent: the cap is applied before the
      // grade band is filtered below, so a short read hid dates that existed.
      .eq("kind", app.requires_assessment ? "assessment" : "visit")
      .eq("is_published", true)
      .gt("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(200),
    supabase.from("access_tokens").select("purpose, expires_at, use_count, revoked_at, created_at").eq("application_id", id).order("created_at", { ascending: false }).limit(5),
    // What the parent typed into "Best time to call" and the message box.
    supabase.from("callback_requests").select("preferred_time, message").eq("application_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("trial_weeks").select("*").eq("application_id", id).order("created_at", { ascending: false }),
    loadSummaryInputs(supabase, id),
    supabase.from("application_summaries").select("*").eq("application_id", id).maybeSingle(),
    getSettings(supabase),
    supabase.from("application_promotions").select("promotion_id, promotions(code)").eq("application_id", id).maybeSingle(),
    // Only the switched-on bands: `setScholarship` refuses a dormant one.
    supabase.from("promotions").select("code").eq("is_active", true).order("code"),
    supabase.from("attempts").select("*").eq("application_id", id).order("created_at", { ascending: false }),
    supabase.from("learning_profiles").select("*").eq("application_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("v_effective_decisions").select("*, staff_profiles(full_name)").eq("application_id", id).order("decided_at", { ascending: false }),
    canSeeOffers ? supabase.from("offers").select("*").eq("application_id", id).order("created_at", { ascending: false }) : Promise.resolve({ data: null }),
    supabase.from("subjects").select("id, name").order("sort_order"),
    supabase.from("competencies").select("id, name, subject_id").order("sort_order"),
    canSeePayments
      ? supabase.from("payment_requests").select("*").eq("application_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    canSeeFinance ? supabase.from("payments").select("*").eq("application_id", id).order("created_at", { ascending: false }) : Promise.resolve({ data: null }),
    supabase.from("messages").select("*").eq("application_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("message_templates").select("key, name, is_active, body_preview, meta_template_name, twilio_content_sid, zavu_template_id").eq("is_active", true).order("name"),
    supabase.from("grades").select("id, name, sort_order").eq("is_active", true).order("sort_order"),
  ]);

  const latestAttempt = attempts?.[0] ?? null;
  const [{ data: scores }, { data: messageEvents }, registrationRows, { data: milestoneEvents }] = await Promise.all([
    latestAttempt ? supabase.from("attempt_scores").select("*").eq("attempt_id", latestAttempt.id) : Promise.resolve({ data: [] }),
    // The trail behind those messages, read separately so a message with a
    // long delivery history cannot push another out of the fifty above.
    (messages ?? []).length
      ? supabase.from("message_events").select("*").in("message_id", (messages ?? []).map((m) => m.id)).order("id")
      : Promise.resolve({ data: [] }),
    registrationOpen
      ? Promise.all([
          supabase.from("registrations").select("*").eq("application_id", id).maybeSingle(),
          supabase.from("registration_contacts").select("*").eq("application_id", id),
          supabase.from("documents").select("*").eq("application_id", id).is("deleted_at", null),
          supabase.from("document_requirements").select("*").eq("is_active", true),
          supabase.from("agreement_templates").select("*").eq("is_active", true),
          supabase.from("agreement_acceptances").select("*").eq("application_id", id),
        ])
      : null,
    // The events the journey bar dates its stages by, read on their own: the
    // timeline above stops at the newest hundred, and on a long-running
    // family the enquiry and the assessment fall off the end of it.
    supabase
      .from("application_events")
      .select("type, occurred_at, actor_type, actor_id, payload, summary")
      .eq("application_id", id)
      // And the hand moves, so the bar can leave unticked a stage the child
      // was moved past (`stagesSkippedByMove`).
      .in("type", [...MILESTONE_EVENT_TYPES, ...MOVE_EVENT_TYPES])
      .order("id", { ascending: false }),
  ]);
  // Everybody who acted on this record, by name, leavers included: the
  // active-staff list above is for choosing an owner, and a decision made by
  // somebody who has since left still has a name.
  const actorIds = [...new Set([...(events ?? []), ...(milestoneEvents ?? [])].map((e) => e.actor_id).filter((x): x is string => Boolean(x)))];
  const { data: actors } = actorIds.length
    ? await supabase.from("staff_profiles").select("id, full_name").in("id", actorIds)
    : { data: [] as Array<{ id: string; full_name: string }> };

  const campus = one(app.campuses);
  const grade = one(app.grades);
  const intake = one(app.intakes);
  const contact = one(app.contacts);
  const owner = one(app.staff_profiles);
  const heldCode = one(award?.promotions)?.code ?? null;
  const scholarship = isScholarshipCode(heldCode);
  const bookingSession = booking ? one(booking.sessions) : null;
  const lastSession = lastBooking ? one(lastBooking.sessions) : null;
  const noun = bookingNoun({ requiresAssessment: app.requires_assessment, bookingKind: booking?.kind ?? null, scholarship });

  const registration = registrationRows?.[0].data ?? null;
  const documents = registrationRows?.[2].data ?? [];
  const acceptances = registrationRows?.[5].data ?? [];
  const registrationState = registrationRows
    ? registrationCompleteness({
        registration,
        contacts: registrationRows[1].data ?? [],
        documents,
        requirements: registrationRows[3].data ?? [],
        gradeSort: grade?.sort_order ?? 0,
        agreementTemplates: registrationRows[4].data ?? [],
        acceptances,
      })
    : null;

  // The offer still in play: what the next step and the Offer section read.
  const liveOffer = (offers ?? []).find((o) => ["draft", "pending_approval", "sent", "viewed", "expired"].includes(o.status)) ?? null;
  const openTasks = (tasks ?? []).filter((t) => t.status === "open");

  const facts: ApplicantFacts = {
    status: app.status,
    requiresAssessment: app.requires_assessment,
    noun,
    booking: booking
      ? { status: booking.status, kind: booking.kind, startsAt: bookingSession?.starts_at ?? null, campus: one(bookingSession?.campuses)?.name ?? null }
      : null,
    attempt: latestAttempt ? { status: latestAttempt.status, markingStatus: latestAttempt.marking_status, startedAt: latestAttempt.started_at } : null,
    offer: liveOffer ? { status: liveOffer.status, sentAt: liveOffer.sent_at, viewedAt: liveOffer.first_viewed_at, expiresAt: liveOffer.expires_at } : null,
    outcomeLetterPending: openTasks.some((t) => t.type === "send_outcome"),
    payment: paymentRequest ? { status: paymentRequest.status, dueAt: paymentRequest.due_at } : null,
    trial: trials?.[0] ? { status: trials[0].status, startsOn: trials[0].starts_on, endsOn: trials[0].ends_on } : null,
    deferredUntil: app.deferred_until,
    offerAutoApprove: settings.offerAutoApprove,
    followUpDueAt: openTasks.map((t) => t.due_at).filter((d): d is string => Boolean(d)).sort()[0] ?? null,
    hasSat: (attempts ?? []).some((a) => a.status === "submitted" || a.status === "marked"),
    hasDecision: (decisions ?? []).length > 0,
    registrationReady: app.status === "registration_incomplete" && Boolean(registrationState?.complete),
    now: new Date(),
  };

  // Why the way back is shut, if it is: the server's own rule, asked only
  // where a move back could be offered. The row was just read under RLS, so
  // this person may see the child; payments they may not see are still what
  // decides, which is why it reads through the service role.
  const moneyHeld =
    mayMoveTo(permissions, "offer", "back") && backPosition(app.status) !== null ? await moneyHeldReason(createAdminClient(), app) : null;

  const staffName = (staffId: string) => (actors ?? []).find((m) => m.id === staffId)?.full_name ?? null;
  const latest = events?.[0] ?? null;

  return {
    app,
    milestones: journeyMilestones(milestoneEvents ?? [], staffName),
    /** Why moving this child back would be refused for money, or null. */
    moneyHeld,
    /** Whether an officer ever moved this child past a stage by hand. */
    moved: (milestoneEvents ?? []).some((e) => MOVE_EVENT_TYPES.includes(e.type)),
    // The newest thing on the timeline: when the record last moved, and who moved it.
    lastUpdated: latest ? { at: latest.occurred_at, by: actorName(latest, staffName) } : null,
    campus,
    grade,
    intake,
    contact,
    owner,
    noun,
    scholarship,
    heldCode,
    award,
    bands: bands ?? [],
    settings,
    summary: summaryInputs ? summaryView(summaryInputs, storedSummary ?? null, settings.aiSummaryEnabled) : null,
    step: nextStep(facts),
    facts,
    booking,
    bookingSession,
    lastBooking,
    lastSession,
    tasks: tasks ?? [],
    openTasks,
    notes: notes ?? [],
    emails: emails ?? [],
    audit,
    events: events ?? [],
    staff: staff ?? [],
    upcoming: upcoming ?? [],
    tokens: tokens ?? [],
    callbackRequest,
    trials: trials ?? [],
    campusGradeRows: campusGradeRows ?? [],
    recommendedGrade,
    otherCampuses: otherCampuses ?? [],
    allCampusGrades: allCampusGrades ?? [],
    attempts: attempts ?? [],
    latestAttempt,
    scores: scores ?? [],
    profile,
    decisions: decisions ?? [],
    offers,
    liveOffer,
    subjects: subjects ?? [],
    competencies: competencies ?? [],
    paymentRequest,
    payments,
    canSeePayments,
    messages: messages ?? [],
    messageEvents: messageEvents ?? [],
    messageTemplates: messageTemplates ?? [],
    grades: gradeRows ?? [],
    registration,
    documents,
    acceptances,
    registrationState,
  };
}

export type ApplicantWorkspace = NonNullable<Awaited<ReturnType<typeof loadApplicantWorkspace>>>;
