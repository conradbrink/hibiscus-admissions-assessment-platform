import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isLifecycleStage, LIFECYCLE_LABELS } from "@/lib/crm/lifecycle";
import { OPPORTUNITY_STATUS_LABELS } from "@/lib/crm/labels";
import { mergeTimeline, type TimelineEntry } from "@/lib/crm/timeline";
import { deliveryProof } from "@/lib/messaging/delivery";
import type { Database, OpportunityStatus } from "@/lib/supabase/types";
import { STATUS_LABELS } from "@/lib/workflow/states";
import type { ApplicationStatus } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * The family profile: everything the Customer 360 page shows, read through
 * the caller's own client so campus scoping is the database's answer.
 *
 * Not found and not yours read the same, on purpose: a foreign id must not
 * be distinguishable from a missing one.
 */
export async function loadFamilyProfile(supabase: Client, familyId: string) {
  const { data: family, error } = await supabase
    .from("families")
    .select(
      "*, campuses!families_campus_id_fkey(id, name, phone), staff_profiles!families_assigned_staff_id_fkey(id, full_name), referrer:families!families_referred_by_family_id_fkey(id, display_name, family_code)"
    )
    .eq("id", familyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!family) return null;

  const [
    { data: contacts },
    { data: students },
    { data: applications },
    { data: opportunities },
    { data: notes },
    { data: emails },
    { data: messages },
    { data: registrations },
    { data: campaignRows },
    { data: referred },
    { data: audit },
    { data: runs },
  ] = await Promise.all([
    supabase.from("contacts").select("*").eq("family_id", familyId).order("created_at"),
    supabase
      .from("students")
      .select("id, student_code, legal_first_name, legal_last_name, preferred_name, date_of_birth, status, current_campus_id, current_grade_id, created_at, campuses!students_current_campus_id_fkey(name), grades!students_current_grade_id_fkey(name, sort_order)")
      .eq("family_id", familyId)
      .order("date_of_birth"),
    supabase
      .from("applications")
      .select("id, reference, child_first_name, child_last_name, status, status_changed_at, created_at, campus_id, heard_from, entry_route, campuses(name), grades!applications_grade_id_fkey(name), contacts!applications_contact_id_fkey!inner(family_id)")
      .eq("contacts.family_id", familyId)
      .order("created_at", { ascending: false }),
    supabase
      .from("opportunities")
      .select("*, opportunity_types(name), students(legal_first_name, preferred_name, legal_last_name), staff_profiles!opportunities_assigned_staff_id_fkey(full_name)")
      .eq("family_id", familyId)
      .order("created_at", { ascending: false }),
    supabase
      .from("crm_notes")
      .select("*, staff_profiles(full_name)")
      .eq("family_id", familyId)
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("email_messages")
      .select("id, subject, template_key, status, sent_at, opened_at, clicked_at, created_at, to_email, contact_id, application_id, family_id")
      .or(`family_id.eq.${familyId},contact_id.in.(${await contactIdList(supabase, familyId)})`)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("messages")
      .select("*")
      .or(`family_id.eq.${familyId},contact_id.in.(${await contactIdList(supabase, familyId)})`)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("crm_event_registrations")
      .select("*, crm_events(id, name, starts_at, kind), students(legal_first_name, preferred_name)")
      .eq("family_id", familyId)
      .order("created_at", { ascending: false }),
    supabase
      .from("campaign_recipients")
      .select("id, channel, status, sent_at, created_at, campaigns(id, name, category)")
      .eq("family_id", familyId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("families").select("id, display_name, family_code, lifecycle_stage, created_at").eq("referred_by_family_id", familyId),
    supabase.from("audit_log").select("*").eq("family_id", familyId).order("id", { ascending: false }).limit(50),
    supabase.from("automation_runs").select("id, status, ran_at, log, automations(name)").eq("family_id", familyId).order("id", { ascending: false }).limit(20),
  ]);

  const studentIds = (students ?? []).map((s) => s.id);
  const applicationIds = (applications ?? []).map((a) => a.id);
  const [{ data: tasks }, { data: appEvents }, { data: onboarding }, { data: reenrolment }] = await Promise.all([
    studentIds.length || applicationIds.length
      ? supabase
          .from("tasks")
          .select("*, staff_profiles!tasks_assignee_staff_id_fkey(full_name)")
          .or([studentIds.length ? `student_id.in.(${studentIds.join(",")})` : null, applicationIds.length ? `application_id.in.(${applicationIds.join(",")})` : null].filter(Boolean).join(","))
          .order("status")
          .order("due_at", { ascending: true, nullsFirst: false })
      : Promise.resolve({ data: [] as never[] }),
    applicationIds.length
      ? supabase.from("application_events").select("id, application_id, type, summary, actor_type, occurred_at").in("application_id", applicationIds).order("id", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] as never[] }),
    studentIds.length
      ? supabase.from("student_onboarding_items").select("id, student_id, step_code, status, completed_at, due_on, onboarding_steps(label)").in("student_id", studentIds)
      : Promise.resolve({ data: [] as never[] }),
    studentIds.length
      ? supabase.from("reenrolment_responses").select("id, student_id, intent, answered_at, asked_at, reenrolment_cycles(name)").in("student_id", studentIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  // The timeline, from every log that holds a piece of it.
  const studentName = (id: string | null) => {
    const s = (students ?? []).find((x) => x.id === id);
    return s ? s.preferred_name || s.legal_first_name : null;
  };
  const appName = (id: string | null) => {
    const a = (applications ?? []).find((x) => x.id === id);
    return a ? a.child_first_name : null;
  };

  const timeline = mergeTimeline(
    (applications ?? []).map<TimelineEntry>((a) => ({
      id: `app:${a.id}`,
      kind: "admissions",
      at: a.created_at,
      title: `Enquiry for ${a.child_first_name} at ${one(a.campuses)?.name ?? "the school"}`,
      detail: `${a.reference} · now ${STATUS_LABELS[a.status as ApplicationStatus] ?? a.status}`,
      href: `/staff/applications/${a.id}`,
      actor: "Parent",
    })),
    (appEvents ?? []).map<TimelineEntry>((e) => ({
      id: `appev:${e.id}`,
      kind: "admissions",
      at: e.occurred_at,
      title: e.summary,
      detail: appName(e.application_id) ? `About ${appName(e.application_id)}` : null,
      href: `/staff/applications/${e.application_id}`,
      actor: e.actor_type === "staff" ? "Staff" : e.actor_type === "parent" ? "Parent" : "System",
    })),
    (students ?? []).map<TimelineEntry>((s) => ({
      id: `student:${s.id}`,
      kind: "enrolment",
      at: s.created_at,
      title: `${s.preferred_name || s.legal_first_name} joined the register`,
      detail: [one(s.grades)?.name, one(s.campuses)?.name].filter(Boolean).join(" · ") || null,
      href: `/staff/students/${s.id}`,
      actor: "System",
    })),
    (emails ?? []).map<TimelineEntry>((m) => ({
      id: `email:${m.id}`,
      kind: "email",
      at: m.sent_at ?? m.created_at,
      title: m.subject,
      detail: [m.to_email, m.status, m.opened_at ? "opened" : null, m.clicked_at ? "clicked" : null].filter(Boolean).join(" · "),
      href: `/staff/admin/dev-outbox/${m.id}`,
      status: m.status,
      actor: "System",
    })),
    (messages ?? []).map<TimelineEntry>((m) => ({
      id: `wa:${m.id}`,
      kind: "whatsapp",
      at: m.sent_at ?? m.received_at ?? m.created_at,
      title: m.direction === "in" ? "Parent replied on WhatsApp" : `WhatsApp: ${m.template_key ?? "message"}`,
      detail: m.direction === "in" ? m.rendered_text.slice(0, 200) : deliveryProof(m).summary,
      href: `/staff/crm/whatsapp?contact=${m.contact_id ?? ""}`,
      status: m.status,
      actor: m.direction === "in" ? "Parent" : m.sent_by ? "Staff" : "System",
    })),
    (tasks ?? []).map<TimelineEntry>((t) => ({
      id: `task:${t.id}`,
      kind: "task",
      at: t.resolved_at ?? t.created_at,
      title: t.status === "done" ? `Task done: ${t.title}` : `Task: ${t.title}`,
      detail: [one(t.staff_profiles)?.full_name ?? "Unassigned", t.due_at ? `due ${t.due_at.slice(0, 10)}` : null].filter(Boolean).join(" · "),
      href: `/staff/crm/tasks`,
      actor: t.created_by_type === "staff" ? "Staff" : "System",
    })),
    (notes ?? []).map<TimelineEntry>((n) => ({
      id: `note:${n.id}`,
      kind: "note",
      at: n.created_at,
      title: n.is_private ? "Private note" : "Note",
      detail: n.body.slice(0, 300),
      actor: one(n.staff_profiles)?.full_name ?? "Staff",
    })),
    (opportunities ?? []).flatMap<TimelineEntry>((o) => {
      const name = one(o.opportunity_types)?.name ?? o.type_code;
      const child = studentName(o.student_id);
      const out: TimelineEntry[] = [
        {
          id: `opp:${o.id}`,
          kind: "opportunity",
          at: o.created_at,
          title: `${name} opportunity identified${child ? ` for ${child}` : ""}`,
          detail: o.source === "rule" ? `By rule ${o.rule_code}` : "By a person",
          href: `/staff/crm/opportunities?family=${familyId}`,
          actor: o.source === "rule" ? "System" : "Staff",
        },
      ];
      for (const [stamp, status] of [
        [o.contacted_at, "contacted"],
        [o.interested_at, "interested"],
        [o.registered_at, "registered"],
        [o.lost_at, "lost"],
      ] as const) {
        if (stamp) out.push({ id: `opp:${o.id}:${status}`, kind: "opportunity", at: stamp, title: `${name}: ${OPPORTUNITY_STATUS_LABELS[status as OpportunityStatus]}`, href: `/staff/crm/opportunities?family=${familyId}`, actor: "Staff" });
      }
      return out;
    }),
    (registrations ?? []).map<TimelineEntry>((r) => ({
      id: `evreg:${r.id}`,
      kind: "event",
      at: r.attended_at ?? r.registered_at ?? r.created_at,
      title: `${one(r.crm_events)?.name ?? "Event"}: ${r.status.replace("_", " ")}`,
      detail: one(r.students) ? `${one(r.students)!.preferred_name || one(r.students)!.legal_first_name}` : null,
      href: `/staff/crm/events/${r.event_id}`,
      actor: r.source === "parent" ? "Parent" : r.source === "campaign" ? "System" : "Staff",
    })),
    (campaignRows ?? []).map<TimelineEntry>((c) => ({
      id: `camp:${c.id}`,
      kind: "campaign",
      at: c.sent_at ?? c.created_at,
      title: `${one(c.campaigns)?.name ?? "Campaign"} (${c.channel})`,
      detail: c.status,
      href: one(c.campaigns) ? `/staff/crm/campaigns/${one(c.campaigns)!.id}` : null,
      status: c.status,
      actor: "System",
    })),
    (onboarding ?? [])
      .filter((i) => i.completed_at)
      .map<TimelineEntry>((i) => ({
        id: `onb:${i.id}`,
        kind: "onboarding",
        at: i.completed_at!,
        title: `${one(i.onboarding_steps)?.label ?? i.step_code}: done`,
        detail: studentName(i.student_id),
        href: `/staff/onboarding`,
        actor: "Parent",
      })),
    (reenrolment ?? [])
      .filter((r) => r.asked_at || r.answered_at)
      .flatMap<TimelineEntry>((r) => {
        const out: TimelineEntry[] = [];
        if (r.asked_at) out.push({ id: `re:${r.id}:asked`, kind: "reenrolment", at: r.asked_at, title: `Asked about re-enrolment (${one(r.reenrolment_cycles)?.name ?? "round"})`, detail: studentName(r.student_id), href: "/staff/reenrolment", actor: "System" });
        if (r.answered_at) out.push({ id: `re:${r.id}:answered`, kind: "reenrolment", at: r.answered_at, title: `Re-enrolment: ${r.intent?.replace("_", " ") ?? "answered"}`, detail: studentName(r.student_id), href: "/staff/reenrolment", actor: "Parent" });
        return out;
      }),
    (audit ?? [])
      .filter((a) => a.action === "family.lifecycle_changed")
      .map<TimelineEntry>((a) => ({
        id: `audit:${a.id}`,
        kind: "lifecycle",
        at: a.occurred_at,
        title: `Lifecycle: ${LIFECYCLE_LABELS[(a.after as { lifecycle_stage?: keyof typeof LIFECYCLE_LABELS } | null)?.lifecycle_stage ?? "new_enquiry"]}`,
        detail: `from ${LIFECYCLE_LABELS[(a.before as { lifecycle_stage?: keyof typeof LIFECYCLE_LABELS } | null)?.lifecycle_stage ?? "new_enquiry"]}`,
        actor: a.actor_label ?? "System",
      }))
  );

  return {
    family,
    contacts: contacts ?? [],
    students: students ?? [],
    applications: applications ?? [],
    opportunities: opportunities ?? [],
    tasks: tasks ?? [],
    notes: notes ?? [],
    emails: emails ?? [],
    messages: messages ?? [],
    registrations: registrations ?? [],
    campaigns: campaignRows ?? [],
    referred: referred ?? [],
    audit: audit ?? [],
    runs: runs ?? [],
    onboarding: onboarding ?? [],
    reenrolment: reenrolment ?? [],
    timeline,
  };
}

export type FamilyProfile = NonNullable<Awaited<ReturnType<typeof loadFamilyProfile>>>;

/** The family's contact ids as a PostgREST list, for the two logs keyed by contact. */
async function contactIdList(supabase: Client, familyId: string): Promise<string> {
  const { data } = await supabase.from("contacts").select("id").eq("family_id", familyId);
  const ids = (data ?? []).map((c) => c.id);
  // An empty `in.()` is a syntax error; a made-up id matches nothing.
  return ids.length ? ids.join(",") : "00000000-0000-0000-0000-000000000000";
}

export type FamilyListFilters = {
  q?: string;
  campus?: string;
  lifecycle?: string;
  grade?: string;
  student?: string;
  source?: string;
  assigned?: string;
  opportunity?: string;
  contact?: "none_30d" | "none_90d" | "follow_up_due";
  tag?: string;
  page?: number;
  pageSize?: number;
};

/**
 * The Families list, server-side: filters on the facts view and a page of
 * results with the total. A search term is matched on the family's name and
 * code and the primary contact's name, email and mobile; a term that looks
 * like a student's name or code is looked up on the register first and the
 * families it names are added.
 */
export async function listFamilies(supabase: Client, f: FamilyListFilters) {
  const pageSize = Math.min(100, Math.max(10, f.pageSize ?? 50));
  const page = Math.max(1, f.page ?? 1);
  let q = supabase.from("v_crm_family_facts").select("*", { count: "exact" });

  if (f.campus) q = q.eq("campus_id", f.campus);
  if (isLifecycleStage(f.lifecycle)) q = q.eq("lifecycle_stage", f.lifecycle);
  if (f.grade) q = q.contains("grade_ids", [f.grade]);
  if (f.source) q = q.eq("lead_source", f.source);
  if (f.assigned === "none") q = q.is("assigned_staff_id", null);
  else if (f.assigned) q = q.eq("assigned_staff_id", f.assigned);
  if (f.opportunity) q = q.contains("open_opportunity_types", [f.opportunity]);
  if (f.tag) q = q.contains("tags", [f.tag]);
  if (f.contact === "none_30d") q = q.or(`last_contact_at.is.null,last_contact_at.lt.${new Date(Date.now() - 30 * 86_400_000).toISOString()}`);
  if (f.contact === "none_90d") q = q.or(`last_contact_at.is.null,last_contact_at.lt.${new Date(Date.now() - 90 * 86_400_000).toISOString()}`);
  if (f.contact === "follow_up_due") q = q.lte("next_follow_up_at", new Date().toISOString());
  if (f.student) q = q.contains("student_ids", [f.student]);

  if (f.q?.trim()) {
    const term = f.q.trim().replace(/[%,()]/g, " ").trim();
    if (term) {
      const digits = term.replace(/[^0-9]/g, "");
      const fromStudents = await supabase
        .from("students")
        .select("family_id")
        .or(`legal_first_name.ilike.%${term}%,legal_last_name.ilike.%${term}%,preferred_name.ilike.%${term}%,student_code.ilike.%${term}%`)
        .limit(200);
      const familyIds = [...new Set((fromStudents.data ?? []).map((s) => s.family_id))];
      const fromApplicants = await supabase
        .from("applications")
        .select("contacts!applications_contact_id_fkey!inner(family_id)")
        .or(`child_first_name.ilike.%${term}%,child_last_name.ilike.%${term}%,reference.ilike.%${term}%`)
        .limit(200);
      for (const a of fromApplicants.data ?? []) {
        const fid = one(a.contacts)?.family_id;
        if (fid) familyIds.push(fid);
      }
      const parts = [
        `display_name.ilike.%${term}%`,
        `family_code.ilike.%${term}%`,
        `primary_first_name.ilike.%${term}%`,
        `primary_last_name.ilike.%${term}%`,
        `primary_email.ilike.%${term}%`,
      ];
      if (digits.length >= 5) parts.push(`primary_mobile_normalised.ilike.%${digits}%`);
      if (familyIds.length) parts.push(`family_id.in.(${[...new Set(familyIds)].join(",")})`);
      q = q.or(parts.join(","));
    }
  }

  const { data, count, error } = await q
    .order("last_contact_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new Error(error.message);
  return { rows: data ?? [], total: count ?? 0, page, pageSize, pages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) };
}
