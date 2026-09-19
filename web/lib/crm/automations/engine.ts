import "server-only";
import { conditionsMatch, parseActions, parseConditions, type Action, type TriggerEvent } from "@/lib/crm/automations/rules";
import { isLifecycleStage } from "@/lib/crm/lifecycle";
import { notifyStaff } from "@/lib/crm/notifications";
import { getSettings } from "@/lib/settings";
import type { AdminClient } from "@/lib/supabase/admin";
import type { AutomationRow, Json } from "@/lib/supabase/types";
import { enqueueJobs } from "@/lib/workflow/engine";

/**
 * The automation engine: the outbox, read in order, once per drain.
 *
 * Gated by `crm_automations_enabled` (off). Each unprocessed event is
 * offered to every active automation for its type; the conditions decide;
 * the actions run in order, each writing a line to the run's log; the event
 * is stamped processed whatever happened, so a broken automation cannot
 * jam the queue — its run says `failed` and the next event goes on.
 *
 * Anything that reaches a parent is a `send_email` job for the drain, which
 * is how every other family message goes: template, consent, the WhatsApp
 * switch and the companion are all that handler's, not this file's.
 */
export type AutomationSweep = { events: number; fired: number; skipped: number; failed: number };

const EVENT_LIMIT = 200;

export async function processTriggerEvents(admin: AdminClient, now: Date = new Date()): Promise<AutomationSweep> {
  const sweep: AutomationSweep = { events: 0, fired: 0, skipped: 0, failed: 0 };
  const settings = await getSettings(admin);

  const { data: events, error } = await admin.from("crm_trigger_events").select("*").is("processed_at", null).order("id").limit(EVENT_LIMIT);
  if (error) throw new Error(error.message);
  if (!events?.length) return sweep;

  // The engine off means the rows are stamped and nothing runs: the outbox
  // must not grow for ever waiting for a switch, and an event from months
  // ago should not fire the day the school turns it on.
  if (!settings.crmAutomationsEnabled) {
    await admin.from("crm_trigger_events").update({ processed_at: now.toISOString(), outcome: "nothing" }).in("id", events.map((e) => e.id));
    sweep.events = events.length;
    return sweep;
  }

  const { data: automations } = await admin.from("automations").select("*").eq("is_active", true).order("sort_order");
  const byTrigger = new Map<string, AutomationRow[]>();
  for (const a of automations ?? []) byTrigger.set(a.trigger_type, [...(byTrigger.get(a.trigger_type) ?? []), a]);

  for (const raw of events) {
    sweep.events += 1;
    const ev: TriggerEvent = { id: raw.id, type: raw.type, family_id: raw.family_id, student_id: raw.student_id, application_id: raw.application_id, payload: (raw.payload ?? {}) as Record<string, Json | undefined> };
    let outcome: "done" | "nothing" | "failed" = "nothing";
    let lastError: string | null = null;
    for (const automation of byTrigger.get(ev.type) ?? []) {
      const familyStage = ev.family_id ? (await admin.from("families").select("lifecycle_stage").eq("id", ev.family_id).maybeSingle()).data?.lifecycle_stage ?? null : null;
      if (!conditionsMatch(parseConditions(automation.conditions), ev, familyStage)) {
        await admin.from("automation_runs").insert({ automation_id: automation.id, trigger_event_id: ev.id, family_id: ev.family_id, status: "skipped", log: [{ note: "conditions did not match" }] });
        sweep.skipped += 1;
        continue;
      }
      const parsed = parseActions(automation.actions);
      if (!parsed.ok) {
        await admin.from("automation_runs").insert({ automation_id: automation.id, trigger_event_id: ev.id, family_id: ev.family_id, status: "failed", log: parsed.problems.map((p) => ({ error: p.message })), error: "actions are not valid" });
        sweep.failed += 1;
        outcome = "failed";
        continue;
      }
      const log: Json[] = [];
      try {
        for (const action of parsed.actions) {
          const line = await runAction(admin, ev, automation, action, now);
          log.push(line);
        }
        await admin.from("automation_runs").insert({ automation_id: automation.id, trigger_event_id: ev.id, family_id: ev.family_id, status: "done", log });
        await admin.from("automations").update({ last_run_at: now.toISOString(), run_count: automation.run_count + 1 }).eq("id", automation.id);
        sweep.fired += 1;
        if (outcome !== "failed") outcome = "done";
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        log.push({ error: lastError });
        await admin.from("automation_runs").insert({ automation_id: automation.id, trigger_event_id: ev.id, family_id: ev.family_id, status: "failed", log, error: lastError });
        sweep.failed += 1;
        outcome = "failed";
      }
    }
    await admin.from("crm_trigger_events").update({ processed_at: now.toISOString(), outcome, error: lastError }).eq("id", ev.id);
  }
  return sweep;
}

/** Who "the assignee" and "the owner" are for this event's family. */
async function resolvePerson(admin: AdminClient, ev: TriggerEvent, who: string): Promise<string | null> {
  if (who === "assignee") {
    if (!ev.family_id) return null;
    const { data } = await admin.from("families").select("assigned_staff_id").eq("id", ev.family_id).maybeSingle();
    return data?.assigned_staff_id ?? null;
  }
  if (who === "application_owner") {
    let appId = ev.application_id;
    if (!appId && ev.student_id) {
      const { data } = await admin.from("students").select("origin_application_id").eq("id", ev.student_id).maybeSingle();
      appId = data?.origin_application_id ?? null;
    }
    if (!appId && ev.family_id) {
      const { data } = await admin.from("applications").select("owner_staff_id, contacts!applications_contact_id_fkey!inner(family_id)").eq("contacts.family_id", ev.family_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data?.owner_staff_id ?? null;
    }
    if (!appId) return null;
    const { data } = await admin.from("applications").select("owner_staff_id").eq("id", appId).maybeSingle();
    return data?.owner_staff_id ?? null;
  }
  // A named person, if they are still with us.
  const { data } = await admin.from("staff_profiles").select("id").eq("id", who).eq("is_active", true).maybeSingle();
  return data?.id ?? null;
}

async function runAction(admin: AdminClient, ev: TriggerEvent, automation: AutomationRow, action: Action, now: Date): Promise<Json> {
  const familyId = ev.family_id;
  switch (action.type) {
    case "assign_staff": {
      if (!familyId) return { action: action.type, note: "no family" };
      const who = await resolvePerson(admin, ev, action.staff);
      if (!who) return { action: action.type, note: "nobody to assign" };
      const { error } = await admin.from("families").update({ assigned_staff_id: who }).eq("id", familyId).is("assigned_staff_id", null);
      if (error) throw new Error(error.message);
      return { action: action.type, staff_id: who };
    }
    case "create_task": {
      const campus = await campusFor(admin, ev);
      const assignee = action.assign ? await resolvePerson(admin, ev, action.assign) : null;
      const due = action.due_days !== undefined ? new Date(now.getTime() + action.due_days * 86_400_000) : null;
      // A task must name a subject: the child, else the application, else the campus.
      const { data, error } = await admin
        .from("tasks")
        .insert({
          student_id: ev.student_id,
          application_id: ev.student_id ? null : ev.application_id,
          campus_id: campus,
          type: "crm_automation",
          title: action.title,
          details: action.details ?? `From the automation "${automation.name}".`,
          priority: action.priority ?? "normal",
          due_at: due ? new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate(), 5, 0, 0)).toISOString() : null,
          assignee_staff_id: assignee,
          created_by_type: "system",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      if (assignee) {
        await notifyStaff(admin, assignee, { kind: "task_assigned", title: action.title, body: `From the automation "${automation.name}".`, href: "/staff/crm/tasks?filter=mine", familyId });
      }
      return { action: action.type, task_id: data.id, assignee };
    }
    case "send_email":
    case "send_whatsapp": {
      if (!familyId) return { action: action.type, note: "no family" };
      const vars = await familyVariables(admin, familyId, ev.student_id);
      // WhatsApp alone still goes through the email job so the drain's
      // idempotency and the companion rules apply; the handler skips the
      // email half when the template is a WhatsApp-only one.
      await enqueueJobs(admin, [
        {
          type: "send_email",
          applicationId: null,
          idempotencyKey: `automation:${automation.code}:${ev.id}:${action.template_key}`,
          payload: {
            template_key: action.template_key,
            family_id: familyId,
            student_id: ev.student_id,
            family_link: action.link ?? "family",
            variables: vars,
            whatsapp_only: action.type === "send_whatsapp",
          },
        },
      ]);
      return { action: action.type, template_key: action.template_key, queued: true };
    }
    case "set_follow_up": {
      if (!familyId) return { action: action.type, note: "no family" };
      const at = new Date(now.getTime() + action.days * 86_400_000).toISOString();
      const { error } = await admin.from("families").update({ next_follow_up_at: at }).eq("id", familyId);
      if (error) throw new Error(error.message);
      return { action: action.type, next_follow_up_at: at };
    }
    case "add_tag":
    case "remove_tag": {
      if (!familyId) return { action: action.type, note: "no family" };
      const { data } = await admin.from("families").select("tags").eq("id", familyId).maybeSingle();
      const tags = new Set(data?.tags ?? []);
      if (action.type === "add_tag") tags.add(action.tag);
      else tags.delete(action.tag);
      const { error } = await admin.from("families").update({ tags: [...tags] }).eq("id", familyId);
      if (error) throw new Error(error.message);
      return { action: action.type, tag: action.tag };
    }
    case "create_opportunity": {
      if (!familyId) return { action: action.type, note: "no family" };
      const campus = await campusFor(admin, ev);
      if (!campus) return { action: action.type, note: "no campus" };
      const { data: family } = await admin.from("families").select("assigned_staff_id").eq("id", familyId).maybeSingle();
      const { data, error } = await admin
        .from("opportunities")
        .insert({ family_id: familyId, student_id: ev.student_id, type_code: action.type_code, campus_id: campus, source: "automation", assigned_staff_id: family?.assigned_staff_id ?? null })
        .select("id")
        .maybeSingle();
      if (error) {
        // One open opportunity of a type per child is the unique index's
        // rule; hitting it is the expected outcome, not a failure.
        if (error.code === "23505") return { action: action.type, note: "already open" };
        throw new Error(error.message);
      }
      return { action: action.type, opportunity_id: data?.id ?? null };
    }
    case "resolve_opportunity": {
      if (!familyId) return { action: action.type, note: "no family" };
      let q = admin.from("opportunities").update({ status: "registered" }).eq("family_id", familyId).eq("type_code", action.type_code).in("status", ["identified", "contacted", "interested"]);
      if (ev.student_id) q = q.eq("student_id", ev.student_id);
      const { error } = await q;
      if (error) throw new Error(error.message);
      return { action: action.type, type_code: action.type_code };
    }
    case "set_lifecycle": {
      if (!familyId || !isLifecycleStage(action.stage)) return { action: action.type, note: "no family or unknown stage" };
      const { error } = await admin.from("families").update({ lifecycle_stage: action.stage, lifecycle_manual: true, lifecycle_changed_at: now.toISOString() }).eq("id", familyId);
      if (error) throw new Error(error.message);
      return { action: action.type, stage: action.stage };
    }
    case "notify": {
      const who = await resolvePerson(admin, ev, action.to);
      if (!who) return { action: action.type, note: "nobody to notify" };
      await notifyStaff(admin, who, { kind: "family_activity", title: action.title, body: action.body ?? null, href: familyId ? `/staff/crm/families/${familyId}` : null, familyId });
      return { action: action.type, staff_id: who };
    }
  }
}

async function campusFor(admin: AdminClient, ev: TriggerEvent): Promise<string | null> {
  const fromPayload = ev.payload.campus_id;
  if (typeof fromPayload === "string") return fromPayload;
  if (ev.family_id) {
    const { data } = await admin.from("families").select("campus_id").eq("id", ev.family_id).maybeSingle();
    if (data?.campus_id) return data.campus_id;
  }
  return null;
}

/** The variables a family template may use, from the family itself. */
async function familyVariables(admin: AdminClient, familyId: string, studentId: string | null): Promise<Record<string, string | null>> {
  const [{ data: family }, { data: student }] = await Promise.all([
    admin.from("families").select("display_name, campuses!families_campus_id_fkey(name)").eq("id", familyId).maybeSingle(),
    studentId
      ? admin.from("students").select("preferred_name, legal_first_name").eq("id", studentId).maybeSingle()
      : admin.from("students").select("preferred_name, legal_first_name").eq("family_id", familyId).in("status", ["onboarding", "active"]).order("date_of_birth", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const campus = Array.isArray(family?.campuses) ? family?.campuses[0] : family?.campuses;
  return {
    family_name: family?.display_name ?? null,
    campus: campus?.name ?? "Hibiscus",
    student_first_name: student ? student.preferred_name || student.legal_first_name : null,
  };
}
