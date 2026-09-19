import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { Ago, ConsentDot, Fact, LifecycleBadge, OpportunityBadge, RegistrationBadge, Tags } from "@/components/crm/bits";
import { FamilyTimeline } from "@/components/crm/family-timeline";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { PriorityBadge, StatusBadge } from "@/components/staff/status-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { loadFamilyProfile } from "@/lib/crm/families";
import { LIFECYCLE_BLURB, LIFECYCLE_LABELS, LIFECYCLE_STAGES } from "@/lib/crm/lifecycle";
import { familyName, OPPORTUNITY_STATUSES, OPPORTUNITY_STATUS_LABELS, RELATIONSHIP_LABELS } from "@/lib/crm/labels";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { heardFromLabel } from "@/lib/heard-from";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { activeTemplates } from "@/lib/messaging/send";
import { getMessagingProvider } from "@/lib/messaging/provider";
import { requireStaff } from "@/lib/staff/session";
import { STUDENT_STATUS_LABELS, STUDENT_STATUS_TONE, studentName } from "@/lib/students/labels";
import type { ApplicationStatus, StudentStatus } from "@/lib/supabase/types";
import { addFamilyNote, deleteNote, logContact, mergeFamilies, setFollowUp, setLifecycle } from "../actions";
import { createOpportunity, moveOpportunity } from "../../opportunities/actions";
import { createCrmTask, completeCrmTask } from "../../tasks/actions";
import { sendWhatsAppToContact } from "../../contacts/actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * The Customer 360: one family, everything the school knows about them, and
 * every action a person takes about them, on one page that works on a
 * phone. Contacts and children on top, the timeline in the middle, the
 * things to do down the side.
 */
export default async function FamilyProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ merge?: string; tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, permissions, userId } = await requireStaff("crm.read");
  const profile = await loadFamilyProfile(supabase, id);
  if (!profile) notFound();
  const { family, contacts, students, applications, opportunities, tasks, notes, emails, messages, registrations, referred, audit, timeline } = profile;
  const canWrite = can(permissions, "crm.write");
  const canTask = can(permissions, "tasks.write") || canWrite;
  const canAudit = can(permissions, "audit.read");

  const [{ data: staff }, { data: types }, { data: templates }, provider, { data: events }] = await Promise.all([
    supabase.from("staff_profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("opportunity_types").select("code, name").eq("is_active", true).order("sort_order"),
    supabase.from("message_templates").select("*").eq("audience", "family"),
    getMessagingProvider(),
    supabase.from("crm_events").select("id, name, starts_at").eq("is_cancelled", false).gte("starts_at", new Date().toISOString()).order("starts_at").limit(10),
  ]);
  const sendable = activeTemplates(templates ?? [], provider.templateIdField);
  const campus = one(family.campuses);
  const assignee = one(family.staff_profiles);
  const referrer = one(family.referrer);
  const primary = contacts.find((c) => c.id === family.primary_contact_id) ?? contacts[0] ?? null;
  const openTasks = tasks.filter((t) => t.status === "open");

  return (
    <>
      <PageTitle
        back={{ href: "/staff/crm/families", label: "Families" }}
        title={familyName(family)}
        description={[LIFECYCLE_LABELS[family.lifecycle_stage], campus?.name, family.family_code].filter(Boolean).join(" · ")}
      >
        {canWrite ? <Link href={`/staff/crm/families/${family.id}/edit`} className={buttonVariants({ variant: "outline", size: "lg" })}>Edit</Link> : null}
        {canWrite ? <Link href={`/staff/crm/families/new?referredBy=${family.id}`} className={buttonVariants({ variant: "outline", size: "lg" })}>Refer a family</Link> : null}
        {primary?.mobile ? <a href={`tel:${primary.mobile}`} className={buttonVariants({ size: "lg" })}><Phone className="size-4" aria-hidden /> Call</a> : null}
      </PageTitle>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <LifecycleBadge stage={family.lifecycle_stage} />
        {family.lifecycle_manual ? <Badge variant="outline">set by hand</Badge> : null}
        {!family.is_active ? <Badge variant="muted">inactive</Badge> : null}
        <span className="text-xs text-muted-foreground">{LIFECYCLE_BLURB[family.lifecycle_stage]}</span>
        <Tags tags={family.tags} />
      </div>

      {sp.merge && canWrite ? (
        <section className="surface mb-4 border-warning/50 p-4">
          <h2 className="text-sm font-semibold">Merge another family into this one</h2>
          <p className="text-xs text-muted-foreground">Every parent, child, opportunity, note and message on the other family moves here; this family keeps its code. It cannot be undone.</p>
          <ActionForm action={mergeFamilies} label="Merge into this family" variant="destructive" size="sm" className="mt-2 flex flex-wrap items-end gap-2" confirm="Merge the other family into this one? This cannot be undone.">
            <input type="hidden" name="survivorId" value={family.id} />
            <label className="text-xs"><span className="mb-1 block text-muted-foreground">The other family&apos;s id</span><Input name="loserId" className="w-80 font-mono" required /></label>
            <label className="text-xs"><span className="mb-1 block text-muted-foreground">Type MERGE</span><Input name="confirm" className="w-28" required /></label>
          </ActionForm>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Contacts */}
          <section className="surface">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="font-semibold">Contacts</h2>
              {canWrite ? <Link href={`/staff/crm/contacts/new?family=${family.id}`} className="text-xs font-medium text-primary hover:underline">Add a contact</Link> : null}
            </div>
            {contacts.length ? (
              <ul className="divide-y divide-border/70">
                {contacts.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-start gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <Link href={`/staff/crm/contacts/${c.id}`} className="font-medium hover:underline">{c.first_name} {c.last_name}</Link>
                      <span className="ml-2 text-xs text-muted-foreground">{RELATIONSHIP_LABELS[c.relationship]}{c.id === family.primary_contact_id ? " · primary" : c.id === family.secondary_contact_id ? " · secondary" : ""}</span>
                      <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        {c.mobile ? <a href={`tel:${c.mobile}`} className="inline-flex items-center gap-1 hover:underline"><Phone className="size-3" aria-hidden />{c.mobile}</a> : null}
                        {c.mobile_normalised ? <a href={`https://wa.me/${c.mobile_normalised.replace("+", "")}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline"><MessageCircle className="size-3" aria-hidden />WhatsApp</a> : null}
                        <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:underline"><Mail className="size-3" aria-hidden />{c.email}</a>
                      </p>
                      <p className="mt-1 flex flex-wrap gap-3">
                        <ConsentDot on={c.whatsapp_opt_in} label="WhatsApp updates" />
                        <ConsentDot on={c.marketing_email_consent && !c.unsubscribed_at} label="Marketing email" />
                        <ConsentDot on={c.marketing_whatsapp_consent} label="Marketing WhatsApp" />
                        <ConsentDot on={c.sms_consent} label="SMS" />
                      </p>
                    </div>
                    {canWrite && c.whatsapp_opt_in && sendable.length ? (
                      <ActionForm action={sendWhatsAppToContact} label="Send" size="xs" variant="outline" className="flex items-center gap-1 space-y-0">
                        <input type="hidden" name="contactId" value={c.id} />
                        <NativeSelect name="templateKey" defaultValue={sendable[0].key} className="h-7 w-44 py-0 text-xs md:h-7" aria-label="WhatsApp template">
                          {sendable.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                        </NativeSelect>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-5 pb-5"><EmptyState>No contacts on this family.</EmptyState></div>
            )}
          </section>

          {/* Students */}
          <section className="surface">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="font-semibold">Students</h2>
              <Link href="/staff/applications/new" className="text-xs font-medium text-primary hover:underline">Log an enquiry for another child</Link>
            </div>
            {students.length ? (
              <ul className="divide-y divide-border/70">
                {students.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <Link href={`/staff/students/${s.id}`} className="font-medium hover:underline">{studentName(s)}</Link>
                      <span className="block text-xs text-muted-foreground">{[one(s.grades)?.name, one(s.campuses)?.name, s.student_code, `born ${formatDate(s.date_of_birth)}`].filter(Boolean).join(" · ")}</span>
                    </div>
                    <Badge variant={STUDENT_STATUS_TONE[s.status as StudentStatus]}>{STUDENT_STATUS_LABELS[s.status as StudentStatus]}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-5 pb-3 text-sm text-muted-foreground">No child enrolled yet.</div>
            )}
            {applications.length ? (
              <div className="border-t border-border/70 px-5 py-3">
                <h3 className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Applications</h3>
                <ul className="space-y-1 text-sm">
                  {applications.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-2">
                      <Link href={`/staff/applications/${a.id}`} className="hover:underline">{a.child_first_name} {a.child_last_name}</Link>
                      <span className="text-xs text-muted-foreground">{a.reference} · {one(a.grades)?.name} · {one(a.campuses)?.name} · {formatDate(a.created_at)}</span>
                      <StatusBadge status={a.status as ApplicationStatus} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          {/* Timeline */}
          <section className="surface">
            <div className="px-5 pt-4 pb-2">
              <h2 className="font-semibold">Relationship timeline</h2>
              <p className="text-xs text-muted-foreground">Admissions, enrolment, email, WhatsApp, tasks, notes, opportunities, events and campaigns, in one order.</p>
            </div>
            <FamilyTimeline entries={timeline} />
          </section>

          {/* Communications */}
          <section className="surface">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="font-semibold">Communications</h2>
              <span className="text-xs text-muted-foreground">{emails.length} emails · {messages.length} WhatsApp</span>
            </div>
            <div className="grid gap-0 md:grid-cols-2">
              <div className="border-b border-border/70 md:border-r md:border-b-0">
                <h3 className="px-5 pt-2 text-xs font-semibold text-muted-foreground uppercase">Email</h3>
                {emails.length ? (
                  <ul className="divide-y divide-border/70">
                    {emails.slice(0, 8).map((m) => (
                      <li key={m.id} className="px-5 py-2 text-sm">
                        <Link href={`/staff/admin/dev-outbox/${m.id}`} className="block truncate hover:underline">{m.subject}</Link>
                        <span className="text-xs text-muted-foreground">{formatDateTime(m.sent_at ?? m.created_at)} · {m.status}{m.opened_at ? " · opened" : ""}{m.clicked_at ? " · clicked" : ""}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="px-5 py-3 text-xs text-muted-foreground">No emails yet.</p>}
              </div>
              <div>
                <h3 className="px-5 pt-2 text-xs font-semibold text-muted-foreground uppercase">WhatsApp</h3>
                {messages.length ? (
                  <ul className="divide-y divide-border/70">
                    {messages.slice(0, 8).map((m) => (
                      <li key={m.id} className="px-5 py-2 text-sm">
                        <Link href={`/staff/crm/whatsapp?contact=${m.contact_id ?? ""}`} className="block truncate hover:underline">{m.direction === "in" ? `↩ ${m.rendered_text.slice(0, 80)}` : m.template_key ?? "message"}</Link>
                        <span className="text-xs text-muted-foreground">{formatDateTime(m.sent_at ?? m.received_at ?? m.created_at)} · {m.status}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="px-5 py-3 text-xs text-muted-foreground">No WhatsApp messages yet.</p>}
              </div>
            </div>
          </section>

          {/* Opportunities */}
          <section className="surface">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="font-semibold">Opportunities</h2>
              <Link href={`/staff/crm/opportunities?family=${family.id}`} className="text-xs font-medium text-primary hover:underline">All for this family</Link>
            </div>
            {opportunities.length ? (
              <ul className="divide-y divide-border/70">
                {opportunities.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{one(o.opportunity_types)?.name ?? o.type_code}</span>
                      {one(o.students) ? <span className="text-muted-foreground"> · {one(o.students)!.preferred_name || one(o.students)!.legal_first_name}</span> : null}
                      <span className="block text-xs text-muted-foreground">
                        {o.estimated_value_minor ? formatMoney(o.estimated_value_minor, o.currency) : "not costed"} · {one(o.staff_profiles)?.full_name ?? "unassigned"} · {o.source === "rule" ? `rule ${o.rule_code}` : "by hand"}{o.next_action ? ` · next: ${o.next_action}` : ""}
                      </span>
                    </div>
                    <OpportunityBadge status={o.status} />
                    {canWrite && o.status !== "registered" && o.status !== "lost" ? (
                      <ActionForm action={moveOpportunity} label="Move" size="xs" variant="outline" resetOnSubmit={false} className="flex items-center gap-1 space-y-0">
                        <input type="hidden" name="opportunityId" value={o.id} />
                        <input type="hidden" name="familyId" value={family.id} />
                        <NativeSelect name="status" defaultValue={o.status} className="h-7 w-32 py-0 text-xs md:h-7" aria-label="Status">
                          {OPPORTUNITY_STATUSES.map((s) => <option key={s} value={s}>{OPPORTUNITY_STATUS_LABELS[s]}</option>)}
                        </NativeSelect>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <div className="px-5 pb-4 text-sm text-muted-foreground">Nothing identified yet.</div>}
            {canWrite ? (
              <ActionForm action={createOpportunity} label="Add opportunity" size="sm" variant="outline" className="flex flex-wrap items-end gap-2 border-t border-border/70 px-5 py-3">
                <input type="hidden" name="familyId" value={family.id} />
                <NativeSelect name="typeCode" defaultValue={types?.[0]?.code ?? ""} className="w-44" aria-label="Type">
                  {(types ?? []).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                </NativeSelect>
                <NativeSelect name="studentId" defaultValue="" className="w-44" aria-label="Child">
                  <option value="">The family</option>
                  {students.map((s) => <option key={s.id} value={s.id}>{studentName(s)}</option>)}
                </NativeSelect>
                <Input name="estimatedValue" placeholder="Value, e.g. 1500" className="w-32" />
                <Input name="notes" placeholder="Note (optional)" className="w-56" />
              </ActionForm>
            ) : null}
          </section>

          {/* Events */}
          {registrations.length ? (
            <section className="surface">
              <div className="px-5 pt-4 pb-2"><h2 className="font-semibold">Events</h2></div>
              <ul className="divide-y divide-border/70">
                {registrations.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <Link href={`/staff/crm/events/${r.event_id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{one(r.crm_events)?.name}</Link>
                    <span className="text-xs text-muted-foreground">{one(r.crm_events) ? formatDate(one(r.crm_events)!.starts_at) : ""}</span>
                    <RegistrationBadge status={r.status} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {canAudit && audit.length ? (
            <section className="surface">
              <div className="px-5 pt-4 pb-2"><h2 className="font-semibold">Audit trail</h2></div>
              <ul className="divide-y divide-border/70 text-xs">
                {audit.map((a) => (
                  <li key={a.id} className="flex gap-3 px-5 py-2">
                    <span className="w-32 shrink-0 text-muted-foreground">{formatDateTime(a.occurred_at)}</span>
                    <span className="min-w-0 flex-1"><span className="font-mono">{a.action}</span> <span className="text-muted-foreground">by {a.actor_label ?? a.actor_type}</span>
                      {a.after ? <span className="block truncate text-muted-foreground">{JSON.stringify(a.after)}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="space-y-4">
          <section className="surface p-4">
            <h2 className="mb-2 text-sm font-semibold">About the family</h2>
            <dl className="grid grid-cols-2 gap-3">
              <Fact label="Campus">{campus?.name}</Fact>
              <Fact label="Assigned to">{assignee?.full_name}</Fact>
              <Fact label="Lead source">{heardFromLabel(family.lead_source, family.lead_source_detail)}</Fact>
              <Fact label="Preferred contact">{family.preferred_channel}{family.preferred_language ? ` · ${family.preferred_language}` : ""}</Fact>
              <Fact label="Last contact"><Ago value={family.last_contact_at} /></Fact>
              <Fact label="Next follow-up">{family.next_follow_up_at ? formatDate(family.next_follow_up_at) : null}</Fact>
              <Fact label="Created">{formatDate(family.created_at)}{family.source !== "admissions" ? ` · ${family.source}` : ""}</Fact>
              <Fact label="Referred by">{referrer ? <Link href={`/staff/crm/families/${referrer.id}`} className="hover:underline">{referrer.display_name ?? referrer.family_code} family</Link> : null}</Fact>
              <Fact label="Address">{family.home_address}</Fact>
            </dl>
            {family.notes ? <p className="mt-3 whitespace-pre-line text-sm">{family.notes}</p> : null}
            {referred.length ? (
              <div className="mt-3 text-sm">
                <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Referred</p>
                <ul>{referred.map((r) => <li key={r.id}><Link href={`/staff/crm/families/${r.id}`} className="hover:underline">{r.display_name ?? r.family_code} family</Link> <span className="text-xs text-muted-foreground">· {LIFECYCLE_LABELS[r.lifecycle_stage]} · {formatDate(r.created_at)}</span></li>)}</ul>
              </div>
            ) : null}
          </section>

          {canWrite ? (
            <section className="surface p-4">
              <h2 className="mb-2 text-sm font-semibold">Lifecycle</h2>
              <ActionForm action={setLifecycle} label="Set stage" size="xs" variant="outline" resetOnSubmit={false} className="flex items-center gap-2 space-y-0">
                <input type="hidden" name="familyId" value={family.id} />
                <input type="hidden" name="mode" value="manual" />
                <NativeSelect name="stage" defaultValue={family.lifecycle_stage} className="h-8 w-40 py-0 text-xs md:h-8" aria-label="Stage">
                  {LIFECYCLE_STAGES.map((s) => <option key={s} value={s}>{LIFECYCLE_LABELS[s]}</option>)}
                </NativeSelect>
              </ActionForm>
              {family.lifecycle_manual ? (
                <ActionForm action={setLifecycle} label="Let the system set it again" size="xs" variant="ghost" className="mt-2">
                  <input type="hidden" name="familyId" value={family.id} />
                  <input type="hidden" name="mode" value="auto" />
                  <input type="hidden" name="stage" value="" />
                </ActionForm>
              ) : <p className="mt-2 text-xs text-muted-foreground">Set automatically from admissions and the register.</p>}
            </section>
          ) : null}

          {canWrite ? (
            <section className="surface p-4">
              <h2 className="mb-2 text-sm font-semibold">Add a note</h2>
              <ActionForm action={addFamilyNote} label="Add note" size="sm">
                <input type="hidden" name="familyId" value={family.id} />
                <Textarea name="body" rows={3} required maxLength={4000} placeholder="What was said, what was agreed" />
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="isPrivate" /> Private: only me and whoever may edit this family</label>
              </ActionForm>
              <ActionForm action={logContact} label="Log contact" size="xs" variant="outline" className="mt-3 flex flex-wrap items-center gap-2 space-y-0">
                <input type="hidden" name="familyId" value={family.id} />
                <NativeSelect name="how" defaultValue="phone" className="h-7 w-32 py-0 text-xs md:h-7" aria-label="How">
                  <option value="phone">Phone call</option><option value="in_person">In person</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="other">Other</option>
                </NativeSelect>
                <Input name="note" placeholder="One line (optional)" className="h-7 w-40 text-xs md:h-7" />
              </ActionForm>
              <ActionForm action={setFollowUp} label="Set" size="xs" variant="outline" className="mt-3 flex items-center gap-2 space-y-0">
                <input type="hidden" name="familyId" value={family.id} />
                <span className="text-xs text-muted-foreground">Follow up on</span>
                <Input type="date" name="on" defaultValue={family.next_follow_up_at?.slice(0, 10) ?? ""} className="h-7 w-36 text-xs md:h-7" />
              </ActionForm>
            </section>
          ) : null}

          <section className="surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Tasks</h2>
              <Link href={`/staff/crm/tasks?family=${family.id}`} className="text-xs font-medium text-primary hover:underline">All</Link>
            </div>
            {openTasks.length ? (
              <ul className="mt-2 divide-y divide-border/70 text-sm">
                {openTasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{t.title}</p>
                      <p className="text-xs text-muted-foreground">{one(t.staff_profiles)?.full_name ?? "Unassigned"}{t.due_at ? ` · due ${formatDate(t.due_at)}` : ""}</p>
                    </div>
                    <PriorityBadge priority={t.priority} />
                    {canTask || t.assignee_staff_id === userId ? (
                      <ActionForm action={completeCrmTask} label="Done" size="xs" variant="success">
                        <input type="hidden" name="taskId" value={t.id} />
                        <input type="hidden" name="familyId" value={family.id} />
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-xs text-muted-foreground">Nothing open.</p>}
            {canTask ? (
              <ActionForm action={createCrmTask} label="Add task" size="sm" variant="outline" className="mt-3 space-y-2">
                <input type="hidden" name="familyId" value={family.id} />
                <Input name="title" placeholder="What needs doing" required minLength={3} maxLength={200} />
                <div className="grid grid-cols-2 gap-2">
                  <NativeSelect name="studentId" defaultValue="" aria-label="About which child">
                    <option value="">The family</option>
                    {students.map((s) => <option key={s.id} value={s.id}>{studentName(s)}</option>)}
                  </NativeSelect>
                  <NativeSelect name="assigneeStaffId" defaultValue={userId} aria-label="Who">
                    <option value="">Nobody yet</option>
                    {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                  </NativeSelect>
                  <Input type="date" name="dueOn" aria-label="Due on" />
                  <NativeSelect name="priority" defaultValue="normal" aria-label="Priority"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></NativeSelect>
                </div>
              </ActionForm>
            ) : null}
          </section>

          <section className="surface p-4">
            <h2 className="text-sm font-semibold">Notes</h2>
            {notes.length ? (
              <ul className="mt-2 space-y-2 text-sm">
                {notes.map((n) => (
                  <li key={n.id} className={`rounded-xl px-3 py-2 ${n.is_private ? "bg-warning/10" : "bg-muted/60"}`}>
                    <p className="whitespace-pre-line">{n.body}</p>
                    <p className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      {one(n.staff_profiles)?.full_name ?? "Staff"} · {formatDateTime(n.created_at)}{n.is_private ? " · private" : ""}
                      {n.author_staff_id === userId ? (
                        <ActionForm action={deleteNote} label="Delete" size="xs" variant="ghost" className="space-y-0" confirm="Delete this note?">
                          <input type="hidden" name="noteId" value={n.id} />
                          <input type="hidden" name="familyId" value={family.id} />
                        </ActionForm>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-xs text-muted-foreground">No notes yet.</p>}
          </section>

          {events?.length && canWrite ? (
            <section className="surface p-4">
              <h2 className="text-sm font-semibold">Invite to an event</h2>
              <p className="text-xs text-muted-foreground">Register the family from the event page.</p>
              <ul className="mt-2 text-sm">
                {events.map((e) => <li key={e.id}><Link href={`/staff/crm/events/${e.id}?family=${family.id}`} className="hover:underline">{e.name}</Link> <span className="text-xs text-muted-foreground">{formatDate(e.starts_at)}</span></li>)}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
