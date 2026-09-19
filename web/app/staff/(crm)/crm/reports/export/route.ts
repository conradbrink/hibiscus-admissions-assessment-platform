import { toCsv } from "@/lib/crm/csv";
import { isLifecycleStage } from "@/lib/crm/lifecycle";
import { listSegment, parseRules } from "@/lib/crm/segments-server";
import { can } from "@/lib/permissions";
import { getStaff } from "@/lib/staff/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * A CSV of whichever list was asked for, read through the caller's own
 * client so the rows are theirs to see, capped, and audited with the
 * filters and the count. No medical field leaves this route: the student
 * export that carries them is the admissions one, behind its own switch.
 */
export async function GET(request: Request) {
  const ctx = await getStaff();
  if (!ctx || !can(ctx.permissions, "crm.export")) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "";
  const campus = url.searchParams.get("campus") || null;
  const { supabase } = ctx;
  let headers: string[] = [];
  let rows: Array<Array<string | number | boolean | null | undefined>> = [];

  if (kind === "families") {
    const lifecycle = url.searchParams.get("lifecycle");
    const segmentId = url.searchParams.get("segment");
    let data;
    if (segmentId) {
      const { data: seg } = await supabase.from("segments").select("*").eq("id", segmentId).maybeSingle();
      data = seg ? await listSegment(supabase, parseRules(seg.rules), campus ?? seg.campus_id) : [];
    } else {
      let q = supabase.from("v_crm_family_facts").select("*").order("display_name").limit(5000);
      if (campus) q = q.eq("campus_id", campus);
      if (isLifecycleStage(lifecycle)) q = q.eq("lifecycle_stage", lifecycle);
      data = (await q).data ?? [];
    }
    headers = ["family_code", "family_name", "campus", "lifecycle", "primary_first_name", "primary_last_name", "email", "mobile", "whatsapp_updates", "marketing_email", "marketing_whatsapp", "sms", "students", "enrolled", "lead_source", "tags", "last_contact", "next_follow_up", "created"];
    rows = data.map((f) => [f.family_code, f.display_name, f.campus_name, f.lifecycle_stage, f.primary_first_name, f.primary_last_name, f.primary_email, f.primary_mobile, f.primary_whatsapp_opt_in, f.primary_marketing_email_consent, f.primary_marketing_whatsapp_consent, f.primary_sms_consent, f.student_count, f.enrolled_count, f.lead_source, f.tags.join("|"), f.last_contact_at, f.next_follow_up_at, f.created_at]);
  } else if (kind === "contacts") {
    let q = supabase.from("contacts").select("first_name, last_name, email, mobile, relationship, whatsapp_opt_in, marketing_email_consent, marketing_whatsapp_consent, sms_consent, unsubscribed_at, is_active, family_code, families!contacts_family_id_fkey(display_name, campus_id, campuses!families_campus_id_fkey(name))").order("last_name").limit(5000);
    if (url.searchParams.get("consented")) q = q.or("marketing_email_consent.eq.true,marketing_whatsapp_consent.eq.true");
    const { data } = await q;
    const filtered = (data ?? []).filter((c) => !campus || one(c.families)?.campus_id === campus);
    headers = ["first_name", "last_name", "email", "mobile", "relationship", "family_code", "family_name", "campus", "whatsapp_updates", "marketing_email", "marketing_whatsapp", "sms", "unsubscribed_at", "active"];
    rows = filtered.map((c) => [c.first_name, c.last_name, c.email, c.mobile, c.relationship, c.family_code, one(c.families)?.display_name, one(one(c.families)?.campuses)?.name, c.whatsapp_opt_in, c.marketing_email_consent, c.marketing_whatsapp_consent, c.sms_consent, c.unsubscribed_at, c.is_active]);
  } else if (kind === "students") {
    let q = supabase.from("students").select("student_code, legal_first_name, legal_last_name, preferred_name, date_of_birth, status, created_at, families!students_family_id_fkey(family_code, display_name), campuses!students_current_campus_id_fkey(name), grades!students_current_grade_id_fkey(name)").order("legal_last_name").limit(5000);
    if (campus) q = q.eq("current_campus_id", campus);
    const { data } = await q;
    headers = ["student_code", "first_name", "last_name", "preferred_name", "date_of_birth", "status", "family_code", "family_name", "campus", "grade", "on_register_since"];
    rows = (data ?? []).map((s) => [s.student_code, s.legal_first_name, s.legal_last_name, s.preferred_name, s.date_of_birth, s.status, one(s.families)?.family_code, one(s.families)?.display_name, one(s.campuses)?.name, one(s.grades)?.name, s.created_at]);
  } else if (kind === "opportunities") {
    let q = supabase.from("opportunities").select("type_code, status, estimated_value_minor, actual_value_minor, currency, source, rule_code, next_action, next_action_at, lost_reason, created_at, registered_at, families!opportunities_family_id_fkey(family_code, display_name), students(legal_first_name, legal_last_name), campuses(name), staff_profiles!opportunities_assigned_staff_id_fkey(full_name)").order("created_at", { ascending: false }).limit(5000);
    if (campus) q = q.eq("campus_id", campus);
    const type = url.searchParams.get("type");
    const status = url.searchParams.get("status");
    if (type) q = q.eq("type_code", type);
    if (status) q = q.eq("status", status as "identified");
    const { data } = await q;
    headers = ["type", "status", "family_code", "family_name", "student", "campus", "estimated_value", "actual_value", "currency", "assigned_to", "source", "rule", "next_action", "next_action_at", "lost_reason", "created", "registered"];
    rows = (data ?? []).map((o) => [o.type_code, o.status, one(o.families)?.family_code, one(o.families)?.display_name, one(o.students) ? `${one(o.students)!.legal_first_name} ${one(o.students)!.legal_last_name}` : null, one(o.campuses)?.name, o.estimated_value_minor === null ? null : o.estimated_value_minor / 100, o.actual_value_minor === null ? null : o.actual_value_minor / 100, o.currency, one(o.staff_profiles)?.full_name, o.source, o.rule_code, o.next_action, o.next_action_at, o.lost_reason, o.created_at, o.registered_at]);
  } else if (kind === "campaign_recipients") {
    const campaignId = url.searchParams.get("campaign");
    if (!campaignId) return new Response("Choose a campaign.", { status: 400 });
    const { data } = await supabase.from("campaign_recipients").select("channel, status, exclusion_reason, error, sent_at, families!campaign_recipients_family_id_fkey(family_code, display_name), contacts(first_name, last_name, email, mobile), email_messages(status, opened_at, clicked_at), messages(status, delivered_at, read_at)").eq("campaign_id", campaignId).limit(20000);
    headers = ["family_code", "family_name", "first_name", "last_name", "email", "mobile", "channel", "status", "reason", "sent_at", "delivery_status", "opened_or_read_at"];
    rows = (data ?? []).map((r) => [one(r.families)?.family_code, one(r.families)?.display_name, one(r.contacts)?.first_name, one(r.contacts)?.last_name, one(r.contacts)?.email, one(r.contacts)?.mobile, r.channel, r.status, r.exclusion_reason ?? r.error, r.sent_at, one(r.email_messages)?.status ?? one(r.messages)?.status, one(r.email_messages)?.opened_at ?? one(r.messages)?.read_at]);
  } else if (kind === "lead_sources") {
    const { data } = await supabase.rpc("crm_lead_source_report", { p_campus_id: campus, p_from: null });
    headers = ["lead_source", "families", "enquiries", "reached_offer", "enrolled"];
    rows = (data ?? []).map((r) => [r.lead_source, r.families, r.enquiries, r.offers, r.enrolled]);
  } else {
    return new Response("Unknown report.", { status: 400 });
  }

  await createAdminClient().from("audit_log").insert({
    actor_type: "staff",
    actor_id: ctx.userId,
    actor_label: ctx.profile.email,
    action: "crm.export",
    entity_type: "export",
    after: { kind, filters: Object.fromEntries(url.searchParams), rows: rows.length },
  });

  const filename = `crm-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(toCsv(headers, rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}
