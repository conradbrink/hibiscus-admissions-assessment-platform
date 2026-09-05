import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/action-form";
import { ApplicantPhase2 } from "@/components/staff/applicant-phase2";
import { LinkReveal } from "@/components/staff/link-reveal";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { BookingBadge, PriorityBadge, StatusBadge } from "@/components/staff/status-badge";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { formatDate, formatDateLong, formatDateTime, formatTime } from "@/lib/format-date";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { isNextAction, NEXT_ACTIONS, TERMINAL_STATUSES } from "@/lib/workflow/states";
import {
  addNote,
  assignOwner,
  cancelBookingByStaff,
  checkIn,
  completeCallback,
  completeTask,
  generateLinkForStaff,
  markNoShow,
  recordDecision,
  rescheduleByStaff,
  resendLink,
  withdraw,
} from "./actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export default async function ApplicantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, permissions } = await requireStaff("applications.read");

  const { data: app } = await supabase
    .from("applications")
    .select("*, campuses(name), grades!applications_grade_id_fkey(name, sort_order), intakes(label), contacts(*), staff_profiles!applications_owner_staff_id_fkey(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!app) notFound();

  const campus = one(app.campuses);
  const grade = one(app.grades);
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

  const bookingSession = booking ? one(booking.sessions) : null;
  const na = isNextAction(app.next_action) ? NEXT_ACTIONS[app.next_action] : null;
  const canWrite = can(permissions, "applications.write");
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

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* Next action */}
          <section className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Next action</p>
            <p className="mt-1 text-base font-semibold">{na?.staffLabel ?? "—"}</p>
            {app.next_action_due_at ? (
              <p className="text-sm text-muted-foreground">Due {formatDateTime(app.next_action_due_at)}</p>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              The parent sees: &ldquo;{na?.parentTitle ?? "No action required."}&rdquo;
            </p>
          </section>

          {/* Booking */}
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{app.requires_assessment ? "Assessment" : "Visit"}</h2>
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
          <ApplicantPhase2 supabase={supabase} permissions={permissions} app={app} gradeSort={grade?.sort_order ?? 0} />

          {/* Timeline */}
          <section className="rounded-xl border border-border bg-card">
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
          <section className="rounded-xl border border-border bg-card">
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
            <section className="rounded-xl border border-border bg-card">
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
          <section className="rounded-xl border border-border bg-card p-4 text-sm">
            <h2 className="text-sm font-semibold">Parent</h2>
            <p className="mt-1 font-medium">{contact?.first_name} {contact?.last_name}</p>
            <p className="text-muted-foreground">{contact?.email}</p>
            <p className="text-muted-foreground">{contact?.mobile ?? "No mobile"}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Child born {formatDate(app.child_date_of_birth)} · came via {app.entry_route}
            </p>
            {canWrite && !terminal ? (
              <div className="mt-3 space-y-2">
                <ActionForm action={resendLink} label="Email a fresh link" variant="outline" size="sm">{idField}</ActionForm>
                <LinkReveal applicationId={app.id} action={generateLinkForStaff} />
              </div>
            ) : null}
            {tokens && tokens.length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Last link {formatDate(tokens[0].created_at)}, valid until {formatDate(tokens[0].expires_at)}, used {tokens[0].use_count}×
              </p>
            ) : null}
          </section>

          {/* Owner */}
          <section className="rounded-xl border border-border bg-card p-4 text-sm">
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

          {/* Tasks */}
          <section className="rounded-xl border border-border bg-card p-4 text-sm">
            <h2 className="text-sm font-semibold">Tasks</h2>
            {openTasks.length > 0 ? (
              <ul className="mt-2 space-y-3">
                {openTasks.map((t) => (
                  <li key={t.id} className="rounded-lg border border-border p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium">{t.title}</span>
                      <PriorityBadge priority={t.priority} />
                    </div>
                    {t.details ? <p className="mt-1 text-xs text-muted-foreground">{t.details}</p> : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.due_at ? `Due ${formatDateTime(t.due_at)}` : "No due date"} · {one(t.staff_profiles)?.full_name ?? "Unassigned"}
                    </p>
                    {canWrite ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {t.type === "callback" && app.status === "callback_requested" ? (
                          <ActionForm action={completeCallback} label="Called — done" size="xs" variant="success">
                            {idField}
                          </ActionForm>
                        ) : (
                          <ActionForm action={completeTask} label="Done" size="xs" variant="success">
                            <input type="hidden" name="taskId" value={t.id} />
                            {idField}
                          </ActionForm>
                        )}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-muted-foreground">No open tasks.</p>
            )}
            {closedTasks.length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">{closedTasks.length} completed</p>
            ) : null}
          </section>

          {/* Decision */}
          {canDecide && !terminal && ["awaiting_decision", "staff_review", "new_enquiry", "visit_booked", "callback_requested", "waitlisted"].includes(app.status) ? (
            <section className="rounded-xl border border-border bg-card p-4 text-sm">
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
          <section className="rounded-xl border border-border bg-card p-4 text-sm">
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

          {/* Withdraw */}
          {canWrite && !terminal ? (
            <section className="rounded-xl border border-border bg-card p-4 text-sm">
              <h2 className="text-sm font-semibold">Withdraw</h2>
              <ActionForm action={withdraw} label="Withdraw application" variant="destructive" size="sm" className="mt-2" confirm="Withdraw this application? Bookings and open tasks are cancelled.">
                {idField}
                <Input name="reason" placeholder="Reason" required minLength={3} />
              </ActionForm>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
