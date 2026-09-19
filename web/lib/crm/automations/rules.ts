import type { AutomationTrigger, Json } from "@/lib/supabase/types";

/**
 * Automations: whether an event is one the automation cares about, and what
 * its actions are — as data, checked, with nothing done yet.
 *
 * Pure. `engine.ts` is the half that reads the outbox and writes.
 */

export type TriggerEvent = {
  id: number;
  type: string;
  family_id: string | null;
  student_id: string | null;
  application_id: string | null;
  payload: Record<string, Json | undefined>;
};

export type Conditions = {
  campus_ids?: string[];
  to?: string[];
  from?: string[];
  entry_routes?: string[];
  heard_from?: string[];
  type_codes?: string[];
  source?: string[];
  lifecycle_stages?: string[];
};

export function parseConditions(raw: Json | null | undefined): Conditions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, Json | undefined>;
  const strs = (v: Json | undefined) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
  return {
    campus_ids: strs(o.campus_ids),
    to: strs(o.to),
    from: strs(o.from),
    entry_routes: strs(o.entry_routes),
    heard_from: strs(o.heard_from),
    type_codes: strs(o.type_codes),
    source: strs(o.source),
    lifecycle_stages: strs(o.lifecycle_stages),
  };
}

function str(v: Json | undefined): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Every given condition must hold; a condition the event's payload cannot
 * answer fails, so an automation is never fired on a guess.
 */
export function conditionsMatch(c: Conditions, ev: TriggerEvent, familyStage: string | null = null): boolean {
  const p = ev.payload;
  const test = (list: string[] | undefined, value: string | null) => !list?.length || (value !== null && list.includes(value));
  if (!test(c.campus_ids, str(p.campus_id))) return false;
  if (!test(c.to, str(p.to))) return false;
  if (!test(c.from, str(p.from))) return false;
  if (!test(c.entry_routes, str(p.entry_route))) return false;
  if (!test(c.heard_from, str(p.heard_from))) return false;
  if (!test(c.type_codes, str(p.type_code))) return false;
  if (!test(c.source, str(p.source))) return false;
  if (!test(c.lifecycle_stages, familyStage)) return false;
  return true;
}

export type Action =
  | { type: "create_task"; title: string; details?: string; due_days?: number; priority?: "low" | "normal" | "high" | "urgent"; assign?: "assignee" | "application_owner" | string }
  | { type: "send_email"; template_key: string; link?: "family" | "onboarding" | "reenrolment" | "checkin" | "event" }
  | { type: "send_whatsapp"; template_key: string; link?: "family" | "onboarding" | "reenrolment" | "checkin" | "event" }
  | { type: "assign_staff"; staff: "application_owner" | string }
  | { type: "set_follow_up"; days: number }
  | { type: "add_tag"; tag: string }
  | { type: "remove_tag"; tag: string }
  | { type: "create_opportunity"; type_code: string }
  | { type: "resolve_opportunity"; type_code: string }
  | { type: "set_lifecycle"; stage: string }
  | { type: "notify"; to: "assignee" | "application_owner" | string; title: string; body?: string };

export const ACTION_TYPES = [
  "create_task", "send_email", "send_whatsapp", "assign_staff", "set_follow_up",
  "add_tag", "remove_tag", "create_opportunity", "resolve_opportunity", "set_lifecycle", "notify",
] as const;

export const ACTION_LABELS: Record<Action["type"], string> = {
  create_task: "Create a task",
  send_email: "Send a family email",
  send_whatsapp: "Send a WhatsApp template",
  assign_staff: "Assign a member of staff",
  set_follow_up: "Set the next follow-up",
  add_tag: "Add a tag",
  remove_tag: "Remove a tag",
  create_opportunity: "Create an opportunity",
  resolve_opportunity: "Close an open opportunity",
  set_lifecycle: "Set the lifecycle stage",
  notify: "Notify somebody",
};

export const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  "family.created": "A family is created by hand",
  "enquiry.created": "An enquiry arrives",
  "application.status_changed": "An application changes status",
  "family.lifecycle_changed": "A family's lifecycle stage changes",
  "student.enrolled": "A child is enrolled",
  "student.status_changed": "A child's status changes",
  "reenrolment.opened": "A re-enrolment round opens",
  "reenrolment.asked": "A family is asked about re-enrolment",
  "reenrolment.answered": "A family answers about re-enrolment",
  "opportunity.created": "An opportunity is identified",
  "opportunity.status_changed": "An opportunity changes status",
  "event.registered": "A family registers for an event",
  "event.attended": "A family attends an event",
};

export type ActionProblem = { index: number; message: string };

const TAG = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const KEY = /^[a-z0-9_]+$/;

/** Refuses an action list that the engine could not run. */
export function parseActions(raw: Json | null | undefined): { ok: true; actions: Action[] } | { ok: false; problems: ActionProblem[] } {
  if (!Array.isArray(raw)) return { ok: false, problems: [{ index: -1, message: "Actions must be a list." }] };
  const problems: ActionProblem[] = [];
  const actions: Action[] = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return problems.push({ index, message: "Not an action." });
    const a = item as Record<string, Json | undefined>;
    const t = a.type;
    const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string).trim() : "");
    const n = (k: string) => (typeof a[k] === "number" ? (a[k] as number) : undefined);
    switch (t) {
      case "create_task": {
        if (!s("title")) return problems.push({ index, message: "A task needs a title." });
        const priority = s("priority");
        actions.push({
          type: "create_task",
          title: s("title").slice(0, 200),
          details: s("details") || undefined,
          due_days: n("due_days"),
          priority: priority === "low" || priority === "high" || priority === "urgent" ? priority : "normal",
          assign: s("assign") || undefined,
        });
        return;
      }
      case "send_email":
      case "send_whatsapp": {
        if (!KEY.test(s("template_key"))) return problems.push({ index, message: "A message needs a template key." });
        const link = s("link");
        actions.push({ type: t, template_key: s("template_key"), link: isFamilyLink(link) ? link : undefined });
        return;
      }
      case "assign_staff":
        if (!s("staff")) return problems.push({ index, message: "Say who to assign." });
        actions.push({ type: "assign_staff", staff: s("staff") });
        return;
      case "set_follow_up": {
        const days = n("days");
        if (days === undefined || days < 0) return problems.push({ index, message: "A follow-up needs a number of days." });
        actions.push({ type: "set_follow_up", days });
        return;
      }
      case "add_tag":
      case "remove_tag":
        if (!TAG.test(s("tag"))) return problems.push({ index, message: "A tag is lower-case letters, digits, - and _." });
        actions.push({ type: t, tag: s("tag") });
        return;
      case "create_opportunity":
      case "resolve_opportunity":
        if (!KEY.test(s("type_code"))) return problems.push({ index, message: "An opportunity action needs a type code." });
        actions.push({ type: t, type_code: s("type_code") });
        return;
      case "set_lifecycle":
        if (!s("stage")) return problems.push({ index, message: "Say which stage." });
        actions.push({ type: "set_lifecycle", stage: s("stage") });
        return;
      case "notify":
        if (!s("to") || !s("title")) return problems.push({ index, message: "A notification needs a recipient and a title." });
        actions.push({ type: "notify", to: s("to"), title: s("title").slice(0, 200), body: s("body") || undefined });
        return;
      default:
        problems.push({ index, message: `Unknown action "${String(t)}".` });
    }
  });
  return problems.length ? { ok: false, problems } : { ok: true, actions };
}

function isFamilyLink(v: string): v is "family" | "onboarding" | "reenrolment" | "checkin" | "event" {
  return v === "family" || v === "onboarding" || v === "reenrolment" || v === "checkin" || v === "event";
}

/** One line per action, for the automations page. */
export function describeAction(a: Action): string {
  switch (a.type) {
    case "create_task":
      return `Task "${a.title}"${a.due_days !== undefined ? ` due in ${a.due_days} day${a.due_days === 1 ? "" : "s"}` : ""}${a.assign ? ` for ${a.assign === "assignee" ? "the family's assignee" : a.assign === "application_owner" ? "the application's owner" : "a named person"}` : ""}`;
    case "send_email":
      return `Email "${a.template_key}"`;
    case "send_whatsapp":
      return `WhatsApp "${a.template_key}" (consent and template permitting)`;
    case "assign_staff":
      return a.staff === "application_owner" ? "Assign the application's owner" : "Assign a named person";
    case "set_follow_up":
      return `Follow up in ${a.days} day${a.days === 1 ? "" : "s"}`;
    case "add_tag":
      return `Tag "${a.tag}"`;
    case "remove_tag":
      return `Remove tag "${a.tag}"`;
    case "create_opportunity":
      return `Opportunity: ${a.type_code}`;
    case "resolve_opportunity":
      return `Close the open ${a.type_code} opportunity`;
    case "set_lifecycle":
      return `Lifecycle → ${a.stage}`;
    case "notify":
      return `Notify ${a.to === "assignee" ? "the assignee" : a.to === "application_owner" ? "the owner" : "a named person"}: "${a.title}"`;
  }
}
