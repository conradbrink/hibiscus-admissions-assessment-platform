import { heardFromLabel } from "@/lib/heard-from";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/action-form";
import { ApplicantPhase2 } from "@/components/staff/applicant-phase2";
import { SummaryPanel } from "@/components/staff/summary-panel";
import { LaunchDialog } from "@/components/staff/launch-dialog";
import { LinkReveal } from "@/components/staff/link-reveal";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { BookingBadge, PriorityBadge, StatusBadge } from "@/components/staff/status-badge";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { MobileInput } from "@/components/ui/mobile-input";
import { bookingNounTitle } from "@/lib/booking/noun";
import { formatDate, formatDateLong, formatDateTime, formatTime } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { requireStaff } from "@/lib/staff/session";
import { loadSummaryInputs, summaryView } from "@/lib/summary/generate";
import { isNextAction, nextActionCopy, TERMINAL_STATUSES } from "@/lib/workflow/states";
import { WITHDRAWN_REASON_CODES, WITHDRAWN_REASON_LABELS } from "@/lib/workflow/withdrawal";
import { startWalkIn } from "@/app/staff/(console)/assessments/actions";
import {
  addNote,
  assignOwner,
  assignTask,
  defer,
  changeGrade,
  setDayPattern,
  cancelBookingByStaff,
  checkIn,
  completeCallback,
  completeTask,
  deleteApplicant,
  generateLinkForStaff,
  markNoShow,
  recordDecision,
  rescheduleByStaff,
  resumeDeferred,
  refreshSummary,
  resendLink,
  sendWhatsAppTemplate,
  setWhatsAppOptInByStaff,
  updateChildDetails,
  updateParentIdentity,
  updateParentMobile,
  withdraw,
} from "./actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export default async function ApplicantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, permissions } = await requireStaff("applications.read");

  const { data: app } = await supabase
    .from("applications")
    .select("*, campuses(name), grades!applications_grade_id_fkey(name, sort_order), intakes(label), contacts!applications_contact_id_fkey(*), staff_profiles!applications_owner_staff_id_fkey(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!app) notFound();

  const campus = one(app.campuses);
  const grade = one(app.grades);
  // The stages this campus actually teaches, for changing one by hand, and
  // what the date of birth suggested, so the two can be compared.
  const [{ data: campusGradeRows }, { data: recommendedGrade }] = await Promise.all([
    supabase
      .from("campus_grades")
      .select("grade_id, grades!inner(id, name, sort_order, is_active)")
      .eq("campus_id", app.campus_id)
      .eq("is_active", true),
    app.recommended_grade_id
      ? supabase.from("grades").select("id, name").eq("id", app.recommended_grade_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const campusGrades = (campusGradeRows ?? [])
    .map((r) => one(r.grades))
    .filter((g): g is { id: string; name: string; sort_order: number; is_active: boolean } => Boolean(g?.is_active))
    .sort((a, b) => a.sort_order - b.sort_order);
  const intake = one(app.intakes);
  const contact = one(app.contacts);
  const owner = one(app.staff_profiles);

  const [
    { data: events },
    { data: booking },
    { data: tasks },
    { data: notes },
    { data: emails },
    { data: audit },
    { data: staff },
    { data: upcoming },
    { data: tokens },
  ] = await Promise.all([
    supabase.from("application_events").select("*").eq("application_id", id).order("id", { ascending: false }).limit(100),
    supabase
      .from("bookings")
      .select("*, sessions(starts_at, ends_at, location, campuses(name))")
      .eq("application_id", id)
      .in("status", ["booked", "checked_in", "in_progress"])
      .maybeSingle(),
    supabase.from("tasks").select("*, staff_profiles!tasks_assignee_staff_id_fkey(full_name)").eq("application_id", id).order("status").order("due_at", { ascending: true, nullsFirst: false }),
    supabase.from("notes").select("*, staff_profiles(full_name)").eq("application_id", id).order("is_pinned", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("email_messages").select("id, subject, template_key, status, sent_at, opened_at, clicked_at, created_at").eq("application_id", id).order("created_at", { ascending: false }),
    can(permissions, "audit.read")
      ? supabase.from("audit_log").select("*").eq("application_id", id).order("id", { ascending: false }).limit(50)
      : Promise.resolve({ data: null }),
    supabase.from("staff_profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase
      .from("sessions")
      .select("id, kind, starts_at, location, capacity, min_grade_sort, max_grade_sort")
      .eq("campus_id", app.campus_id)
      .eq("is_published", true)
      .gt("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(30),
    supabase.from("access_tokens").select("purpose, expires_at, use_count, revoked_at, created_at").eq("application_id", id).order("created_at", { ascending: false }).limit(5),
  ]);

  const [summaryInputs, { data: storedSummary }, settings] = await Promise.all([
    loadSummaryInputs(supabase, id),
    supabase.from("application_summaries").select("*").eq("application_id", id).maybeSingle(),
    getSettings(supabase),
  ]);
  const summary = summaryInputs ? summaryView(summaryInputs, storedSummary ?? null, settings.aiSummaryEnabled) : null;
  const bookingSession = booking ? one(booking.sessions) : null;
  const nounInput = { requiresAssessment: app.requires_assessment, bookingKind: booking?.kind ?? null };
  const na = isNextAction(app.next_action) ? nextActionCopy(app.next_action, nounInput) : null;
  const canWrite = can(permissions, "applications.write");
  const canDelete = can(permissions, "applications.delete");
  const canDeliver = can(permissions, "assessments.deliver");
  const canDecide = can(permissions, "decisions.override");
  const terminal = TERMINAL_STATUSES.has(app.status);
  const eligibleSessions = (upcoming ?? []).filter(
    (s) =>
      s.kind === (app.requires_assessment ? "assessment" : "visit") &&
      (s.min_grade_sort === null || (grade?.sort_order ?? 0) >= s.min_grade_sort) &&
      (s.max_grade_sort === null || (grade?.sort_order ?? 0) <= s.max_grade_sort)
  );
  const openTasks = (tasks ?? []).filter((t) => t.status === "open");
  const closedTasks = (tasks ?? []).filter((t) => t.status !== "open");
  const idField = <input type="hidden" name="applicationId" value={app.id} />;

  return (
    <>
      <PageTitle
        title={`${app.child_first_name} ${app.child_last_name}`}
        description={`${grade?.name} · ${campus?.name} · ${intake?.label} · ${app.reference}`}
      >
        <StatusBadge status={app.status} />
      </PageTitle>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {summary ? <SummaryPanel applicationId={app.id} view={summary} action={refreshSummary} /> : null}

          {/* Next action (Parent) — and, directly beneath it, the staff half
              of the same idea. They were a page apart, one in the main column
              and one in a 320px sidebar, which read as two unrelated things
              rather than "whose move is it". */}
          <section className="surface p-4">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Next action (Parent)</p>
            <p className="mt-1 text-base font-semibold">{na?.staffLabel ?? "—"}</p>
            {app.next_action_due_at ? (
              <p className="text-sm text-muted-foreground">Due {formatDateTime(app.next_action_due_at)}</p>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              The parent sees: &ldquo;{na?.parentTitle ?? "No action required."}&rdquo;
            </p>
          </section>

          {/* Next action (Staff) */}
          <section className="surface p-4 text-sm">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Next action (Staff)</p>
            {openTasks.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {openTasks.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-border p-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{t.title}</p>
                      {t.details ? <p className="mt-0.5 text-xs whitespace-pre-line text-muted-foreground">{t.details}</p> : null}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t.due_at ? `Due ${formatDateTime(t.due_at)}` : "No due date"} · {one(t.staff_profiles)?.full_name ?? "Unassigned"}
                      </p>
                    </div>
                    <PriorityBadge priority={t.priority} />
                    {/* Out of the 320px sidebar, there is room to hand a task
                        to somebody from the applicant it is about, rather than
                        going back to the tasks list to find it. */}
                    {canWrite ? (
                      <ActionForm action={assignTask} label="Assign" size="xs" variant="outline" resetOnSubmit={false} className="flex items-center gap-1 space-y-0">
                        <input type="hidden" name="taskId" value={t.id} />
                        {idField}
                        <NativeSelect name="assigneeStaffId" defaultValue={t.assignee_staff_id ?? ""} className="h-7 w-40 py-0 text-xs md:h-7">
                          <option value="">Unassigned</option>
                          {(staff ?? []).map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                        </NativeSelect>
                      </ActionForm>
                    ) : null}
                    {canWrite ? (
                      t.type === "callback" && app.status === "callback_requested" ? (
                        <ActionForm action={completeCallback} label="Called — done" size="xs" variant="success">
                          {idField}
                        </ActionForm>
                      ) : (
                        <ActionForm action={completeTask} label="Done" size="xs" variant="success">
                          <input type="hidden" name="taskId" value={t.id} />
                          {idField}
                        </ActionForm>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-muted-foreground">Nothing for staff to do.</p>
            )}
            {closedTasks.length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">{closedTasks.length} completed</p>
            ) : null}
          </section>

          {/* Booking */}
          <section className="surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{bookingNounTitle(nounInput)}</h2>
              {booking ? <BookingBadge status={booking.status} /> : null}
            </div>
            {booking && bookingSession ? (
              <>
                <p className="mt-2 font-medium">
                  {formatDateLong(bookingSession.starts_at)}, {formatTime(bookingSession.starts_at)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {one(bookingSession.campuses)?.name}
                  {bookingSession.location ? ` · ${bookingSession.location}` : ""}
                  {booking.checked_in_at ? ` · arrived ${formatTime(booking.checked_in_at)}` : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {canDeliver && booking.status === "booked" ? (
                    <ActionForm action={checkIn} label="Check in" variant="success" size="sm">{idField}</ActionForm>
                  ) : null}
                  {canDeliver && (booking.status === "booked" || booking.status === "checked_in") ? (
                    <ActionForm action={markNoShow} label="No-show" variant="destructive" size="sm" confirm="Mark as a no-show and email the parent a rebooking link?">{idField}</ActionForm>
                  ) : null}
                  {canWrite && booking.status === "booked" ? (
                    <ActionForm action={cancelBookingByStaff} label="Cancel booking" variant="ghost" size="sm" confirm="Cancel this booking? The enquiry stays open.">{idField}</ActionForm>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No live booking.</p>
            )}
            {/* A family at the desk: open a session for right now, book, check in and launch in one press. */}
            {canDeliver && !terminal && app.requires_assessment && (!booking || booking.status === "booked" || booking.status === "checked_in") ? (
              <div className="mt-3">
                <LaunchDialog applicationId={app.id} childName={app.child_first_name} action={startWalkIn} walkIn />
              </div>
            ) : null}
            {canWrite && !terminal && eligibleSessions.length > 0 && (!booking || booking.status === "booked") ? (
              <ActionForm action={rescheduleByStaff} label={booking ? "Move to selected" : "Book selected"} variant="outline" size="sm" className="mt-3">
                {idField}
                <NativeSelect name="sessionId" className="w-full">
                  {eligibleSessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {formatDateTime(s.starts_at)}{s.location ? ` · ${s.location}` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </ActionForm>
            ) : null}
          </section>

          {/* Assessment, profile, decision, offer */}
          <ApplicantPhase2 supabase={supabase} permissions={permissions} app={app} gradeSort={grade?.sort_order ?? 0} sendWhatsApp={sendWhatsAppTemplate} />

          {/* Timeline */}
          <section className="surface">
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Timeline</h2>
            {events && events.length > 0 ? (
              <ol className="divide-y divide-border">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-3 px-4 py-2.5 text-sm">
                    <span className="w-32 shrink-0 text-xs text-muted-foreground">{formatDateTime(e.occurred_at)}</span>
                    <span className="min-w-0 flex-1">
                      {e.summary}
                      <span className="ml-2 text-xs text-muted-foreground">{e.actor_type}</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="p-4"><EmptyState>No events yet.</EmptyState></div>
            )}
          </section>

          {/* Emails */}
          <section className="surface">
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Emails</h2>
            {emails && emails.length > 0 ? (
              <ul className="divide-y divide-border">
                {emails.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="w-32 shrink-0 text-xs text-muted-foreground">{formatDateTime(m.sent_at ?? m.created_at)}</span>
                    <Link href={`/staff/admin/dev-outbox/${m.id}`} className="min-w-0 flex-1 truncate hover:underline">{m.subject}</Link>
                    <span className="text-xs text-muted-foreground">
                      {m.status}{m.opened_at ? " · opened" : ""}{m.clicked_at ? " · clicked" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4"><EmptyState>No emails sent yet.</EmptyState></div>
            )}
          </section>

          {/* Audit */}
          {audit ? (
            <section className="surface">
              <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Audit trail</h2>
              {audit.length > 0 ? (
                <ul className="divide-y divide-border">
                  {audit.map((a) => (
                    <li key={a.id} className="flex gap-3 px-4 py-2 text-xs">
                      <span className="w-32 shrink-0 text-muted-foreground">{formatDateTime(a.occurred_at)}</span>
                      <span className="flex-1"><span className="font-mono">{a.action}</span> · {a.actor_label ?? a.actor_type}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="p-4"><EmptyState>Nothing recorded.</EmptyState></div>
              )}
            </section>
          ) : null}
        </div>

        <aside className="space-y-5">
          {/* Parent */}
          <section className="surface p-4 text-sm">
            <h2 className="text-sm font-semibold">Parent</h2>
            <p className="mt-1 font-medium">{contact?.first_name} {contact?.last_name}</p>
            <p className="text-muted-foreground">{contact?.email}</p>
            <p className="text-muted-foreground">{contact?.mobile ?? "No mobile"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              WhatsApp updates: {contact?.whatsapp_opt_in ? <span className="text-success">on</span> : "off"}
              {contact?.whatsapp_opt_in && contact.whatsapp_opt_in_source ? ` (${contact.whatsapp_opt_in_source})` : ""}
              {!contact?.whatsapp_opt_in && contact?.whatsapp_opt_out_at ? ` since ${formatDate(contact.whatsapp_opt_out_at)}` : ""}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Child born {formatDate(app.child_date_of_birth)} · came via {app.entry_route}
            </p>
            <p className="text-xs text-muted-foreground">Heard about us: {heardFromLabel(app.heard_from, app.heard_from_detail)}</p>
            {canWrite && !terminal ? (
              <div className="mt-3 space-y-2">
                <ActionForm action={resendLink} label="Email a fresh link" variant="outline" size="sm">{idField}</ActionForm>
                <LinkReveal applicationId={app.id} action={generateLinkForStaff} />
                {contact?.mobile_normalised ? (
                  <ActionForm
                    action={setWhatsAppOptInByStaff}
                    label={contact.whatsapp_opt_in ? "Turn WhatsApp updates off" : "Turn WhatsApp updates on"}
                    variant="ghost"
                    size="sm"
                    confirm={contact.whatsapp_opt_in ? undefined : "Only if the parent asked for WhatsApp updates. Continue?"}
                  >
                    {idField}
                    <input type="hidden" name="optIn" value={contact.whatsapp_opt_in ? "0" : "1"} />
                  </ActionForm>
                ) : null}
                {/* Enquiry forms are filled in on phones, in a hurry. A name
                    lands in the wrong box, a number was typed before the
                    country was asked for separately, an address has a typo in
                    it — and each of those is silent until a family says they
                    never heard from the school. Grouped and labelled plainly,
                    because the office has to be able to find them. */}
                <div className="mt-3 space-y-1 border-t border-border pt-3">
                  <p className="text-xs font-medium text-muted-foreground">Correct a mistake</p>
                  <details className="text-xs">
                    <summary className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline">The child&rsquo;s name or date of birth</summary>
                    <ActionForm action={updateChildDetails} label="Save the child's details" variant="outline" size="sm" className="mt-2 space-y-2">
                      {idField}
                      <div className="grid grid-cols-2 gap-2">
                        <Input name="childFirstName" defaultValue={app.child_first_name} placeholder="First name" required autoComplete="off" aria-label="Child's first name" />
                        <Input name="childLastName" defaultValue={app.child_last_name} placeholder="Surname" required autoComplete="off" aria-label="Child's surname" />
                      </div>
                      <Input name="childDateOfBirth" type="date" defaultValue={app.child_date_of_birth} required aria-label="Child's date of birth" />
                      <p className="text-muted-foreground">
                        This is the name on every letter, message and offer. Changing the date of birth does
                        <strong> not</strong> move the child to a different stage — set that deliberately if it needs to change.
                      </p>
                    </ActionForm>
                  </details>
                  <details className="text-xs">
                    <summary className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline">The parent&rsquo;s name or email</summary>
                    <ActionForm action={updateParentIdentity} label="Save details" variant="outline" size="sm" className="mt-2 space-y-2">
                      {idField}
                      <div className="grid grid-cols-2 gap-2">
                        <Input name="firstName" defaultValue={contact?.first_name ?? ""} placeholder="First name" required autoComplete="off" aria-label="Parent's first name" />
                        <Input name="lastName" defaultValue={contact?.last_name ?? ""} placeholder="Last name" required autoComplete="off" aria-label="Parent's last name" />
                      </div>
                      <Input name="email" type="email" defaultValue={contact?.email ?? ""} placeholder="Email address" required autoComplete="off" aria-label="Parent's email address" />
                      <p className="text-muted-foreground">
                        Changing the email sends nothing by itself. Use <em>Email a fresh link</em> afterwards so the
                        parent gets one at the new address.
                      </p>
                    </ActionForm>
                  </details>
                  <details className="text-xs">
                    <summary className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline">The mobile number</summary>
                    <ActionForm action={updateParentMobile} label="Save number" variant="outline" size="sm" className="mt-2">
                      {idField}
                      <MobileInput name="mobile" defaultValue={contact?.mobile_normalised ?? contact?.mobile ?? null} required autoComplete="off" />
                    </ActionForm>
                  </details>
                </div>
              </div>
            ) : null}
            {tokens && tokens.length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Last link {formatDate(tokens[0].created_at)}, valid until {formatDate(tokens[0].expires_at)}, used {tokens[0].use_count}×
              </p>
            ) : null}
          </section>

          {/* Owner */}
          <section className="surface p-4 text-sm">
            <h2 className="text-sm font-semibold">Owner</h2>
            <p className="mt-1 text-muted-foreground">{owner?.full_name ?? "Unassigned"}</p>
            {canWrite ? (
              <ActionForm action={assignOwner} label="Assign" variant="outline" size="sm" className="mt-2">
                {idField}
                <NativeSelect name="ownerStaffId" defaultValue={app.owner_staff_id ?? ""}>
                  <option value="">Unassigned</option>
                  {(staff ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.full_name}</option>
                  ))}
                </NativeSelect>
              </ActionForm>
            ) : null}
          </section>

          {/* Additional needs, said by the family at enquiry. It sits above
              the stage because it changes how the day is arranged, and it is
              never an input to a decision. */}
          {app.has_special_needs ? (
            <section className="surface border-warning/40 p-4 text-sm">
              <h2 className="text-sm font-semibold text-warning-foreground">Additional needs</h2>
              <p className="mt-1">
                {app.special_needs_detail?.trim() || "The family said their child has additional or special educational needs, without giving details."}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Told to us by the family when they enquired. Arrange the sitting around it — extra time, a quieter
                room, an adult beside them. It plays no part in the decision.
              </p>
            </section>
          ) : null}

          {/* Stage */}
          <section className="surface p-4 text-sm">
            <h2 className="text-sm font-semibold">Stage</h2>
            <p className="mt-1 text-muted-foreground">
              {grade?.name}
              {recommendedGrade && recommendedGrade.id !== app.grade_id ? (
                <span className="block text-xs">Age suggested {recommendedGrade.name}</span>
              ) : null}
            </p>
            {canWrite && app.status !== "enrolled" ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-primary">Change stage</summary>
                <ActionForm action={changeGrade} label="Change" variant="outline" size="sm" className="mt-2">
                  {idField}
                  <NativeSelect name="gradeId" defaultValue={app.grade_id}>
                    {campusGrades.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </NativeSelect>
                  <Input name="reason" placeholder="Why (optional)" maxLength={300} />
                  <p className="text-xs text-muted-foreground">
                    The stage decides which paper the child sits and which fees the offer uses. Only stages taught at
                    this campus are listed.
                  </p>
                </ActionForm>
              </details>
            ) : null}
          </section>

          {/* Half day or full day, for the pre-school grades that are priced both ways */}
          {(grade?.sort_order ?? 999) <= 50 ? (
            <section className="surface p-4 text-sm">
              <h2 className="text-sm font-semibold">Day pattern</h2>
              <p className="mt-1 text-muted-foreground">
                {app.day_pattern === "half" ? "Half day" : app.day_pattern === "full" ? "Full day" : "Not decided yet"}
              </p>
              {canWrite ? (
                <ActionForm action={setDayPattern} label="Save" variant="outline" size="sm" className="mt-2">
                  {idField}
                  <NativeSelect name="dayPattern" defaultValue={app.day_pattern ?? ""}>
                    <option value="">Not decided yet</option>
                    <option value="half">Half day</option>
                    <option value="full">Full day</option>
                  </NativeSelect>
                  <p className="text-xs text-muted-foreground">
                    Decides which term fee the next offer letter quotes. While this is undecided the letter shows both
                    rates and asks the family to confirm; either way, tuition is invoiced and is not payable to accept
                    the offer. An offer already sent keeps the fees it was drafted with.
                  </p>
                </ActionForm>
              ) : null}
            </section>
          ) : null}

          {/* Decision */}
          {canDecide && !terminal && ["awaiting_decision", "staff_review", "new_enquiry", "visit_booked", "callback_requested", "waitlisted"].includes(app.status) ? (
            <section className="surface p-4 text-sm">
              <h2 className="text-sm font-semibold">Record a decision</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {app.requires_assessment
                  ? "Overrides the rules engine. A reason is required and audited."
                  : "Pre-school applicants are decided here. A reason is required and audited."}
              </p>
              <ActionForm action={recordDecision} label="Record decision" size="sm" className="mt-2" confirm="Record this decision? It is audited and the parent will be informed.">
                {idField}
                <NativeSelect name="outcome" defaultValue="approved">
                  <option value="approved">Approve</option>
                  <option value="waitlisted">Waitlist</option>
                  <option value="declined">Decline</option>
                </NativeSelect>
                <Textarea name="reason" placeholder="Reason (required)" rows={2} required minLength={5} />
              </ActionForm>
            </section>
          ) : null}

          {/* Notes */}
          <section className="surface p-4 text-sm">
            <h2 className="text-sm font-semibold">Notes</h2>
            {canWrite ? (
              <ActionForm action={addNote} label="Add note" size="sm" variant="outline" className="mt-2">
                {idField}
                <Textarea name="body" rows={2} placeholder="A note for colleagues" required />
              </ActionForm>
            ) : null}
            {notes && notes.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {notes.map((n) => (
                  <li key={n.id} className="rounded-lg bg-muted/60 p-2.5">
                    <p className="whitespace-pre-wrap">{n.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {one(n.staff_profiles)?.full_name} · {formatDateTime(n.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* Not now. The box says what will happen, because "deferred" on its
              own sounds like a filing decision rather than a promise to ring
              them. */}
          {canWrite && !terminal && app.status !== "deferred" ? (
            <section className="surface p-4 text-sm">
              <h2 className="text-sm font-semibold">Defer</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                For a family who wants a place later in the year. We message them around the date and put a call on
                the owner&rsquo;s list for the day itself, and one click brings them back.
                {booking && booking.status !== "cancelled"
                  ? " Their booking is cancelled, so the seat goes back and the reminders stop."
                  : ""}
              </p>
              <ActionForm
                action={defer}
                label="Defer"
                variant="outline"
                size="sm"
                className="mt-2"
                confirm={booking && booking.status !== "cancelled" ? "Defer this family? Their booking is cancelled and the seat goes back." : undefined}
              >
                {idField}
                <Input type="date" name="until" required aria-label="Come back to them on" />
                <Input name="reason" placeholder="What they said (optional)" maxLength={500} />
              </ActionForm>
            </section>
          ) : null}

          {canWrite && app.status === "deferred" ? (
            <section className="surface p-4 text-sm">
              <h2 className="text-sm font-semibold">Deferred</h2>
              <p className="mt-1">
                Coming back to them {app.deferred_until ? <strong>{formatDate(app.deferred_until)}</strong> : "on no set date"}.
              </p>
              {app.deferred_reason ? <p className="mt-1 text-xs whitespace-pre-line text-muted-foreground">{app.deferred_reason}</p> : null}
              <ActionForm action={resumeDeferred} label="They are ready — resume" variant="success" size="sm" className="mt-2">
                {idField}
              </ActionForm>
            </section>
          ) : null}

          {/* Withdraw */}
          {canWrite && !terminal ? (
            <section className="surface p-4 text-sm">
              <h2 className="text-sm font-semibold">Withdraw</h2>
              <ActionForm action={withdraw} label="Withdraw application" variant="destructive" size="sm" className="mt-2" confirm="Withdraw this application? Bookings and open tasks are cancelled.">
                {idField}
                {/* The reason in their own words is often the useful half, but
                    it is the code that can be counted — which is why the
                    pick-list is the required one. */}
                <NativeSelect name="reasonCode" defaultValue="" required aria-label="Why are they withdrawing?">
                  <option value="" disabled>Why are they withdrawing?</option>
                  {WITHDRAWN_REASON_CODES.map((c) => <option key={c} value={c}>{WITHDRAWN_REASON_LABELS[c]}</option>)}
                </NativeSelect>
                <Input name="reason" placeholder="In their words" required minLength={3} />
              </ActionForm>
            </section>
          ) : null}

          {/* Delete. Deliberately last, deliberately its own box, and only for
              the permission the super administrator holds alone. Withdrawing
              is what staff want almost always; this is for a record that
              should never have existed. */}
          {canDelete ? (
            <section className="surface border-destructive/40 p-4 text-sm">
              <h2 className="text-sm font-semibold text-destructive">Delete this applicant</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Removes the child, the family, their documents, assessments, offers and payments. It cannot be undone,
                and the school keeps only an audit line saying you did it. Use <strong>Withdraw</strong> for a family
                who is no longer applying, and the retention run for a family asking to be forgotten — both keep the
                figures honest.
              </p>
              <ActionForm
                action={deleteApplicant}
                label="Delete permanently"
                variant="destructive"
                size="sm"
                className="mt-3"
                confirm={`Delete ${app.reference} and everything attached to it? This cannot be undone.`}
              >
                {idField}
                <Input name="reason" placeholder="Why is this being deleted?" required minLength={3} maxLength={300} />
                <Input
                  name="confirm"
                  placeholder={`Type ${app.reference} to confirm`}
                  required
                  pattern={app.reference}
                  autoComplete="off"
                  aria-label={`Type ${app.reference} to confirm`}
                />
              </ActionForm>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
